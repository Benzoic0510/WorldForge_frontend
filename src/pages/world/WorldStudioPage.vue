<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createEntry, listEntries } from '@/api/entry'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import { getStoryGraph, createForkLine, createMergeLine, listApprovedStoryPushes } from '@/api/storyline'
import { useAuthStore } from '@/stores/auth'
import { buildPushGraph, pushGraphToVis } from '@/composables/useStoryGraphDag'
import type { EntryDetail, EntryListItem } from '@/types/entry'
import type { PushGraphData, SubmissionListItem } from '@/types/storyline'
import type { PageResponse, WorldDetail } from '@/types/world'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'

const route = useRoute()
const router = useRouter()

const worldId = computed(() => String(route.params.worldId || ''))
const activeView = computed(() => {
  const v = route.query.view
  return v === 'graph' ? 'graph' : 'entries'
})

// ── World ──
const world = ref<WorldDetail | null>(null)
const worldLoading = ref(true)
const worldError = ref('')

const canEditWorld = computed(() => world.value?.viewer.canEdit === true)

const auth = useAuthStore()
const isAuthenticated = computed(() => auth.isAuthenticated)
const isMember = computed(() => world.value?.viewer.role != null)
const canCreateFork = computed(() => isAuthenticated.value && isMember.value)
const canCreateMerge = computed(() => isMember.value)

// ── Entries ──
const entries = ref<EntryListItem[]>([])
const entriesLoading = ref(false)
const entriesLoadingMore = ref(false)
const entriesError = ref('')
const entriesAppendError = ref('')
const entriesPage = ref(1)
const entriesTotalPages = ref(0)
const searchKeyword = ref('')
const searchInput = ref('')
const hasSearchKeyword = computed(() => searchKeyword.value.length > 0)
const canLoadMoreEntries = computed(() => entriesPage.value < entriesTotalPages.value)

// ── Graph ──
const graphData = ref<PushGraphData | null>(null)
const graphLoading = ref(false)
const graphError = ref('')
const graphContainerRef = ref<HTMLElement | null>(null)
let network: Network | null = null

const selectedNodeId = ref<string | null>(null)
const selectedNode = computed(() => {
  if (!selectedNodeId.value || !graphData.value) return null
  return graphData.value.nodes.find(n => n.pushId === selectedNodeId.value) ?? null
})

const pushCount = computed(() =>
  graphData.value?.nodes.filter(n => !n.isHead).length ?? 0
)
const edgeCount = computed(() => graphData.value?.edges.length ?? 0)

// ── Create Entry Modal ──
const showCreateEntryForm = ref(false)
const entryForm = reactive({ title: '', content: '' })
const entryTags = ref<string[]>([])
const entryTagInput = ref('')
const entryFormError = ref('')
const entryFormSubmitting = ref(false)

function entryFormTagCount() {
  return entryTags.value.length
}

function entryFormCanAddTag() {
  return entryFormTagCount() < 10
}

function splitTagInput(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

function addEntryTag(value: string): string | null {
  const items = splitTagInput(value)
  if (items.length === 0) return null

  if (entryFormTagCount() >= 10) {
    return '标签不能超过 10 个。'
  }

  for (const item of items) {
    if (item.length > 20) return `标签"${item}"过长，不能超过 20 个字符。`
    if (entryTags.value.includes(item)) return `标签"${item}"重复，请勿重复添加。`
    entryTags.value.push(item)
  }
  return null
}

function commitEntryTagInput() {
  const error = addEntryTag(entryTagInput.value)
  if (error) {
    entryFormError.value = error
  } else {
    entryFormError.value = ''
  }
  entryTagInput.value = ''
}

function handleEntryTagKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    commitEntryTagInput()
  }
}

function removeEntryTag(tag: string) {
  entryTags.value = entryTags.value.filter(t => t !== tag)
}

function validateEntryForm(): string | null {
  const title = entryForm.title.trim()
  if (!title) return '请输入词条标题。'
  if (title.length > 100) return '词条标题不能超过 100 个字符。'

  const content = entryForm.content.trim()
  if (!content) return '请输入词条正文。'
  if (content.length > 100000) return '词条正文不能超过 100,000 个字符。'

  commitEntryTagInput()
  return null
}

async function handleCreateEntry() {
  entryFormError.value = ''
  const validationError = validateEntryForm()
  if (validationError) {
    entryFormError.value = validationError
    return
  }

  entryFormSubmitting.value = true
  try {
    await createEntry(worldId.value, {
      title: entryForm.title.trim(),
      content: entryForm.content.trim(),
      tags: entryTags.value
    })
    closeCreateEntryModal()
    await reloadEntries()
  } catch (error) {
    entryFormError.value = error instanceof ApiError ? error.message : '创建失败，请稍后重试。'
  } finally {
    entryFormSubmitting.value = false
  }
}

function openCreateEntryModal() {
  entryForm.title = ''
  entryForm.content = ''
  entryTags.value = []
  entryTagInput.value = ''
  entryFormError.value = ''
  showCreateEntryForm.value = true
}

function closeCreateEntryModal() {
  showCreateEntryForm.value = false
  entryFormError.value = ''
}

// ── World ──
async function loadWorld() {
  worldLoading.value = true
  worldError.value = ''
  try {
    world.value = await getWorldDetail(worldId.value)
  } catch (error) {
    world.value = null
    worldError.value = error instanceof ApiError ? error.message : '世界档案暂时无法加载，请稍后重试。'
  } finally {
    worldLoading.value = false
  }
}

// ── Entries ──
function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

