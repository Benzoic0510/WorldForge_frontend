<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getStoryGraph, listSubmissions, reviewSubmission } from '@/api/storyline'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import type { WorldDetail } from '@/types/world'
import type {
  StoryGraphData,
  SubmissionListItem,
  ReviewSubmissionResponse
} from '@/types/storyline'

const route = useRoute()
const world = ref<WorldDetail | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const appendError = ref('')
const submissions = ref<SubmissionListItem[]>([])
const totalPages = ref(0)
const page = ref(1)
const activeFilter = ref('pending_review')
const errorMessage = ref('')

const reviewModal = ref<{ show: boolean; submission: SubmissionListItem | null; comment: string; isSubmitting: boolean; error: string; result: ReviewSubmissionResponse | null }>({
  show: false,
  submission: null,
  comment: '',
  isSubmitting: false,
  error: '',
  result: null
})

const storyGraphData = ref<StoryGraphData | null>(null)
const lineNameMap = ref<Record<string, string>>({})

const worldId = computed(() => String(route.params.worldId || ''))
const canReview = computed(() => world.value?.viewer.canReview === true)
const canLoadMore = computed(() => page.value < totalPages.value)
const mergedParentLineIds = computed(() => {
  const ids = new Set<string>()
  const mergeLineIds = new Set(
    (storyGraphData.value?.nodes ?? [])
      .filter(node => node.type === 'merge')
      .map(node => node.lineId)
  )
  for (const edge of storyGraphData.value?.edges ?? []) {
    if (mergeLineIds.has(edge.childLineId)) {
      ids.add(edge.parentLineId)
    }
  }
  return ids
})

