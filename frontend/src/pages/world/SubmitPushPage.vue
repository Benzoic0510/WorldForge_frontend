<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getStoryGraph, submitStoryPush } from '@/api/storyline'
import { saveDraft } from '@/api/draft'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import type { WorldDetail } from '@/types/world'
import type { StoryGraphData, StoryGraphNode, SubmitStoryPushResponse } from '@/types/storyline'

const route = useRoute()
const router = useRouter()
const world = ref<WorldDetail | null>(null)
const loading = ref(true)
const isSubmitting = ref(false)
const errorMessage = ref('')
const storyGraphData = ref<StoryGraphData | null>(null)
const successResult = ref<SubmitStoryPushResponse | null>(null)
const form = reactive({
  targetLineId: '',
  title: '',
  content: '',
  summary: ''
})

const worldId = computed(() => String(route.params.worldId || ''))
const trimmedTitle = computed(() => form.title.trim())
const trimmedContent = computed(() => form.content.trim())
const trimmedSummary = computed(() => form.summary.trim())
const canEditWorld = computed(() => world.value?.viewer.canEdit === true)
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
const selectedTargetLineIsMerged = computed(() =>
  form.targetLineId ? isMergedParentLine(form.targetLineId) : false
)

const sortedNodes = computed<StoryGraphNode[]>(() => {
  if (!storyGraphData.value) return []
  const typeOrder: Record<string, number> = { main: 0, fork: 1, merge: 2 }
  return [...storyGraphData.value.nodes].sort(
    (a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3)
  )
})

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function formatLineType(type: string): string {
  if (type === 'main') return '主'
  if (type === 'fork') return '分'
  if (type === 'merge') return '合'
  return type
}

function isMergedParentLine(lineId: string): boolean {
  return mergedParentLineIds.value.has(lineId)
}

function validateForm() {
  if (!form.targetLineId) {
    return '请选择目标故事线'
  }
  if (isMergedParentLine(form.targetLineId)) {
    return '这条故事线已经被合并，不能再提交新的 Push'
  }
  if (!trimmedTitle.value) {
    return '请输入草稿标题'
  }
  if (trimmedTitle.value.length > 100) {
    return '草稿标题最多 100 个字符'
  }
  if (!trimmedContent.value) {
    return '请输入草稿正文'
  }
  if (trimmedContent.value.length > 100000) {
    return '草稿正文最多 100000 个字符'
  }
  if (!trimmedSummary.value) {
    return '请输入提交摘要'
  }
  if (trimmedSummary.value.length > 200) {
    return '提交摘要最多 200 个字符'
  }
  return ''
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
    const preSelected = String(route.query.lineId || '')
    if (preSelected && storyGraphData.value.nodes.some(n => n.lineId === preSelected) && !isMergedParentLine(preSelected)) {
      form.targetLineId = preSelected
    } else if (preSelected && isMergedParentLine(preSelected)) {
      errorMessage.value = '这条故事线已经被合并，不能再提交新的 Push'
    }
  } catch {
    storyGraphData.value = null
  }

  loading.value = false
}

async function handleSubmit() {
  errorMessage.value = ''

  const validationMessage = validateForm()
  if (validationMessage) {
    errorMessage.value = validationMessage
    return
  }

  isSubmitting.value = true
  try {
    const draft = await saveDraft(worldId.value, 'new', {
      title: trimmedTitle.value,
      contentType: 'storyline',
      content: trimmedContent.value,
      targetLineId: form.targetLineId
    })

    const result = await submitStoryPush(worldId.value, {
      draftId: draft.draftId,
      targetLineId: form.targetLineId,
      summary: trimmedSummary.value,
      isNewBranch: false
    })

    successResult.value = result
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '提交暂时无法完成，请稍后重试。')
  } finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  await loadWorld()
})
</script>