async function fetchEntries(options: { append?: boolean } = {}) {
  const append = options.append === true

  if (append) {
    entriesLoadingMore.value = true
    entriesAppendError.value = ''
  } else {
    entriesLoading.value = true
    entriesError.value = ''
    entriesAppendError.value = ''
  }

  try {
    const data: PageResponse<EntryListItem> = await listEntries(worldId.value, {
      keyword: searchKeyword.value || undefined,
      page: entriesPage.value,
      pageSize: 12
    })

    entries.value = append ? entries.value.concat(data.items) : data.items
    entriesTotalPages.value = data.totalPages
    entriesError.value = ''
    entriesAppendError.value = ''
    return true
  } catch (error) {
    const message = error instanceof ApiError ? error.message : '词条列表暂时无法加载，请稍后重试。'
    if (append && entries.value.length > 0) {
      entriesAppendError.value = message
    } else {
      entriesError.value = message
    }
    return false
  } finally {
    entriesLoading.value = false
    entriesLoadingMore.value = false
  }
}

async function reloadEntries() {
  entriesPage.value = 1
  await fetchEntries()
}

async function submitSearch() {
  searchKeyword.value = searchInput.value.trim()
  await reloadEntries()
}

async function clearSearch() {
  searchInput.value = ''
  searchKeyword.value = ''
  await reloadEntries()
}

async function loadMoreEntries() {
  if (!canLoadMoreEntries.value || entriesLoadingMore.value) return

  const previousPage = entriesPage.value
  entriesPage.value += 1
  const loaded = await fetchEntries({ append: true })
  if (!loaded) {
    entriesPage.value = previousPage
  }
}

// ── Graph ──
const graphDirection = ref<'UD' | 'LR'>('UD')

function getVisOptions() {
  return {
    layout: {
      hierarchical: {
        enabled: true,
        direction: graphDirection.value,
        sortMethod: 'directed',
        levelSeparation: 160,
        nodeSpacing: 120,
        treeSpacing: 140,
        blockShifting: true,
        edgeMinimization: true,
        parentCentralization: true,
      },
    },
    physics: { enabled: false },
    edges: {
      smooth: {
        type: 'cubicBezier',
        forceDirection: graphDirection.value === 'UD' ? 'vertical' : 'horizontal',
        roundness: 0.4,
      },
      width: 2,
    },
    interaction: {
      dragNodes: true,
      hover: true,
      zoomView: true,
    },
  }
}

// ── Fork / Merge Modals ──
const showForkModal = ref(false)
const forkSubmitting = ref(false)
const forkError = ref('')
const forkParentLineId = ref('')
const forkBasedOnPushId = ref<string | null>(null)
const forkParentPushes = ref<SubmissionListItem[]>([])
const forkPushesLoading = ref(false)
const forkName = ref('')
const forkDescription = ref('')

const showMergeModal = ref(false)
const mergeSubmitting = ref(false)
const mergeError = ref('')
const mergeName = ref('')
const mergeDescription = ref('')
const mergeSelectedLineIds = ref<string[]>([])

const toastMessage = ref('')
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function uniqueLines(nodes: PushGraphData['nodes']) {
  const seen = new Map<string, { lineId: string; name: string; type: string }>()
  for (const n of nodes) {
    if (!seen.has(n.lineId)) {
      seen.set(n.lineId, { lineId: n.lineId, name: n.lineName, type: n.lineType })
    }
  }
  return Array.from(seen.values())
}

const forkParentLines = computed(() =>
  graphData.value?.nodes ? uniqueLines(graphData.value.nodes) : []
)
const mergeCandidateLines = computed(() =>
  graphData.value?.nodes ? uniqueLines(graphData.value.nodes) : []
)
const mergedParentLineIds = computed(() => {
  const ids = new Set<string>()
  for (const edge of graphData.value?.edges ?? []) {
    if (edge.edgeType === 'merge') {
      ids.add(edge.fromLineId)
    }
  }
  return ids
})
const mergeSelectionValid = computed(() =>
  mergeSelectedLineIds.value.length >= 2
  && mergeName.value.trim().length > 0
  && !mergeSelectedLineIds.value.some(lineId => !lineHasOwnPush(lineId))
)
const forkSelectionValid = computed(() =>
  Boolean(forkParentLineId.value && forkBasedOnPushId.value && forkName.value.trim().length > 0)
)

function formatNodeType(type: string): string {
  if (type === 'main') return '主线'
  if (type === 'fork') return '剧情分支'
  if (type === 'merge') return '合并'
  return type
}

function formatNodeTypeClass(type: string): string {
  if (type === 'main') return 'node-badge--main'
  if (type === 'fork') return 'node-badge--fork'
  if (type === 'merge') return 'node-badge--merge'
  return ''
}

function isMergedParentLine(lineId: string): boolean {
  return mergedParentLineIds.value.has(lineId)
}

function lineHasOwnPush(lineId: string): boolean {
  return graphData.value?.nodes.some(node => node.lineId === lineId && !node.isHead) === true
}

function openForkModal(parentLineId?: string, basedOnPushId?: string) {
  forkError.value = ''
  forkParentLineId.value = parentLineId ?? ''
  forkBasedOnPushId.value = basedOnPushId ?? null
  forkParentPushes.value = []
  forkName.value = ''
  forkDescription.value = ''
  showForkModal.value = true
}