const filterTabs = [
  { value: 'all', label: '全部' },
  { value: 'pending_review', label: '待审核' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已拒绝' }
]

const filterCounts = computed(() => {
  const counts: Record<string, number> = { all: submissions.value.length }
  for (const tab of filterTabs) {
    if (tab.value === 'all') continue
    counts[tab.value] = submissions.value.filter(
      (s) => s.status === tab.value
    ).length
  }
  return counts
})

const filteredSubmissions = computed(() => {
  if (activeFilter.value === 'all') return submissions.value
  return submissions.value.filter((s) => s.status === activeFilter.value)
})

function formatDateTime(dt: string): string {
  if (!dt) return ''
  return dt.replace('T', ' ').substring(0, 16)
}

function formatStatus(status: string): { label: string; className: string } {
  switch (status) {
    case 'pending_review': return { label: '待审核', className: 'status-chip--pending' }
    case 'approved': return { label: '已批准', className: 'status-chip--approved' }
    case 'rejected': return { label: '已拒绝', className: 'status-chip--rejected' }
    default: return { label: status, className: '' }
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function isMergedParentLine(lineId: string): boolean {
  return mergedParentLineIds.value.has(lineId)
}

async function loadWorld() {
  loading.value = true
  errorMessage.value = ''

  try {
    world.value = await getWorldDetail(worldId.value)
  } catch (error) {
    world.value = null
    errorMessage.value = getErrorMessage(error, '世界档案暂时无法加载，请稍后重试。')
    loading.value = false
    return
  }

  try {
    storyGraphData.value = await getStoryGraph(worldId.value)
    for (const node of storyGraphData.value.nodes) {
      lineNameMap.value[node.lineId] = node.name
    }
  } catch {
    storyGraphData.value = null
  }

  await fetchSubmissions()
}

async function fetchSubmissions(options: { append?: boolean } = {}) {
  const append = options.append === true
  if (append) {
    loadingMore.value = true
    appendError.value = ''
  } else {
    loading.value = true
    page.value = 1
  }

  try {
    const status = activeFilter.value === 'all' ? 'all' : activeFilter.value
    const data = await listSubmissions(worldId.value, {
      status,
      page: page.value,
      pageSize: 20
    })

    if (append) {
      submissions.value = submissions.value.concat(data.items)
    } else {
      submissions.value = data.items
    }
    totalPages.value = data.totalPages
  } catch (error) {
    if (append) {
      appendError.value = getErrorMessage(error, '加载更多失败')
    } else {
      errorMessage.value = getErrorMessage(error, '审核列表暂时无法加载，请稍后重试。')
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function handleLoadMore() {
  if (!canLoadMore.value || loadingMore.value) return
  page.value += 1
  await fetchSubmissions({ append: true })
}

async function handleFilterChange(filter: string) {
  if (activeFilter.value === filter) return
  activeFilter.value = filter
  await fetchSubmissions()
}

function openReviewModal(submission: SubmissionListItem) {
  reviewModal.value = {
    show: true,
    submission,
    comment: '',
    isSubmitting: false,
    error: '',
    result: null
  }
}

function closeReviewModal() {
  reviewModal.value.show = false
}

async function handleApprove() {
  if (!reviewModal.value.submission) return
  if (isMergedParentLine(reviewModal.value.submission.targetLineId)) {
    reviewModal.value.error = '目标故事线已经被合并，不能再批准新的 Push'
    return
  }
  reviewModal.value.isSubmitting = true
  reviewModal.value.error = ''

  try {
    const result = await reviewSubmission(
      worldId.value,
      reviewModal.value.submission.submissionId,
      {
        decision: 'approve',
        comment: reviewModal.value.comment.trim() || undefined
      }
    )
    reviewModal.value.result = result

    const idx = submissions.value.findIndex(
      (s) => s.submissionId === result.submissionId
    )
    if (idx !== -1) {
      submissions.value[idx] = {
        ...submissions.value[idx],
        status: 'approved'
      }
    }
  } catch (error) {
    reviewModal.value.error = getErrorMessage(error, '审核操作失败，请稍后重试。')
  } finally {
    reviewModal.value.isSubmitting = false
  }
}

async function handleReject() {
  if (!reviewModal.value.submission) return
  reviewModal.value.isSubmitting = true
  reviewModal.value.error = ''

  try {
    const result = await reviewSubmission(
      worldId.value,
      reviewModal.value.submission.submissionId,
      {
        decision: 'reject',
        comment: reviewModal.value.comment.trim() || undefined
      }
    )
    reviewModal.value.result = result

    const idx = submissions.value.findIndex(
      (s) => s.submissionId === result.submissionId
    )
    if (idx !== -1) {
      submissions.value[idx] = {
        ...submissions.value[idx],
        status: 'rejected'
      }
    }
  } catch (error) {
    reviewModal.value.error = getErrorMessage(error, '拒绝操作失败，请稍后重试。')
  } finally {
    reviewModal.value.isSubmitting = false
  }
}

onMounted(async () => {
  await loadWorld()
})
</script>

<template>
  <main class="review-page">
    <section v-if="loading" class="review-shell page-container">
      <div class="review-state">
        <p>正在读取待审核列表...</p>
      </div>
    </section>

    <section v-else-if="!world || !canReview" class="review-shell page-container">
      <div class="review-state review-state--error">
        <h1>{{ world ? '你没有审核权限' : '世界档案暂时不可用' }}</h1>
        <p>{{ errorMessage || '只有创建者和共同管理员可以审核提交。' }}</p>
        <div class="state-actions">
          <RouterLink
            class="state-button state-button--primary"
            :to="{ name: 'world-detail', params: { worldId } }"
          >
            返回世界详情
          </RouterLink>
          <button type="button" class="state-button" @click="loadWorld">重新加载</button>
        </div>
      </div>
    </section>

    <section v-else class="review-shell page-container">
      <nav class="review-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          {{ world.name }}
        </RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }">
          创作工作台
        </RouterLink>
        <span>/</span>
        <strong>审核提交</strong>
      </nav>

      <header class="review-header">
        <div>
          <p class="eyebrow">Review Submissions</p>
          <h1>审核 Push 提交</h1>
        </div>
        <p>审核协作者提交的内容，批准后内容将合入目标故事线。</p>
      </header>

      <nav class="filter-tabs" aria-label="状态筛选">
        <button
          v-for="tab in filterTabs"
          :key="tab.value"
          class="filter-tab"
          :class="{ 'filter-tab--active': activeFilter === tab.value }"
          @click="handleFilterChange(tab.value)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <template v-if="submissions.length === 0">
        <div class="review-state">
          <h2>暂无审核提交</h2>
          <p>{{ activeFilter === 'pending_review' ? '目前没有待审核的 Push 提交。' : '没有匹配当前状态的提交。' }}</p>
        </div>
      </template>

      <template v-else>
        <div v-if="filteredSubmissions.length === 0" class="review-state">
          <p>当前筛选条件下没有匹配的提交。</p>
        </div>

        <div v-else class="submission-grid">
          <div
            v-for="submission in filteredSubmissions"
            :key="submission.submissionId"
            class="submission-card"
          >
            <div class="submission-card__meta">
              <span class="submission-card__author">{{ submission.submitter.nickname }}</span>
              <span class="submission-card__time">{{ formatDateTime(submission.submittedAt) }}</span>
            </div>
            <p class="submission-card__line">
              {{ lineNameMap[submission.targetLineId] || submission.targetLineId }}
            </p>
            <p class="submission-card__summary">{{ submission.title || submission.summary }}</p>
            <div class="submission-card__footer">
              <span
                class="status-chip"
                :class="formatStatus(submission.status).className"
              >
                {{ formatStatus(submission.status).label }}
              </span>
              <button
                v-if="submission.status === 'pending_review'"
                class="review-button"
                :disabled="isMergedParentLine(submission.targetLineId)"
                :title="isMergedParentLine(submission.targetLineId) ? '目标故事线已经被合并，不能再批准新的 Push' : ''"
                @click="openReviewModal(submission)"
              >
                {{ isMergedParentLine(submission.targetLineId) ? '已合并' : '审核' }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="appendError" class="append-error-row">
          <p>{{ appendError }}</p>
          <button type="button" @click="handleLoadMore">再试一次</button>
        </div>

        <div v-if="canLoadMore" class="load-more-row">
          <button
            class="load-more-button"
            :disabled="loadingMore"
            @click="handleLoadMore"
          >
            {{ loadingMore ? '加载中...' : '加载更多' }}
          </button>
        </div>
      </template>
    </section>

    <Teleport to="body">
      <div
        v-if="reviewModal.show && reviewModal.submission"
        class="modal-overlay"
        @click.self="closeReviewModal"
      >
        <div class="modal-panel">
          <header class="modal-header">
            <h2>审核 Push 提交</h2>
            <button class="modal-close" @click="closeReviewModal" aria-label="关闭">&times;</button>
          </header>

          <template v-if="reviewModal.result">
            <div class="modal-body">
              <p class="modal-success-text">
                {{ reviewModal.result.status === 'approved' ? '已批准该提交。' : '已拒绝该提交。' }}
              </p>
            </div>
            <footer class="modal-footer">
              <button class="modal-btn modal-btn--primary" @click="closeReviewModal">关闭</button>
            </footer>
          </template>

          <template v-else>
            <div class="modal-body">
              <div class="modal-submission-info">
                <div class="modal-info-row">
                  <span class="modal-info-label">提交者</span>
                  <span>{{ reviewModal.submission.submitter.nickname }}</span>
                </div>
                <div class="modal-info-row">
                  <span class="modal-info-label">目标故事线</span>
                  <span>{{ lineNameMap[reviewModal.submission.targetLineId] || reviewModal.submission.targetLineId }}</span>
                </div>
                <div v-if="isMergedParentLine(reviewModal.submission.targetLineId)" class="modal-info-row">
                  <span class="modal-info-label">状态提示</span>
                  <span>目标故事线已经被合并，不能再批准新的 Push。</span>
                </div>
                <div class="modal-info-row">
                  <span class="modal-info-label">提交时间</span>
                  <span>{{ formatDateTime(reviewModal.submission.submittedAt) }}</span>
                </div>
                <div class="modal-info-row">
                  <span class="modal-info-label">标题</span>
                  <span>{{ reviewModal.submission.title || reviewModal.submission.summary }}</span>
                </div>
                <div class="modal-info-row">
                  <span class="modal-info-label">基于版本</span>
                  <span>{{ reviewModal.submission.basedOnPushTitle || '线路起点' }}</span>
                </div>
                <div class="modal-info-row">
                  <span class="modal-info-label">当前最新</span>
                  <span>{{ reviewModal.submission.latestPushTitle || '暂无已批准 Push' }}</span>
                </div>
                <div
                  v-if="reviewModal.submission.basedOnPushId !== reviewModal.submission.latestPushId"
                  class="modal-info-row modal-info-row--warning"
                >
                  <span class="modal-info-label">版本提示</span>
                  <span>该提交基于旧版本创作，批准后会按当前审核顺序合入故事线。</span>
                </div>
              </div>

              <label class="modal-field">
                <span class="modal-field__label">审核意见（可选）</span>
                <textarea
                  v-model="reviewModal.comment"
                  maxlength="500"
                  placeholder="可选：填写审核意见..."
                  rows="3"
                ></textarea>
                <span class="modal-field__hint">{{ reviewModal.comment.length }} / 500</span>
              </label>

              <p v-if="reviewModal.error" class="modal-error" role="alert">{{ reviewModal.error }}</p>
            </div>

            <footer class="modal-footer modal-footer--actions">
              <button
                class="modal-btn modal-btn--approve"
                :disabled="reviewModal.isSubmitting || isMergedParentLine(reviewModal.submission.targetLineId)"
                @click="handleApprove"
              >
                {{ reviewModal.isSubmitting ? '处理中...' : '批准' }}
              </button>
              <button
                class="modal-btn modal-btn--reject"
                :disabled="reviewModal.isSubmitting"
                @click="handleReject"
              >
                {{ reviewModal.isSubmitting ? '处理中...' : '拒绝' }}
              </button>
            </footer>
          </template>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.review-page {
  padding-block: 28px 56px;
}

.review-shell {
  display: grid;
  gap: 18px;
}

.review-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.review-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.review-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.review-state,
.review-header {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.review-state {
  display: grid;
  gap: 12px;
  min-height: 220px;
  padding: 32px;
  align-content: center;
}

.review-state--error {
  background: rgb(108 36 36 / 6%);
}

.review-state h1,
.review-state h2,
.review-state p,
.review-header h1,
.review-header p {
  margin: 0;
}

.review-state h1,
.review-state h2,
.review-header h1 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.review-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.review-state h2 {
  font-size: 1.6rem;
}

.review-state p,
.review-header p {
  color: var(--color-muted);
  line-height: 1.75;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.state-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.state-button--primary {
  border: 0;
  color: #fff;
  background: #103b31;
}

.review-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr);
  gap: 18px;
  align-items: end;
  padding: 24px;
}

.review-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.4rem);
  line-height: 1.03;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

/* Filter tabs */
.filter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-tab {
  padding: 8px 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 999px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 62%);
  font-size: 0.88rem;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.filter-tab:hover {
  background: rgb(244 240 231 / 86%);
}

.filter-tab--active {
  color: #fff;
  background: #103b31;
  border-color: #103b31;
}

/* Submission grid */
.submission-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.submission-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.submission-card:hover {
  transform: translateY(-2px);
  border-color: rgb(16 59 49 / 24%);
  box-shadow: 0 12px 36px rgb(24 33 31 / 12%);
}

.submission-card__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.82rem;
}

.submission-card__author {
  color: var(--color-ink);
  font-weight: 800;
}

.submission-card__time {
  color: var(--color-muted);
}

.submission-card__line {
  margin: 0;
  color: #305349;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 900;
  line-height: 1.2;
}

.submission-card__summary {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.9rem;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.submission-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

/* Status chips */
.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
}

.status-chip--pending {
  color: #6c5b24;
  background: rgb(252 240 192 / 72%);
  border: 1px solid rgb(108 91 36 / 24%);
}

.status-chip--approved {
  color: #14735a;
  background: rgb(232 241 237 / 72%);
  border: 1px solid rgb(20 115 90 / 24%);
}

.status-chip--rejected {
  color: #8f2d2d;
  background: rgb(255 246 242 / 72%);
  border: 1px solid rgb(143 45 45 / 24%);
}

.review-button {
  padding: 6px 14px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font-size: 0.84rem;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.15s;
}

.review-button:hover {
  background: rgb(244 240 231 / 86%);
}

.review-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

/* Load more */
.load-more-row {
  display: flex;
  justify-content: center;
}

.load-more-button {
  min-height: 44px;
  padding: 0 24px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  font-weight: 900;
  cursor: pointer;
}

.load-more-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.append-error-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgb(176 64 64 / 28%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-weight: 800;
}

.append-error-row p {
  margin: 0;
}

.append-error-row button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font-weight: 800;
  cursor: pointer;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(24 33 31 / 38%);
  z-index: 1000;
  padding: 24px;
}

.modal-panel {
  width: 100%;
  max-width: 540px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 72%), rgb(244 240 231 / 88%)),
    rgb(255 255 255 / 64%);
  box-shadow: 0 32px 92px rgb(24 33 31 / 24%);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 22px 0;
}

.modal-header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.5rem;
}

