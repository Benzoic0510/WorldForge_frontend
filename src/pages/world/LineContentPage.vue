<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getStoryGraph, getStoryLineDetail, getStoryPushDetail, listApprovedStoryPushes } from '@/api/storyline'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import type { WorldDetail } from '@/types/world'
import type { StoryGraphData, StoryLineDetail, SubmissionListItem } from '@/types/storyline'

const route = useRoute()
const world = ref<WorldDetail | null>(null)
const storyLine = ref<StoryLineDetail | null>(null)
const storyGraphData = ref<StoryGraphData | null>(null)
const pushes = ref<SubmissionListItem[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const appendError = ref('')
const errorMessage = ref('')
const page = ref(1)
const totalPages = ref(0)
const allLinePushes = ref<SubmissionListItem[]>([])
const pushContentErrors = ref<Record<string, string>>({})

const worldId = computed(() => String(route.params.worldId || ''))
const lineId = computed(() => String(route.params.lineId || ''))
const canEditWorld = computed(() => world.value?.viewer.canEdit === true)
const canLoadMore = computed(() => page.value < totalPages.value)
const lineCreatorName = computed(() => {
  const creatorId = storyLine.value?.createdBy?.trim() ?? ''
  if (!creatorId) return ''
  if (creatorId === world.value?.creator.userId) {
    return world.value.creator.nickname
  }
  if (/^usr_[\w-]+$/i.test(creatorId)) {
    return ''
  }
  return creatorId
})
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
const isCurrentLineMerged = computed(() => mergedParentLineIds.value.has(lineId.value))

function formatDateTime(dt: string): string {
  if (!dt) return ''
  return dt.replace('T', ' ').substring(0, 16)
}

function formatLineType(type: string): string {
  if (type === 'main') return '主'
  if (type === 'fork') return '分'
  if (type === 'merge') return '合'
  return type
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function getPushContent(push: SubmissionListItem): string {
  return push.content ?? ''
}

function hasPushContent(push: SubmissionListItem): boolean {
  return getPushContent(push).trim().length > 0
}

async function hydratePushContents(items: SubmissionListItem[]): Promise<SubmissionListItem[]> {
  const hydratedItems = await Promise.all(
    items.map(async push => {
      if (hasPushContent(push)) {
        return push
      }

      try {
        const detail = await getStoryPushDetail(worldId.value, push.submissionId)
        return { ...push, content: detail.content }
      } catch (error) {
        pushContentErrors.value = {
          ...pushContentErrors.value,
          [push.submissionId]: getErrorMessage(error, '正文内容暂时无法加载')
        }
        return push
      }
    })
  )

  return hydratedItems
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  allLinePushes.value = []
  pushContentErrors.value = {}

  try {
    world.value = await getWorldDetail(worldId.value)
  } catch (error) {
    world.value = null
    errorMessage.value = getErrorMessage(error, '世界档案暂时无法加载，请稍后重试。')
    loading.value = false
    return
  }

  try {
    storyLine.value = await getStoryLineDetail(lineId.value)
  } catch (error) {
    storyLine.value = null
    errorMessage.value = getErrorMessage(error, '故事线档案暂时无法加载，请稍后重试。')
    loading.value = false
    return
  }

  try {
    storyGraphData.value = await getStoryGraph(worldId.value)
  } catch {
    storyGraphData.value = null
  }

  await fetchPushes()
}

async function fetchPushes(options: { append?: boolean } = {}) {
  const append = options.append === true
  if (append) {
    loadingMore.value = true
    appendError.value = ''
  } else {
    loading.value = true
    page.value = 1
  }

  try {
    if (!append || allLinePushes.value.length === 0) {
      const approvedPushes = await listApprovedStoryPushes(worldId.value)
      allLinePushes.value = approvedPushes.filter(push => push.targetLineId === lineId.value)
    }
    const pageSize = 20
    const start = (page.value - 1) * pageSize
    const dataItems = await hydratePushContents(allLinePushes.value.slice(start, start + pageSize))

    if (append) {
      pushes.value = pushes.value.concat(dataItems)
    } else {
      pushes.value = dataItems
    }
    totalPages.value = allLinePushes.value.length === 0 ? 0 : Math.ceil(allLinePushes.value.length / pageSize)
  } catch (error) {
    if (append) {
      appendError.value = getErrorMessage(error, '加载更多失败')
    } else {
      errorMessage.value = getErrorMessage(error, '故事线内容暂时无法加载，请稍后重试。')
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function handleLoadMore() {
  if (!canLoadMore.value || loadingMore.value) return
  page.value += 1
  await fetchPushes({ append: true })
}

onMounted(async () => {
  await loadData()
})
</script>

<template>
  <main class="line-content-page">
    <section v-if="loading" class="line-shell page-container">
      <div class="line-state">
        <p>正在读取故事线档案...</p>
      </div>
    </section>

    <section v-else-if="!world || !storyLine" class="line-shell page-container">
      <div class="line-state line-state--error">
        <h1>故事线档案暂时不可用</h1>
        <p>{{ errorMessage || '请回到世界详情页后重试。' }}</p>
        <div class="state-actions">
          <RouterLink
            class="state-button state-button--primary"
            :to="{ name: 'world-detail', params: { worldId } }"
          >
            返回世界详情
          </RouterLink>
          <button type="button" class="state-button" @click="loadData">重新加载</button>
        </div>
      </div>
    </section>

    <section v-else class="line-shell page-container">
      <nav class="line-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          {{ world.name }}
        </RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }">
          故事线树图
        </RouterLink>
        <span>/</span>
        <strong>{{ storyLine.name }}</strong>
      </nav>

      <header class="line-header">
        <div class="line-header__main">
          <p class="eyebrow">Story Line</p>
          <h1>{{ storyLine.name }}</h1>
          <p v-if="storyLine.description" class="line-header__desc">{{ storyLine.description }}</p>
          <div class="line-header__meta">
            <span class="line-type-badge" :class="`line-type-badge--${storyLine.type}`">
              {{ formatLineType(storyLine.type) }}线
            </span>
            <span v-if="lineCreatorName">{{ lineCreatorName }}</span>
            <span>{{ formatDateTime(storyLine.createdAt) }}</span>
          </div>
        </div>
        <div class="line-header__actions">
          <RouterLink
            class="panel-action"
            :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }"
          >
            返回树图
          </RouterLink>
          <RouterLink
            v-if="canEditWorld && !isCurrentLineMerged"
            class="panel-action"
            :to="{ name: 'submit-push', params: { worldId }, query: { lineId } }"
          >
            提交 Push
          </RouterLink>
          <span
            v-else-if="canEditWorld && isCurrentLineMerged"
            class="panel-action panel-action--disabled"
            title="该故事线已经被合并，不能再提交新的 Push"
          >
            已合并，停止接收 Push
          </span>
        </div>
      </header>

      <template v-if="pushes.length === 0">
        <div class="line-state line-state--empty">
          <h2>还没有已审核的内容</h2>
          <p>这条故事线上暂无已审核发布的内容。协作者提交的 Push 审核通过后将出现在这里。</p>
        </div>
      </template>

      <template v-else>
        <div class="timeline">
          <div
            v-for="push in pushes"
            :key="push.submissionId"
            class="timeline-item"
          >
            <div class="timeline-marker" :class="`timeline-marker--${storyLine.type}`"></div>
            <div class="timeline-card">
              <h3 class="timeline-card__title">{{ push.summary }}</h3>
              <div class="timeline-card__meta">
                <span class="timeline-card__author">{{ push.submitter.nickname }}</span>
                <span class="timeline-card__time">{{ formatDateTime(push.submittedAt) }}</span>
              </div>
              <div v-if="hasPushContent(push)" class="timeline-card__content" v-text="getPushContent(push)"></div>
              <div v-else class="timeline-card__placeholder">
                <span class="placeholder-icon">&#128214;</span>
                <span>{{ pushContentErrors[push.submissionId] || '正文内容为空' }}</span>
              </div>
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
  </main>
</template>

<style scoped>
.line-content-page {
  padding-block: 28px 56px;
}

.line-shell {
  display: grid;
  gap: 18px;
}

.line-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.line-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.line-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.line-state,
.line-header {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.line-state {
  display: grid;
  gap: 12px;
  min-height: 220px;
  padding: 32px;
  align-content: center;
}

.line-state--error {
  background: rgb(108 36 36 / 6%);
}

.line-state h1,
.line-state h2,
.line-state p,
.line-header h1,
.line-header__desc {
  margin: 0;
}

.line-state h1,
.line-state h2,
.line-header h1 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.line-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.line-state h2 {
  font-size: 1.6rem;
}

.line-state p,
.line-header__desc {
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

.line-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: start;
  padding: 28px;
}

.line-header__main {
  display: grid;
  gap: 12px;
}

.eyebrow {
  margin: 0;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.line-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.4rem);
  line-height: 1.03;
}

.line-header__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  color: var(--color-muted);
  font-size: 0.88rem;
  font-weight: 800;
}

.line-type-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  color: #fff;
  background: #103b31;
  font-size: 0.78rem;
  font-weight: 900;
}

.line-type-badge--fork {
  color: #e8f1ed;
  background: #305349;
}

.line-type-badge--merge {
  color: #faf5e8;
  background: #6c5b24;
}

.line-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.panel-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.panel-action--disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

/* Timeline */
.timeline {
  position: relative;
  display: grid;
  gap: 0;
}

.timeline::before {
  content: '';
  position: absolute;
  top: 35px;
  bottom: 35px;
  left: 11px;
  width: 2px;
  background: rgb(16 59 49 / 14%);
}

.timeline-item {
  position: relative;
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 16px;
}

.timeline-marker {
  position: relative;
  z-index: 1;
  width: 14px;
  height: 14px;
  margin-top: 28px;
  margin-left: 5px;
  border-radius: 50%;
  background: #103b31;
  flex-shrink: 0;
}

.timeline-marker--fork {
  background: #305349;
}

.timeline-marker--merge {
  background: #6c5b24;
}

.timeline-card {
  display: grid;
  gap: 12px;
  padding: 22px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
  margin-bottom: 20px;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.timeline-card:hover {
  transform: translateY(-1px);
  border-color: rgb(16 59 49 / 24%);
  box-shadow: 0 12px 36px rgb(24 33 31 / 12%);
}

.timeline-card__title {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.3rem;
  line-height: 1.25;
}

.timeline-card__meta {
  display: flex;
  gap: 14px;
  color: var(--color-muted);
  font-size: 0.84rem;
  font-weight: 800;
}

.timeline-card__author {
  color: var(--color-ink);
}

.timeline-card__content {
  white-space: pre-wrap;
  color: var(--color-ink);
  font-size: 0.98rem;
  line-height: 1.85;
}

.timeline-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 120px;
  border: 2px dashed rgb(16 59 49 / 14%);
  border-radius: 8px;
  background: rgb(244 240 231 / 42%);
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 800;
}

.placeholder-icon {
  font-size: 1.3rem;
  opacity: 0.6;
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

@media (max-width: 980px) {
  .line-header {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .line-content-page {
    padding-block: 20px 42px;
  }

  .line-header {
    padding: 20px;
  }
}
</style>