async function fetchForkParentPushes() {
  if (!forkParentLineId.value) {
    forkParentPushes.value = []
    forkBasedOnPushId.value = null
    return
  }
  const preferredPushId = forkBasedOnPushId.value
  forkPushesLoading.value = true
  try {
    const approvedPushes = await listApprovedStoryPushes(worldId.value)
    const parentPushes = approvedPushes.filter(push => push.targetLineId === forkParentLineId.value)
    forkParentPushes.value = parentPushes
    const hasPreferredPush = preferredPushId != null
      && parentPushes.some(push => push.submissionId === preferredPushId)
    forkBasedOnPushId.value = hasPreferredPush
      ? preferredPushId
      : parentPushes[0]?.submissionId ?? null
  } catch {
    forkParentPushes.value = []
    forkBasedOnPushId.value = null
  } finally {
    forkPushesLoading.value = false
  }
}

watch(forkParentLineId, () => {
  fetchForkParentPushes()
})

async function submitFork() {
  const basedOnPushId = forkBasedOnPushId.value
  if (!forkParentLineId.value || !forkName.value.trim() || !basedOnPushId) {
    forkError.value = '请选择一个已批准的 Push 作为分支起点'
    return
  }
  forkSubmitting.value = true
  forkError.value = ''
  try {
    await createForkLine(worldId.value, {
      name: forkName.value.trim(),
      description: forkDescription.value.trim(),
      basedOnLineId: forkParentLineId.value,
      basedOnPushId,
    })
    showForkModal.value = false
    showToast('剧情分支创建成功')
    await loadGraph()
  } catch (error) {
    forkError.value = error instanceof ApiError ? error.message : '剧情分支创建失败，请稍后重试'
  } finally {
    forkSubmitting.value = false
  }
}

function openMergeModal() {
  mergeError.value = ''
  mergeName.value = ''
  mergeDescription.value = ''
  mergeSelectedLineIds.value = []
  showMergeModal.value = true
}

function toggleMergeSelection(lineId: string) {
  if (!lineHasOwnPush(lineId)) return
  const idx = mergeSelectedLineIds.value.indexOf(lineId)
  if (idx >= 0) {
    mergeSelectedLineIds.value.splice(idx, 1)
  } else {
    mergeSelectedLineIds.value.push(lineId)
  }
}

async function submitMerge() {
  if (!mergeName.value.trim() || mergeSelectedLineIds.value.length < 2) return
  mergeSubmitting.value = true
  mergeError.value = ''
  try {
    await createMergeLine(worldId.value, {
      name: mergeName.value.trim(),
      description: mergeDescription.value.trim(),
      parents: mergeSelectedLineIds.value.map(lineId => ({ lineId })),
    })
    showMergeModal.value = false
    showToast('合并剧情创建成功')
    await loadGraph()
  } catch (error) {
    mergeError.value = error instanceof ApiError ? error.message : '合并剧情创建失败，请稍后重试'
  } finally {
    mergeSubmitting.value = false
  }
}

function showToast(msg: string) {
  toastMessage.value = msg
  if (toastTimer.value) clearTimeout(toastTimer.value)
  toastTimer.value = setTimeout(() => { toastMessage.value = '' }, 5000)
}

function dismissToast() {
  toastMessage.value = ''
  if (toastTimer.value) clearTimeout(toastTimer.value)
}

function createNetwork(data: PushGraphData) {
  if (!graphContainerRef.value) return

  const { nodes, edges } = pushGraphToVis(data)

  network = new Network(
    graphContainerRef.value,
    { nodes: new DataSet(nodes as any), edges: new DataSet(edges as any) },
    getVisOptions() as any,
  )

  network.on('doubleClick', (params: any) => {
    if (params.nodes.length === 0) return
    const pushId = params.nodes[0] as string
    const pushNode = graphData.value?.nodes.find(n => n.pushId === pushId)
    if (!pushNode) return
    if (pushNode.isHead) {
      router.push({ name: 'line-content', params: { worldId: worldId.value, lineId: pushNode.lineId } })
    } else {
      router.push({ name: 'push-detail', params: { worldId: worldId.value, submissionId: pushId } })
    }
  })

  network.on('click', (params: any) => {
    if (params.nodes.length > 0) {
      selectedNodeId.value = params.nodes[0] as string
    } else {
      selectedNodeId.value = null
    }
  })
}

function destroyNetwork() {
  if (network) {
    network.destroy()
    network = null
  }
}

function zoomIn() {
  if (!network) return
  const scale = network.getScale()
  network.moveTo({ scale: scale * 1.3, animation: { duration: 300 } })
}

function zoomOut() {
  if (!network) return
  const scale = network.getScale()
  network.moveTo({ scale: scale / 1.3, animation: { duration: 300 } })
}

function fitToScreen() {
  if (!network) return
  network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
}

function toggleGraphDirection() {
  graphDirection.value = graphDirection.value === 'UD' ? 'LR' : 'UD'
}

async function loadGraph() {
  graphLoading.value = true
  graphError.value = ''
  try {
    const storyGraph = await getStoryGraph(worldId.value)
    if (storyGraph.nodes.length === 0) {
      graphData.value = { nodes: [], edges: [] }
      return
    }

    const approvedPushes: SubmissionListItem[] = await listApprovedStoryPushes(worldId.value)

    graphData.value = buildPushGraph(storyGraph, approvedPushes)
  } catch (error) {
    if (error instanceof ApiError) {
      graphError.value = error.message
    } else {
      graphError.value = '世界线图暂时不可用，请稍后重试。'
    }
  } finally {
    graphLoading.value = false
  }
}

// ── Init ──
async function init() {
  await loadWorld()
  if (worldError.value) return

  if (activeView.value === 'entries') {
    await fetchEntries()
  } else {
    await loadGraph()
  }
}

// ── View switching ──
function switchView(view: 'entries' | 'graph') {
  router.replace({ query: { view } })
}