.modal-close {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  color: var(--color-muted);
  background: rgb(255 255 255 / 62%);
  font-size: 1.3rem;
  cursor: pointer;
}

.modal-body {
  display: grid;
  gap: 18px;
  padding: 18px 22px;
}

.modal-success-text {
  margin: 0;
  color: #14735a;
  font-weight: 800;
  font-size: 1rem;
}

.modal-submission-info {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 42%);
}

.modal-info-row {
  display: grid;
  gap: 4px;
}

.modal-info-label {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.modal-info-row span:last-child {
  color: var(--color-ink);
  line-height: 1.45;
}

.modal-field {
  display: grid;
  gap: 8px;
}

.modal-field__label {
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 800;
}

.modal-field textarea {
  width: 100%;
  min-height: 80px;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
  resize: vertical;
  line-height: 1.6;
}

.modal-field textarea:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}

.modal-field__hint {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: right;
}

.modal-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgb(176 64 64 / 28%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-weight: 800;
  font-size: 0.9rem;
}

.modal-footer {
  display: flex;
  gap: 10px;
  padding: 0 22px 22px;
}

.modal-footer--actions {
  justify-content: stretch;
}

.modal-btn {
  flex: 1;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  font-weight: 900;
  cursor: pointer;
  transition: opacity 0.15s;
}

.modal-btn:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.modal-btn--primary {
  color: #fff;
  background: #103b31;
}

.modal-btn--approve {
  color: #fff;
  background: #103b31;
}

.modal-btn--reject {
  border: 1px solid rgb(143 45 45 / 28%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 72%);
}

@media (max-width: 1040px) {
  .submission-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 980px) {
  .review-header {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .submission-grid {
    grid-template-columns: 1fr;
  }

  .review-header {
    padding: 18px;
  }
}

@media (max-width: 720px) {
  .review-page {
    padding-block: 20px 42px;
  }
}
</style>
