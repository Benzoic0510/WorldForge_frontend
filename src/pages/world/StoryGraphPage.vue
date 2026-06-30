<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getWorldDetail } from '@/api/world'
import { getStoryGraph, createForkLine, createMergeLine, listApprovedStoryPushes } from '@/api/storyline'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import type { WorldDetail } from '@/types/world'
import type { PushGraphNode, PushGraphData, SubmissionListItem } from '@/types/storyline'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { buildPushGraph, pushGraphToVis } from '@/composables/useStoryGraphDag'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isAuthenticated = computed(() => auth.isAuthenticated)

const worldId = computed(() => String(route.params.worldId || ''))

const world = ref<WorldDetail | null>(null)
const graphData = ref<PushGraphData | null>(null)

const loading = ref(true)
const errorCode = ref('')
const errorMessage = ref('')
const graphLoading = ref(false)
const graphError = ref('')

const selectedPushId = ref<string | null>(null)
const selectedDetail = ref<PushGraphNode | null>(null)
const detailLoading = ref(false)

const toastMessage = ref('')
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const canCreateFork = computed(() => isAuthenticated.value && world.value?.viewer.role != null)
const canCreateMerge = computed(() => isMember.value)
const isMember = computed(() => world.value?.viewer.role != null)

const hasDetailPanel = computed(() => selectedDetail.value != null)

// --- DAG Canvas ---
const graphContainerRef = ref<HTMLElement | null>(null)
let network: Network | null = null

// --- Context Menu ---
const showContextMenu = ref(false)
const contextMenuPushId = ref('')
const contextMenuPushLineId = ref('')
const contextMenuPos = ref({ x: 0, y: 0 })

const contextMenuStyle = computed(() => ({
  left: contextMenuPos.value.x + 'px',
  top: contextMenuPos.value.y + 'px',
}))

// --- Fork Modal ---
const showForkModal = ref(false)
const forkSubmitting = ref(false)
const forkError = ref('')
const forkParentLineId = ref('')
const forkBasedOnPushId = ref<string | null>(null)
const forkParentPushes = ref<SubmissionListItem[]>([])
const forkPushesLoading = ref(false)
const forkName = ref('')
const forkDescription = ref('')

// --- Merge Modal ---
const showMergeModal = ref(false)
const mergeSubmitting = ref(false)
const mergeError = ref('')
const mergeName = ref('')
const mergeDescription = ref('')
const mergeSelectedLineIds = ref<string[]>([])

function uniqueLines(nodes: PushGraphNode[]) {
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

// --- Utility ---
function formatNodeType(type: string): string {
  if (type === 'main') return '主线'
  if (type === 'fork') return '分叉'
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

// --- Loading ---
async function loadWorld() {
  try {
    world.value = await getWorldDetail(worldId.value)
  } catch (error) {
    if (error instanceof ApiError) {
      errorCode.value = error.code
      errorMessage.value = error.message
    } else {
      errorCode.value = 'UNKNOWN'
      errorMessage.value = '暂时无法加载，请稍后重试'
    }
  }
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
      graphError.value = '世界线图暂时不可用，请稍后重试'
    }
  } finally {
    graphLoading.value = false
  }
}