// ── Graph reactions ──
watch(graphData, async (data) => {
  selectedNodeId.value = null
  if (!data) return
  await nextTick()
  await nextTick() // Extra tick to ensure v-show has taken effect and browser has laid out
  destroyNetwork()
  if (graphContainerRef.value && data.nodes.length > 0 && graphContainerRef.value.offsetHeight > 0) {
    createNetwork(data)
    nextTick(() => {
      network?.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
    })
  }
})

watch(graphDirection, () => {
  if (!graphData.value || graphData.value.nodes.length === 0) return
  destroyNetwork()
  if (graphContainerRef.value && graphContainerRef.value.offsetHeight > 0) {
    createNetwork(graphData.value)
    nextTick(() => {
      network?.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
    })
  }
})

watch(activeView, async (view) => {
  if (view === 'entries' && entries.value.length === 0 && !entriesLoading.value) {
    await fetchEntries()
  }
  if (view === 'graph' && !graphData.value && !graphLoading.value) {
    await loadGraph()
  }
})

watch(() => route.params.worldId, () => {
  entries.value = []
  searchInput.value = ''
  searchKeyword.value = ''
  destroyNetwork()
  graphData.value = null
  init()
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && showCreateEntryForm.value) {
    closeCreateEntryModal()
  }
}

onMounted(() => {
  init()
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  destroyNetwork()
  document.removeEventListener('keydown', handleKeydown)
  if (toastTimer.value) clearTimeout(toastTimer.value)
})
</script>