<template>
  <main class="submit-push-page">
    <section v-if="loading" class="push-shell page-container">
      <div class="push-state">
        <p>正在读取世界线结构...</p>
      </div>
    </section>

    <section v-else-if="!world || !canEditWorld" class="push-shell page-container">
      <div class="push-state push-state--error">
        <h1>{{ world ? '你当前无法编辑这个世界' : '世界档案暂时不可用' }}</h1>
        <p>{{ errorMessage || '请回到世界详情页确认权限后再试。' }}</p>
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

    <section v-else-if="successResult" class="push-shell page-container">
      <div class="push-state">
        <h1>提交成功</h1>
        <p>你的草稿已提交至目标故事线，等待审核。审核通过后内容将合并到世界线中。</p>
        <div class="push-result-detail">
          <span>提交编号：{{ successResult.submissionId }}</span>
          <span>目标故事线：{{ successResult.targetLineId }}</span>
          <span>状态：待审核</span>
          <span>提交时间：{{ successResult.submittedAt }}</span>
        </div>
        <div class="state-actions">
          <RouterLink
            class="state-button state-button--primary"
            :to="{ name: 'world-detail', params: { worldId } }"
          >
            返回世界详情
          </RouterLink>
        </div>
      </div>
    </section>

    <section v-else class="push-shell page-container">
      <nav class="push-breadcrumb" aria-label="页面路径">
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
        <strong>提交 Push</strong>
      </nav>

      <header class="push-header">
        <div>
          <p class="eyebrow">Push Submission</p>
          <h1>向故事线提交草稿</h1>
        </div>
        <p>将你的创作内容推送到目标故事线，经审核后合入世界线主干。</p>
      </header>

      <div class="push-layout">
        <form class="push-form" @submit.prevent="handleSubmit">
          <section class="form-panel">
            <div class="panel-heading">
              <p class="eyebrow">Target</p>
              <h2>目标故事线</h2>
            </div>

            <label class="field-block">
              <span class="field-label">选择目标故事线</span>
              <select v-model="form.targetLineId">
                <option value="" disabled>-- 请选择故事线 --</option>
                <option
                  v-for="node in sortedNodes"
                  :key="node.lineId"
                  :value="node.lineId"
                  :disabled="isMergedParentLine(node.lineId)"
                >
                  [{{ formatLineType(node.type) }}] {{ node.name }}{{ isMergedParentLine(node.lineId) ? '（已合并，停止接收 Push）' : '' }}
                </option>
              </select>
              <span v-if="selectedTargetLineIsMerged" class="field-hint field-hint--error">
                该故事线已经被合并，不能再提交新的 Push。
              </span>
            </label>
          </section>

          <section class="form-panel">
            <div class="panel-heading">
              <p class="eyebrow">Draft</p>
              <h2>草稿内容</h2>
            </div>

            <label class="field-block">
              <span class="field-label">标题</span>
              <input
                v-model="form.title"
                autocomplete="off"
                name="title"
                placeholder="例如：新增角色设定"
                maxlength="100"
                type="text"
              >
            </label>

            <label class="field-block">
              <span class="field-label">正文</span>
              <textarea
                v-model="form.content"
                name="content"
                placeholder="写下你希望提交到这条故事线的内容..."
                rows="12"
                maxlength="100000"
              ></textarea>
            </label>
          </section>

          <section class="form-panel">
            <div class="panel-heading">
              <p class="eyebrow">Summary</p>
              <h2>提交摘要</h2>
            </div>

            <label class="field-block">
              <span class="field-label">摘要说明</span>
              <textarea
                v-model="form.summary"
                name="summary"
                placeholder="简要说明本次提交的内容和目的，供审核者参考。"
                rows="3"
                maxlength="200"
              ></textarea>
              <span class="field-hint">{{ trimmedSummary.length }} / 200</span>
            </label>
          </section>

          <p v-if="errorMessage" class="form-message" role="alert">{{ errorMessage }}</p>

          <div class="submit-row">
            <button class="submit-button" type="submit" :disabled="isSubmitting || selectedTargetLineIsMerged">
              {{ isSubmitting ? '正在提交...' : '提交 Push' }}
            </button>
            <RouterLink
              class="cancel-link"
              :to="{ name: 'world-detail', params: { worldId } }"
            >
              取消
            </RouterLink>
          </div>
        </form>

        <aside class="push-sidebar">
          <section class="info-panel">
            <p class="eyebrow">World</p>
            <strong>{{ world.name }}</strong>
            <span v-if="storyGraphData">{{ storyGraphData.nodes.length }} 条故事线</span>
            <span v-if="world.viewer.role" class="role-badge">你的权限：{{ world.viewer.role === 'creator' ? '创建者' : world.viewer.role === 'co_admin' ? '共同管理员' : '协作者' }}</span>
          </section>

          <section class="info-panel">
            <p class="eyebrow">Guide</p>
            <h3>如何提交 Push？</h3>
            <ul>
              <li>选择一条目标故事线作为内容合并的目标。</li>
              <li>编写草稿内容——标题和正文，正文支持 Markdown。</li>
              <li>填写摘要说明，让审核者快速了解你的改动。</li>
              <li>提交后，草稿进入"待审核"状态，由创作者或管理员审核。</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.submit-push-page {
  padding-block: 28px 56px;
}