// --- DAG rendering ---
const VIS_OPTIONS = {
  layout: {
    hierarchical: {
      enabled: true,
      direction: 'UD',
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
      forceDirection: 'vertical',
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

function createNetwork(data: PushGraphData) {
  if (!graphContainerRef.value) return

  const { nodes, edges } = pushGraphToVis(data)

  network = new Network(
    graphContainerRef.value,
    { nodes: new DataSet(nodes as any), edges: new DataSet(edges as any) },
    VIS_OPTIONS as any,
  )

  network.on('click', (params: any) => {
    if (params.nodes.length === 0) {
      if (params.event?.srcEvent?.ctrlKey || params.event?.srcEvent?.metaKey) return
      selectedPushId.value = null
      selectedDetail.value = null
      showContextMenu.value = false
      return
    }

    const pushId = params.nodes[0] as string
    showContextMenu.value = false
    handleNodeClick(pushId)
  })

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

  network.on('oncontext', (params: any) => {
    params.event.preventDefault()
    if (params.nodes.length === 0) {
      showContextMenu.value = false
      return
    }

    const pushId = params.nodes[0] as string
    const pushNode = graphData.value?.nodes.find(n => n.pushId === pushId)
    const canvasPos = network!.DOMtoCanvas({
      x: params.event.clientX,
      y: params.event.clientY,
    })
    contextMenuPushId.value = pushId
    contextMenuPushLineId.value = pushNode?.lineId ?? ''
    contextMenuPos.value = { x: canvasPos.x, y: canvasPos.y }
    showContextMenu.value = true
  })

  network.on('click', () => {
    showContextMenu.value = false
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

// --- Node click ---
function handleNodeClick(pushId: string) {
  if (selectedPushId.value === pushId) {
    selectedPushId.value = null
    selectedDetail.value = null
    return
  }

  selectedPushId.value = pushId
  detailLoading.value = true
  const pushNode = graphData.value?.nodes.find(n => n.pushId === pushId) ?? null
  selectedDetail.value = pushNode
  detailLoading.value = false
}

// --- Fork ---
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
    forkError.value = '请选择一个已批准的 Push 作为分叉起点'
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
    showToast('分叉创建成功')
    await loadGraph()
  } catch (error) {
    forkError.value = error instanceof ApiError ? error.message : '分叉创建失败，请稍后重试'
  } finally {
    forkSubmitting.value = false
  }
}

// --- Merge ---
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
    showToast('合并线创建成功')
    await loadGraph()
  } catch (error) {
    mergeError.value = error instanceof ApiError ? error.message : '合并线创建失败，请稍后重试'
  } finally {
    mergeSubmitting.value = false
  }
}

// --- Context menu ---
function onContextFork() {
  showContextMenu.value = false
  openForkModal(contextMenuPushLineId.value, contextMenuPushId.value)
}

// --- Toast ---
function showToast(msg: string) {
  toastMessage.value = msg
  if (toastTimer.value) clearTimeout(toastTimer.value)
  toastTimer.value = setTimeout(() => { toastMessage.value = '' }, 5000)
}

function dismissToast() {
  toastMessage.value = ''
  if (toastTimer.value) clearTimeout(toastTimer.value)
}

// --- Init ---
async function init() {
  loading.value = true
  errorCode.value = ''
  errorMessage.value = ''
  selectedPushId.value = null
  selectedDetail.value = null
  showContextMenu.value = false
  await loadWorld()
  loading.value = false

  if (!errorCode.value) {
    await loadGraph()
  }
}

watch(graphData, async (data) => {
  if (!data) return
  await nextTick()
  destroyNetwork()
  if (graphContainerRef.value && data.nodes.length > 0) {
    createNetwork(data)
    nextTick(() => {
      network?.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
    })
  }
})

watch(() => route.params.worldId, () => {
  init()
})

onMounted(init)

onUnmounted(() => {
  destroyNetwork()
  if (toastTimer.value) clearTimeout(toastTimer.value)
})
</script>

<template>
  <main class="story-graph-page">
    <!-- Toast -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="toastMessage" class="toast" role="alert">
          <span>{{ toastMessage }}</span>
          <button type="button" class="toast__close" aria-label="关闭" @click.stop="dismissToast">&times;</button>
        </div>
      </Transition>
    </Teleport>

    <!-- Full-page error state -->
    <div v-if="loading" class="page-state">
      <p>正在加载...</p>
    </div>
    <div v-else-if="errorCode" class="page-state page-state--error">
      <h1>暂时无法加载</h1>
      <p>{{ errorMessage }}</p>
      <div class="page-state__actions">
        <button type="button" class="state-button state-button--primary" @click="init">重新加载</button>
        <RouterLink class="state-button" :to="{ name: 'discover' }">返回发现页</RouterLink>
      </div>
    </div>

    <!-- Main content -->
    <template v-else>
      <nav class="graph-breadcrumb">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>&rsaquo;</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          <strong>{{ world?.name }}</strong>
        </RouterLink>
        <span>&rsaquo;</span>
        <strong>世界线树图</strong>
      </nav>

      <div :class="['graph-shell', { 'graph-shell--with-detail': hasDetailPanel }]">
        <header class="graph-header">
          <div>
            <p class="eyebrow">Story Graph</p>
            <h1>世界线 DAG 图</h1>
            <p v-if="graphData" class="graph-summary">
              {{ graphData.nodes.filter(n => !n.isHead).length }} 个推送节点，{{ graphData.edges.length }} 个连接
            </p>
          </div>
          <div class="graph-actions">
            <RouterLink
              v-if="isMember"
              class="panel-action"
              :to="{ name: 'submit-push', params: { worldId } }"
            >
              提交推送
            </RouterLink>
            <button v-if="canCreateFork" type="button" class="panel-action" @click="openForkModal()">
              创建分叉
            </button>
            <button v-if="canCreateMerge" type="button" class="panel-action" @click="openMergeModal()">
              创建合并
            </button>
          </div>
        </header>

        <div class="graph-main">
          <section class="graph-canvas">
            <div v-if="graphLoading" class="inline-state">
              <p>正在加载世界线图...</p>
            </div>
            <div v-else-if="graphError" class="inline-state inline-state--error">
              <h3>世界线图暂时不可用</h3>
              <p>{{ graphError }}</p>
              <button type="button" class="state-button" @click="loadGraph">重新加载</button>
            </div>
            <div v-else-if="!graphData || graphData.nodes.length === 0" class="inline-state">
              <h3>还没有故事线</h3>
              <p>这个世界还没有创建任何故事线。</p>
            </div>
            <div
              v-show="graphData && graphData.nodes.length > 0 && !graphLoading && !graphError"
              ref="graphContainerRef"
              class="dag-container"
            ></div>

            <!-- Context menu -->
            <div
              v-if="showContextMenu"
              class="context-menu"
              :style="contextMenuStyle"
              @click.stop
            >
              <button
                v-if="isMember"
                type="button"
                class="context-menu__item"
                @click="onContextFork"
              >
                从此分叉
              </button>
            </div>

            <!-- Floating zoom controls -->
            <div class="zoom-controls">
              <button type="button" class="zoom-btn" title="放大" @click="zoomIn">+</button>
              <button type="button" class="zoom-btn" title="缩小" @click="zoomOut">&minus;</button>
              <button type="button" class="zoom-btn" title="适应屏幕" @click="fitToScreen">&#8982;</button>
            </div>
          </section>
        </div>

        <!-- Detail sidebar -->
        <aside v-if="selectedDetail" class="detail-panel">
          <div v-if="detailLoading" class="inline-state">
            <p>正在加载详情...</p>
          </div>
          <template v-else>
            <div class="detail-panel__header">
              <h2>{{ selectedDetail.isHead ? selectedDetail.lineName : selectedDetail.title }}</h2>
              <span :class="['node-badge', formatNodeTypeClass(selectedDetail.lineType)]">
                {{ formatNodeType(selectedDetail.lineType) }}
              </span>
              <span v-if="selectedDetail.isHead && selectedDetail.isPlaceholder" class="node-badge node-badge--placeholder">空</span>
            </div>

            <template v-if="selectedDetail.isHead && selectedDetail.isPlaceholder">
              <p class="detail-panel__desc">
                该线暂无已批准的推送，点击下方链接开始创作。
              </p>
            </template>

            <template v-else-if="selectedDetail.isHead">
              <p class="detail-panel__desc">
                分支入口节点，下方展示该线的推送历史。
              </p>
            </template>

            <dl v-else class="detail-meta">
              <dt>所属故事线</dt>
              <dd>{{ selectedDetail.lineName }}</dd>

              <dt>作者</dt>
              <dd>{{ selectedDetail.authorNickname }}</dd>

              <dt>推送时间</dt>
              <dd>{{ selectedDetail.submittedAt }}</dd>

              <dt>序号</dt>
              <dd>第 {{ selectedDetail.sequenceIndex + 1 }} 个推送</dd>
            </dl>

            <button
              v-if="isMember && !(selectedDetail.isHead && selectedDetail.isPlaceholder)"
              type="button"
              class="panel-action detail-panel__fork"
              @click="openForkModal(selectedDetail.lineId, selectedDetail.isHead ? undefined : selectedDetail.pushId)"
            >
              从此分叉
            </button>

            <RouterLink
              v-if="isMember && selectedDetail.isHead && !isMergedParentLine(selectedDetail.lineId)"
              class="panel-action detail-panel__content"
              :to="{ name: 'submit-push', params: { worldId }, query: { lineId: selectedDetail.lineId } }"
            >
              提交推送
            </RouterLink>
            <span
              v-else-if="isMember && selectedDetail.isHead && isMergedParentLine(selectedDetail.lineId)"
              class="panel-action panel-action--disabled detail-panel__content"
              title="该故事线已经被合并，不能再提交新的 Push"
            >
              已合并，停止接收 Push
            </span>

            <RouterLink
              v-if="selectedDetail.isHead"
              class="panel-action detail-panel__content"
              :to="{ name: 'line-content', params: { worldId, lineId: selectedDetail.lineId } }"
            >
              查看该线内容
            </RouterLink>
            <RouterLink
              v-else
              class="panel-action detail-panel__content"
              :to="{ name: 'push-detail', params: { worldId, submissionId: selectedDetail.pushId } }"
            >
              查看推送详情
            </RouterLink>

            <button
              type="button"
              class="state-button detail-panel__close"
              @click="selectedPushId = null; selectedDetail = null"
            >
              关闭
            </button>
          </template>
        </aside>
      </div>
    </template>

    <!-- Fork Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showForkModal" class="modal-overlay" @click.self="showForkModal = false">
          <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="fork-modal-title">
            <h2 id="fork-modal-title" class="modal-title">创建分叉</h2>

            <div v-if="forkError" class="modal-error" role="alert">{{ forkError }}</div>

            <label class="modal-field">
              <span class="modal-label">父线</span>
              <select v-model="forkParentLineId" class="modal-input modal-select">
                <option value="" disabled>选择父线</option>
                <option v-for="line in forkParentLines" :key="line.lineId" :value="line.lineId">
                  {{ line.name }}（{{ formatNodeType(line.type) }}）
                </option>
              </select>
            </label>

            <label v-if="forkParentLineId" class="modal-field">
              <span class="modal-label">基于推送（必选）</span>
              <select v-model="forkBasedOnPushId" class="modal-input modal-select">
                <option :value="null" disabled>选择已批准的 Push</option>
                <option
                  v-for="push in forkParentPushes"
                  :key="push.submissionId"
                  :value="push.submissionId"
                >
                  {{ push.title || push.summary }}
                </option>
              </select>
              <small v-if="forkPushesLoading" class="modal-hint">加载推送列表中...</small>
              <small v-else-if="forkParentLineId && forkParentPushes.length === 0 && !forkPushesLoading" class="modal-hint">
                该线暂无已批准的 Push，暂不能创建分叉
              </small>
            </label>

            <label class="modal-field">
              <span class="modal-label">分叉名称</span>
              <input
                v-model="forkName"
                type="text"
                class="modal-input"
                maxlength="50"
                placeholder="输入分叉名称"
              />
            </label>

            <label class="modal-field">
              <span class="modal-label">分叉描述（可选）</span>
              <input
                v-model="forkDescription"
                type="text"
                class="modal-input"
                maxlength="200"
                placeholder="输入分叉描述"
              />
            </label>

            <div class="modal-actions">
              <button
                type="button"
                class="panel-action"
                :disabled="forkSubmitting || !forkSelectionValid"
                @click="submitFork"
              >
                {{ forkSubmitting ? '创建中...' : '创建' }}
              </button>
              <button type="button" class="state-button" @click="showForkModal = false">取消</button>
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
            <h2 id="merge-modal-title" class="modal-title">创建合并</h2>

            <div v-if="mergeError" class="modal-error" role="alert">{{ mergeError }}</div>

            <label class="modal-field">
              <span class="modal-label">合并线名称</span>
              <input
                v-model="mergeName"
                type="text"
                class="modal-input"
                maxlength="50"
                placeholder="输入合并线名称"
              />
            </label>

            <label class="modal-field">
              <span class="modal-label">合并线描述（可选）</span>
              <input
                v-model="mergeDescription"
                type="text"
                class="modal-input"
                maxlength="200"
                placeholder="输入合并线描述"
              />
            </label>

            <div class="modal-field">
              <span class="modal-label">选择父线（至少 2 条）</span>
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
              <p v-if="mergeSelectedLineIds.length < 2 && mergeSelectedLineIds.length > 0" class="merge-hint">
                合并需要至少选择两条故事线
              </p>
            </div>

            <div class="modal-actions">
              <button
                type="button"
                class="panel-action"
                :disabled="mergeSubmitting || !mergeSelectionValid"
                @click="submitMerge"
              >
                {{ mergeSubmitting ? '创建中...' : '创建' }}
              </button>
              <button type="button" class="state-button" @click="showMergeModal = false">取消</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.story-graph-page {
  padding-block: 28px 56px;
  max-width: 1100px;
  margin: 0 auto;
  padding-inline: 20px;
}

.page-state,
.inline-state {
  display: grid;
  gap: 16px;
  padding: 32px;
  align-content: center;
  min-height: 320px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 48%);
  box-shadow: var(--shadow-panel);
}

.inline-state {
  min-height: 120px;
}

.page-state--error,
.inline-state--error {
  background: rgb(108 36 36 / 6%);
}

.page-state h1,
.inline-state h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.page-state p,
.inline-state p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
}