<template>
  <main class="studio-page">
    <!-- Loading -->
    <section v-if="worldLoading" class="studio-shell page-container">
      <div class="studio-state">
        <p>正在加载创作工作台...</p>
      </div>
    </section>

    <!-- World error -->
    <section v-else-if="worldError" class="studio-shell page-container">
      <div class="studio-state studio-state--error">
        <h1>世界档案暂时不可用</h1>
        <p>{{ worldError }}</p>
        <div class="studio-state__actions">
          <button type="button" class="studio-action studio-action--primary" @click="init">
            重新加载
          </button>
          <RouterLink class="studio-action" :to="{ name: 'world-detail', params: { worldId } }">
            返回世界详情
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- Content -->
    <section v-else class="studio-shell page-container">
      <nav class="studio-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          {{ world?.name }}
        </RouterLink>
        <span>/</span>
        <strong>创作工作台</strong>
      </nav>

      <!-- Header -->
      <header class="studio-header">
        <div>
          <p class="eyebrow">Creation Studio</p>
          <h1>创作工作台</h1>
        </div>
      </header>

      <!-- View toggle -->
      <div class="studio-view-row">
        <nav class="studio-view-toggle">
          <button
            type="button"
            class="view-toggle-btn"
            :class="{ 'view-toggle-btn--active': activeView === 'entries' }"
            @click="switchView('entries')"
          >
            词条管理
          </button>
          <button
            type="button"
            class="view-toggle-btn"
            :class="{ 'view-toggle-btn--active': activeView === 'graph' }"
            @click="switchView('graph')"
          >
            世界线图
          </button>
        </nav>
        <div class="view-toggle__actions">
          <button
            v-if="activeView === 'entries' && canEditWorld"
            type="button"
            class="studio-action studio-action--primary"
            @click="openCreateEntryModal"
          >
            新建词条
          </button>
          <template v-if="activeView === 'graph'">
            <RouterLink
              v-if="isMember"
              class="studio-action studio-action--primary"
              :to="{ name: 'submit-push', params: { worldId } }"
            >
              提交推送
            </RouterLink>
            <button
              v-if="canCreateFork"
              type="button"
              class="studio-action"
              @click="openForkModal()"
            >
              创建剧情分支
            </button>
            <button
              v-if="canCreateMerge"
              type="button"
              class="studio-action"
              @click="openMergeModal()"
            >
              合并剧情
            </button>
          </template>
        </div>
      </div>

      <!-- Entries view -->
      <template v-if="activeView === 'entries'">
        <!-- Search -->
        <form class="studio-search" role="search" @submit.prevent="submitSearch">
          <label class="search-field">
            <span>搜索词条</span>
            <input
              v-model="searchInput"
              maxlength="100"
              name="keyword"
              placeholder="输入标题、正文或标签"
              type="search"
            />
          </label>
          <div class="search-actions">
            <button class="search-btn search-btn--primary" type="submit">搜索</button>
            <button
              class="search-btn"
              type="button"
              :disabled="!hasSearchKeyword && !searchInput"
              @click="clearSearch"
            >
              清空
            </button>
          </div>
        </form>

        <div v-if="entriesLoading" class="studio-state">
          <p>正在整理词条目录...</p>
        </div>

        <div v-else-if="entriesError" class="studio-state studio-state--error">
          <h2>词条列表暂时不可用</h2>
          <p>{{ entriesError }}</p>
          <button type="button" class="studio-action studio-action--primary" @click="reloadEntries">
            重新加载
          </button>
        </div>

        <div v-else-if="entries.length === 0" class="studio-state studio-state--empty">
          <h2>{{ hasSearchKeyword ? '没有匹配词条' : '还没有词条' }}</h2>
          <p>
            {{
              hasSearchKeyword
                ? `没有找到包含"${searchKeyword}"的词条，可以换一个关键词再试。`
                : '这个世界还没有设定词条，可以先创建第一条核心档案。'
            }}
          </p>
          <button
            v-if="canEditWorld && !hasSearchKeyword"
            type="button"
            class="studio-action studio-action--primary"
            @click="openCreateEntryModal"
          >
            新建词条
          </button>
        </div>

        <div v-else class="entry-grid">
          <RouterLink
            v-for="entry in entries"
            :key="entry.entryId"
            class="entry-card"
            :to="{
              name: 'entry-detail',
              params: { worldId: entry.worldId, entryId: entry.entryId }
            }"
          >
            <div class="entry-card__meta">
              <span>{{ formatDate(entry.updatedAt) }}</span>
              <strong>打开档案</strong>
            </div>
            <h2>{{ entry.title }}</h2>
            <p>{{ entry.summary || '暂无摘要。' }}</p>
            <div class="tag-list" aria-label="标签">
              <span v-for="tag in entry.tags" :key="tag">{{ tag }}</span>
            </div>
          </RouterLink>
        </div>

        <div v-if="entriesAppendError" class="append-error-row" role="status">
          <span>{{ entriesAppendError }}</span>
          <button type="button" @click="loadMoreEntries">再试一次</button>
        </div>

        <div v-if="canLoadMoreEntries" class="load-more-row">
          <button
            type="button"
            class="studio-action studio-action--primary"
            :disabled="entriesLoadingMore"
            @click="loadMoreEntries"
          >
            {{ entriesLoadingMore ? '继续整理中...' : '加载更多词条' }}
          </button>
        </div>
      </template>

      <!-- Graph view -->
      <template v-if="activeView === 'graph'">
        <div v-if="graphLoading" class="studio-state">
          <p>正在加载世界线图...</p>
        </div>

        <div v-else-if="graphError" class="studio-state studio-state--error">
          <h2>世界线图暂时不可用</h2>
          <p>{{ graphError }}</p>
          <button type="button" class="studio-action studio-action--primary" @click="loadGraph">
            重新加载
          </button>
        </div>

        <div v-else-if="!graphData || graphData.nodes.length === 0" class="studio-state">
          <h2>还没有故事线</h2>
          <p>这个世界还没有创建任何故事线。</p>
        </div>

        <div v-else class="graph-section">
          <p class="graph-summary">
            {{ pushCount }} 个推送节点，{{ edgeCount }} 个连接
          </p>

          <div class="graph-layout">
            <div class="graph-canvas">
              <div
                v-show="graphData && graphData.nodes.length > 0 && !graphLoading && !graphError"
                ref="graphContainerRef"
                class="dag-container"
              ></div>

              <div class="graph-controls">
                <button type="button" class="graph-btn" :title="graphDirection === 'UD' ? '切换为横向' : '切换为纵向'" @click="toggleGraphDirection">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline v-if="graphDirection === 'UD'" points="5,4 8,1 11,4" />
                    <line v-if="graphDirection === 'UD'" x1="8" y1="1" x2="8" y2="11" />
                    <polyline v-if="graphDirection === 'UD'" points="5,12 8,15 11,12" />
                    <polyline v-if="graphDirection === 'LR'" points="4,5 1,8 4,11" />
                    <line v-if="graphDirection === 'LR'" x1="1" y1="8" x2="11" y2="8" />
                    <polyline v-if="graphDirection === 'LR'" points="12,5 15,8 12,11" />
                  </svg>
                </button>
                <button type="button" class="graph-btn" title="放大" @click="zoomIn">+</button>
                <button type="button" class="graph-btn" title="缩小" @click="zoomOut">&minus;</button>
                <button type="button" class="graph-btn" title="适应屏幕" @click="fitToScreen">&#8982;</button>
              </div>
            </div>

            <!-- Node detail panel -->
            <div v-if="selectedNode" class="node-detail-panel">
              <div class="node-detail__info">
                <p class="node-detail__title">
                  <template v-if="selectedNode.isHead">{{ selectedNode.lineName }}</template>
                  <template v-else>{{ selectedNode.title }}</template>
                </p>
                <p v-if="!selectedNode.isHead" class="node-detail__meta">
                  {{ selectedNode.lineName }}（{{ selectedNode.lineType === 'main' ? '主线' : selectedNode.lineType === 'fork' ? '剧情分支' : '合并' }}）· {{ selectedNode.authorNickname }}
                </p>
                <p v-else class="node-detail__meta">
                  {{ selectedNode.lineType === 'main' ? '主线' : selectedNode.lineType === 'fork' ? '剧情分支' : '合并' }}分支{{ selectedNode.isPlaceholder ? '（暂无推送）' : '' }}
                </p>
              </div>
              <div class="node-detail__actions">
                <button
                  v-if="isMember && !(selectedNode.isHead && selectedNode.isPlaceholder)"
                  type="button"
                  class="studio-action"
                  @click="openForkModal(selectedNode.lineId, selectedNode.isHead ? undefined : selectedNode.pushId)"
                >
                  从此创建剧情分支
                </button>
                <RouterLink
                  v-if="isMember && selectedNode.isHead && !isMergedParentLine(selectedNode.lineId)"
                  class="studio-action"
                  :to="{ name: 'submit-push', params: { worldId }, query: { lineId: selectedNode.lineId } }"
                >
                  提交 Push
                </RouterLink>
                <span
                  v-else-if="isMember && selectedNode.isHead && isMergedParentLine(selectedNode.lineId)"
                  class="studio-action studio-action--disabled"
                  title="该故事线已经被合并，不能再提交新的 Push"
                >
                  已合并
                </span>
                <RouterLink
                  v-if="selectedNode.isHead"
                  class="studio-action studio-action--primary"
                  :to="{ name: 'line-content', params: { worldId, lineId: selectedNode.lineId } }"
                >
                  进入故事线详情
                </RouterLink>
                <RouterLink
                  v-else
                  class="studio-action studio-action--primary"
                  :to="{ name: 'push-detail', params: { worldId, submissionId: selectedNode.pushId } }"
                >
                  进入推送详情
                </RouterLink>
                <button type="button" class="studio-action node-detail__close" @click="selectedNodeId = null">
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- Create Entry Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showCreateEntryForm" class="modal-overlay" @click.self="closeCreateEntryModal">
          <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-entry-title">
            <div class="modal-header">
              <h2 id="create-entry-title" class="modal-title">新建词条</h2>
              <button type="button" class="modal-close-btn" aria-label="关闭" @click="closeCreateEntryModal">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="3" x2="15" y2="15" /><line x1="15" y1="3" x2="3" y2="15" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <div class="form-grid">
                <!-- 标题 -->
                <label class="form-field">
                  <span class="form-label">词条标题</span>
                  <input
                    v-model="entryForm.title"
                    type="text"
                    maxlength="100"
                    placeholder="为设定档案命名"
                  />
                </label>

                <!-- 正文 -->
                <label class="form-field">
                  <span class="form-label">词条正文</span>
                  <textarea
                    v-model="entryForm.content"
                    maxlength="100000"
                    rows="8"
                    placeholder="描述世界观中的一个概念、地点、人物或事件..."
                  ></textarea>
                </label>

                <!-- 标签 -->
                <fieldset class="tag-editor">
                  <legend class="form-label">标签</legend>
                  <div class="tag-editor__chips">
                    <span v-for="tag in entryTags" :key="tag" class="tag-chip">
                      {{ tag }}
                      <button type="button" class="tag-chip__remove" :aria-label="`移除标签 ${tag}`" @click="removeEntryTag(tag)">&times;</button>
                    </span>
                  </div>
                  <input
                    v-if="entryFormCanAddTag()"
                    v-model="entryTagInput"
                    type="text"
                    class="tag-editor__input"
                    placeholder="输入标签后按回车添加（最多10个）"
                    maxlength="60"
                    @keydown="handleEntryTagKeydown"
                    @blur="commitEntryTagInput"
                  />
                </fieldset>
              </div>

              <p v-if="entryFormError" class="form-error" role="alert">{{ entryFormError }}</p>
            </div>

            <div class="modal-footer">
              <button type="button" class="cancel-btn" @click="closeCreateEntryModal">取消</button>
              <button
                type="button"
                class="submit-btn"
                :disabled="entryFormSubmitting"
                @click="handleCreateEntry"
              >
                <span v-if="entryFormSubmitting" class="spinner" aria-hidden="true"></span>
                {{ entryFormSubmitting ? '正在创建...' : '创建词条' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMessage" class="toast" role="alert">
          <span>{{ toastMessage }}</span>
          <button type="button" class="toast__close" aria-label="关闭" @click.stop="dismissToast">&times;</button>
        </div>
      </Transition>
    </Teleport>

    <!-- Fork Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showForkModal" class="modal-overlay" @click.self="showForkModal = false">
          <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="fork-modal-title">
            <div class="modal-header">
              <h2 id="fork-modal-title" class="modal-title">创建剧情分支</h2>
              <button type="button" class="modal-close-btn" aria-label="关闭" @click="showForkModal = false">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="3" x2="15" y2="15" /><line x1="15" y1="3" x2="3" y2="15" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <div v-if="forkError" class="form-error" role="alert">{{ forkError }}</div>

              <div class="form-grid">
                <label class="form-field">
                  <span class="form-label">父线</span>
                  <select v-model="forkParentLineId">
                    <option value="" disabled>选择父线</option>
                    <option v-for="line in forkParentLines" :key="line.lineId" :value="line.lineId">
                      {{ line.name }}（{{ formatNodeType(line.type) }}）
                    </option>
                  </select>
                </label>

                <label v-if="forkParentLineId" class="form-field">
                  <span class="form-label">基于推送（必选）</span>
                  <select v-model="forkBasedOnPushId">
                    <option :value="null" disabled>选择已批准的 Push</option>
                    <option
                      v-for="push in forkParentPushes"
                      :key="push.submissionId"
                      :value="push.submissionId"
                    >
                      {{ push.summary }}
                    </option>
                  </select>
                  <small v-if="forkPushesLoading" class="hint">加载推送列表中...</small>
                  <small v-else-if="forkParentLineId && forkParentPushes.length === 0 && !forkPushesLoading" class="hint">该线暂无已批准的 Push，暂不能创建分支</small>
                </label>

                <label class="form-field">
                  <span class="form-label">剧情分支名称</span>
                  <input v-model="forkName" type="text" maxlength="50" placeholder="输入剧情分支名称" />
                </label>

                <label class="form-field">
                  <span class="form-label">剧情分支描述（可选）</span>
                  <input v-model="forkDescription" type="text" maxlength="200" placeholder="输入剧情分支描述" />
                </label>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="cancel-btn" @click="showForkModal = false">取消</button>
              <button
                type="button"
                class="submit-btn"
                :disabled="forkSubmitting || !forkSelectionValid"
                @click="submitFork"
              >
                {{ forkSubmitting ? '创建中...' : '创建' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Merge Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showMergeModal" class="modal-overlay" @click.self="showMergeModal = false">
          <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="merge-modal-title">
            <div class="modal-header">
              <h2 id="merge-modal-title" class="modal-title">合并剧情</h2>
              <button type="button" class="modal-close-btn" aria-label="关闭" @click="showMergeModal = false">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="3" x2="15" y2="15" /><line x1="15" y1="3" x2="3" y2="15" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <div v-if="mergeError" class="form-error" role="alert">{{ mergeError }}</div>

              <div class="form-grid">
                <label class="form-field">
                  <span class="form-label">合并剧情名称</span>
                  <input v-model="mergeName" type="text" maxlength="50" placeholder="输入合并剧情名称" />
                </label>

                <label class="form-field">
                  <span class="form-label">合并剧情描述（可选）</span>
                  <input v-model="mergeDescription" type="text" maxlength="200" placeholder="输入合并剧情描述" />
                </label>

                <div class="form-field">
                  <span class="form-label">选择父线（至少 2 条）</span>
                  <ul class="merge-checkbox-list">
                    <li v-for="line in mergeCandidateLines" :key="line.lineId">
                      <label
                        class="merge-checkbox-item"
                        :class="{
                          'merge-checkbox-item--selected': mergeSelectedLineIds.includes(line.lineId),
                          'merge-checkbox-item--disabled': !lineHasOwnPush(line.lineId) || isMergedParentLine(line.lineId),
                        }"
                      >
                        <input
                          type="checkbox"
                          :value="line.lineId"
                          :checked="mergeSelectedLineIds.includes(line.lineId)"
                          :disabled="!lineHasOwnPush(line.lineId)"
                          @change="toggleMergeSelection(line.lineId)"
                        />
                        <span class="merge-checkbox-mark" aria-hidden="true"></span>
                        <span class="merge-line-main">
                          <span class="merge-line-title">{{ line.name }}</span>
                          <span :class="['node-badge', formatNodeTypeClass(line.type)]">
                            {{ formatNodeType(line.type) }}
                          </span>
                        </span>
                        <small v-if="!lineHasOwnPush(line.lineId)" class="merge-line-note">暂无 Push，不能合并</small>
                        <small v-if="isMergedParentLine(line.lineId)" class="merge-line-note">已合并，停止接收 Push</small>
                      </label>
                    </li>
                  </ul>
                  <p v-if="mergeSelectedLineIds.length < 2 && mergeSelectedLineIds.length > 0" class="hint">合并需要至少选择两条故事线</p>
                </div>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="cancel-btn" @click="showMergeModal = false">取消</button>
              <button
                type="button"
                class="submit-btn"
                :disabled="mergeSubmitting || !mergeSelectionValid"
                @click="submitMerge"
              >
                {{ mergeSubmitting ? '创建中...' : '创建' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.studio-page {
  padding-block: 28px 56px;
}

.studio-shell {
  display: grid;
  gap: 18px;
}

.studio-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.studio-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.studio-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.studio-state {
  display: grid;
  gap: 12px;
  min-height: 200px;
  padding: 32px;
  align-content: center;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 84%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.studio-state--error {
  background: rgb(108 36 36 / 6%);
}

.studio-state--empty {
  min-height: 200px;
  border-style: dashed;
  box-shadow: none;
}

.studio-state h1,
.studio-state h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.studio-state h1 {
  font-size: clamp(1.8rem, 3vw, 2.6rem);
}

.studio-state h2 {
  font-size: clamp(1.6rem, 2.5vw, 2.2rem);
}

.studio-state p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
}

.studio-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.studio-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font: inherit;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.studio-action--primary {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.studio-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

.studio-action--disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.studio-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.studio-header > div {
  flex: 1;
  min-width: 0;
}

.studio-header h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 1.04;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.studio-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* View toggle */
.studio-view-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.studio-view-toggle {
  display: inline-flex;
  padding: 4px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 58%);
  box-shadow: 0 14px 40px rgb(24 33 31 / 8%);
}

.view-toggle__actions {
  display: flex;
  gap: 8px;
}

.view-toggle-btn {
  min-width: 100px;
  min-height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 7px;
  color: var(--color-muted);
  background: transparent;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.view-toggle-btn--active {
  color: #fff;
  background: #103b31;
}

/* Search */
.studio-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
  padding: 16px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.search-field {
  display: grid;
  gap: 8px;
}

.search-field span {
  color: var(--color-muted);
  font-size: 0.86rem;
  font-weight: 900;
}

.search-field input {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
}

.search-field input:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}

.search-actions {
  display: flex;
  gap: 10px;
}

.search-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.search-btn--primary {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.search-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* Entry grid */
.entry-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.entry-card {
  display: grid;
  gap: 12px;
  min-height: 220px;
  padding: 18px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
  text-decoration: none;
  transition:
    border-color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.entry-card:hover {
  border-color: rgb(20 115 90 / 34%);
  transform: translateY(-2px);
  box-shadow: 0 18px 40px rgb(24 33 31 / 10%);
}

.entry-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.entry-card__meta strong {
  color: var(--color-accent);
  white-space: nowrap;
}

.entry-card h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.45rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.entry-card p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-list span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #305349;
  background: rgb(232 241 237 / 62%);
  font-size: 0.82rem;
  font-weight: 700;
}

.load-more-row {
  display: flex;
  justify-content: center;
}

.append-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgb(108 36 36 / 18%);
  border-radius: 8px;
  color: #6c2424;
  background: rgb(108 36 36 / 6%);
  font-size: 0.9rem;
  font-weight: 800;
}

.append-error-row button {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgb(108 36 36 / 24%);
  border-radius: 7px;
  color: #6c2424;
  background: rgb(255 255 255 / 68%);
  font-weight: 900;
  cursor: pointer;
}

/* Graph section */
.graph-section {
  display: grid;
  gap: 12px;
}

.graph-summary {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.88rem;
  font-weight: 800;
}

.graph-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;
}

.graph-canvas {
  position: relative;
  min-height: 500px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: #fafaf6;
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.dag-container {
  width: 100%;
  height: 560px;
}

.graph-controls {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  gap: 6px;
}

.graph-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
  font-size: 1rem;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 2px 8px rgb(24 33 31 / 10%);
}

.graph-btn:hover {
  background: #fff;
}

/* Node detail panel */
.node-detail-panel {
  width: 300px;
  align-self: start;
  display: grid;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid rgb(16 59 49 / 14%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.node-detail__info {
  display: grid;
  gap: 6px;
}

.node-detail__title {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 900;
  line-height: 1.3;
}

.node-detail__meta {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.node-detail__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.node-detail__close {
  border-color: var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
}

/* Responsive */
@media (max-width: 1040px) {
  .entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .studio-page {
    padding-block: 18px 40px;
  }

  .entry-grid {
    grid-template-columns: 1fr;
  }

  .studio-header {
    flex-direction: column;
  }

  .studio-search {
    grid-template-columns: 1fr;
  }

  .search-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .append-error-row {
    align-items: stretch;
    flex-direction: column;
  }
}

/* ─── Modal ───────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(24 33 31 / 50%);
  backdrop-filter: blur(4px);
}

.modal-card {
  width: 100%;
  max-width: 580px;
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 80px rgb(24 33 31 / 28%);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-line);
}

.modal-title {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 900;
}

.modal-close-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
}

.modal-close-btn:hover {
  background: rgb(16 59 49 / 6%);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--color-line);
}

/* Form inside modal */
.form-grid {
  display: grid;
  gap: 16px;
}

.form-field {
  display: grid;
  gap: 6px;
}

.form-label {
  color: var(--color-ink);
  font-size: 0.84rem;
  font-weight: 900;
}

.form-field input,
.form-field textarea {
  width: 100%;
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
  box-sizing: border-box;
}

.form-field input:focus,
.form-field textarea:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}

.form-field textarea {
  resize: vertical;
  min-height: 160px;
}

.tag-editor {
  display: grid;
  gap: 8px;
  padding: 0;
  border: 0;
}

.tag-editor__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #305349;
  background: rgb(232 241 237 / 62%);
  font-size: 0.82rem;
  font-weight: 700;
}

.tag-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #6c2424;
  background: transparent;
  font-size: 0.9rem;
  cursor: pointer;
  line-height: 1;
}

.tag-editor__input {
  min-height: 38px;
  padding: 6px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
  font-size: 0.9rem;
}

.form-error {
  margin: 14px 0 0;
  color: #6c2424;
  font-size: 0.86rem;
  font-weight: 800;
}

/* Buttons */
.cancel-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 20px;
  border: 1px solid #103b31;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.submit-btn:disabled {
  cursor: wait;
  opacity: 0.68;
}

.spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid rgb(255 255 255 / 30%);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 200ms ease;
}

.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition: transform 200ms ease, opacity 200ms ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-card {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

.modal-leave-to .modal-card {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

/* ─── Toast ───────────────────────────────────────────────── */
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  padding: 12px 20px;
  border-radius: 8px;
  background: #103b31;
  color: #fff;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 18%);
}

.toast__close {
  border: none;
  background: none;
  color: #fff;
  font-size: 1.2rem;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 240ms, transform 240ms;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

/* ─── Node Badges ─────────────────────────────────────────── */
.node-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  line-height: 1.4;
}

.node-badge--main {
  background: #103b31;
  color: #fff;
}

.node-badge--fork {
  background: rgb(20 115 90 / 10%);
  color: #14735a;
  border: 1px solid rgb(20 115 90 / 30%);
}

.node-badge--merge {
  background: rgb(180 132 44 / 10%);
  color: #b4842c;
  border: 1px dashed rgb(180 132 44 / 50%);
}

/* ─── Merge Modal Extras ──────────────────────────────────── */
.merge-checkbox-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}

.merge-checkbox-item {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 12px 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 78%);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.merge-checkbox-item:hover {
  border-color: rgb(20 115 90 / 34%);
  background: rgb(246 251 248 / 92%);
  box-shadow: 0 8px 20px rgb(17 54 45 / 8%);
}

.merge-checkbox-item--selected {
  border-color: rgb(20 115 90 / 46%);
  background: rgb(20 115 90 / 7%);
}

.merge-checkbox-item input[type="checkbox"] {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.merge-checkbox-mark {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 2px solid rgb(20 115 90 / 34%);
  border-radius: 5px;
  background: #fff;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.merge-checkbox-item--selected .merge-checkbox-mark {
  border-color: var(--color-accent);
  background: var(--color-accent);
}

.merge-checkbox-item--selected .merge-checkbox-mark::after {
  width: 9px;
  height: 5px;
  border-bottom: 2px solid #fff;
  border-left: 2px solid #fff;
  content: '';
  transform: rotate(-45deg) translate(1px, -1px);
}

.merge-checkbox-item--disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.merge-checkbox-item--disabled:hover {
  border-color: var(--color-line);
  background: rgb(255 255 255 / 78%);
  box-shadow: none;
}

.merge-line-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.merge-line-title {
  min-width: 0;
  overflow: hidden;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merge-line-main .node-badge {
  flex-shrink: 0;
}

.merge-line-note {
  justify-self: end;
  color: #8f2d2d;
  font-size: 0.76rem;
  font-weight: 800;
  white-space: nowrap;
}

.hint {
  color: var(--color-muted);
  font-size: 0.8rem;
}

/* ─── Form Select ─────────────────────────────────────────── */
.form-field select {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: #fff;
  font: inherit;
  box-sizing: border-box;
}

.form-field select:focus {
  border-color: var(--color-accent);
  outline: 0;
  box-shadow: var(--focus-ring);
}
</style>