.push-shell {
  display: grid;
  gap: 18px;
}

.push-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.push-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.push-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.push-state,
.push-header,
.form-panel,
.info-panel {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.push-state {
  display: grid;
  gap: 16px;
  min-height: 320px;
  padding: 32px;
  align-content: center;
}

.push-state--error {
  background: rgb(108 36 36 / 6%);
}

.push-state h1,
.push-state p,
.push-header h1,
.push-header p,
.panel-heading h2 {
  margin: 0;
}

.push-state h1,
.push-header h1,
.panel-heading h2 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.push-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.push-state p,
.push-header p {
  color: var(--color-muted);
  line-height: 1.75;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.state-button,
.submit-button,
.cancel-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 8px;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.state-button,
.cancel-link {
  border: 1px solid var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
}

.state-button--primary,
.submit-button {
  border: 0;
  color: #fff;
  background: #103b31;
}

.submit-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.push-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr);
  gap: 18px;
  align-items: end;
  padding: 24px;
}

.push-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.4rem);
  line-height: 1.03;
}

.push-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 0.42fr);
  gap: 18px;
  align-items: start;
}

.push-form,
.push-sidebar {
  display: grid;
  gap: 18px;
}

.push-sidebar {
  position: sticky;
  top: calc(var(--nav-height) + 18px);
}

.form-panel,
.info-panel {
  padding: 22px;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.panel-heading {
  margin-bottom: 20px;
}

.field-block {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.field-block:first-of-type {
  margin-top: 0;
}

.field-label {
  color: var(--color-muted);
  font-size: 0.92rem;
  font-weight: 800;
}

.field-hint {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-align: right;
}

.field-hint--error {
  color: #8f2d2d;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
}

input,
select {
  min-height: 44px;
  padding: 0 12px;
}

textarea {
  min-height: 270px;
  resize: vertical;
  padding: 12px;
  line-height: 1.75;
}

select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2314735a' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

input:focus,
textarea:focus,
select:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}

.form-message {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgb(176 64 64 / 28%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-weight: 800;
}

.submit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.push-result-detail {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 42%);
}

.push-result-detail span {
  color: var(--color-muted);
  font-size: 0.9rem;
  font-weight: 800;
}

.info-panel {
  display: grid;
  gap: 8px;
}

.info-panel strong {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.7rem;
  line-height: 1.12;
}

.info-panel span {
  color: var(--color-muted);
  font-weight: 800;
}

.info-panel h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.2rem;
}

.info-panel ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  color: var(--color-muted);
  font-size: 0.9rem;
  line-height: 1.6;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #14735a;
  background: rgb(232 241 237 / 62%);
  font-size: 0.78rem;
  font-weight: 800;
  width: fit-content;
}

@media (max-width: 980px) {
  .push-header,
  .push-layout {
    grid-template-columns: 1fr;
  }

  .push-sidebar {
    position: static;
  }
}

@media (max-width: 720px) {
  .submit-push-page {
    padding-block: 20px 42px;
  }

  .push-header,
  .form-panel,
  .info-panel {
    padding: 18px;
  }

  .submit-row,
  .submit-button,
  .cancel-link {
    width: 100%;
  }
}
</style>