.page-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.state-button,
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

.state-button--primary,
.panel-action {
  color: #fff;
  background: #103b31;
  border-color: #103b31;
}

.panel-action:disabled,
.state-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.panel-action--disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.graph-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
  margin-bottom: 22px;
}

.graph-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.graph-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.graph-shell {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.graph-shell--with-detail {
  grid-template-columns: minmax(0, 1.8fr) minmax(260px, 0.7fr);
}

.graph-shell--with-detail .graph-header {
  grid-column: 1 / -1;
}

.graph-main {
  display: grid;
}

.graph-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
  flex-wrap: wrap;
}

.graph-header h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2rem, 3vw, 3rem);
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.graph-summary {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 0.92rem;
}

.graph-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.zoom-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 10;
  display: flex;
  gap: 4px;
}

.zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  background: rgb(255 255 255 / 65%);
  color: var(--color-ink);
  font-size: 1rem;
  font-weight: 800;
  cursor: pointer;
}

.zoom-btn:hover {
  background: rgb(20 115 90 / 8%);
}

.graph-canvas {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 84%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
  padding: 16px;
  min-height: 200px;
  position: relative;
}

.dag-container {
  width: 100%;
  height: 600px;
  border-radius: 4px;
}

/* --- Context menu --- */
.context-menu {
  position: absolute;
  z-index: 100;
  min-width: 140px;
  padding: 6px 0;
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 96%), rgb(244 240 231 / 98%)),
    #fff;
  box-shadow: 0 4px 20px rgb(0 0 0 / 14%);
  border: 1px solid rgb(16 59 49 / 10%);
}

.context-menu__item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--color-ink);
  font-size: 0.88rem;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
}

.context-menu__item:hover {
  background: rgb(20 115 90 / 8%);
}

/* --- Detail panel --- */
.detail-panel {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 84%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
  padding: 22px;
  align-self: start;
}

.detail-panel__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.detail-panel__header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.3rem;
}

.detail-panel__desc {
  margin: 0 0 18px;
  color: var(--color-muted);
  line-height: 1.75;
}

.detail-meta {
  display: grid;
  gap: 8px 16px;
  margin: 0 0 18px;
}

.detail-meta dt {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.detail-meta dd {
  margin: 0;
  color: var(--color-ink);
  font-size: 0.92rem;
}

.detail-panel__fork {
  margin-bottom: 10px;
  width: 100%;
}

.detail-panel__content {
  margin-bottom: 10px;
  width: 100%;
}

.detail-panel__close {
  width: 100%;
}

/* --- Node badges --- */
.node-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
  white-space: nowrap;
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

.node-badge--placeholder {
  background: rgb(128 128 128 / 8%);
  color: #888;
  border: 1px dashed rgb(128 128 128 / 35%);
}

/* --- Modals --- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgb(0 0 0 / 38%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  width: min(440px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  padding: 28px;
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 90%), rgb(244 240 231 / 96%)),
    #fff;
  box-shadow: 0 8px 32px rgb(0 0 0 / 18%);
}

.modal-title {
  margin: 0 0 18px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.4rem;
}

.modal-error {
  margin: 0 0 16px;
  padding: 10px 14px;
  border-radius: 6px;
  background: rgb(108 36 36 / 8%);
  color: rgb(108 36 36 / 85%);
  font-weight: 800;
}

.modal-field {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
}

.modal-label {
  font-weight: 800;
  font-size: 0.82rem;
  color: var(--color-ink);
}

.modal-input,
.modal-select {
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  font-size: 0.92rem;
  background: #fff;
  color: var(--color-ink);
}

.modal-hint {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 0.78rem;
}

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

.merge-hint {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 0.82rem;
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

/* --- Toast --- */
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

.modal-enter-active,
.modal-leave-active {
  transition: opacity 220ms;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* --- Responsive --- */
@media (max-width: 900px) {
  .graph-shell--with-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .graph-header {
    flex-direction: column;
  }

  .graph-actions {
    width: 100%;
  }

  .dag-container {
    height: 420px;
  }
}
</style>
