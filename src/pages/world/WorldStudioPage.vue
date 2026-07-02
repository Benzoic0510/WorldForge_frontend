<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createEntry, deleteEntry, getEntryDetail, listEntries, publishEntryRevision } from '@/api/entry'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import { getStoryGraph, getStoryPushDetail, createForkLine, createMergeLine, listApprovedStoryPushes } from '@/api/storyline'
import { useAuthStore } from '@/stores/auth'
import { buildPushGraph, pushGraphToVis } from '@/composables/useStoryGraphDag'
import type { EntryDetail, EntryListItem } from '@/types/entry'
import type { PushGraphData, PushGraphNode, SubmissionListItem } from '@/types/storyline'
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
type EntryPreviewItem = EntryListItem & { contentPreview?: string }
type EntryEditField = 'title' | 'tags' | 'content'

const entries = ref<EntryPreviewItem[]>([])
const entriesLoading = ref(false)
const entriesLoadingMore = ref(false)
const entriesError = ref('')
const entriesAppendError = ref('')
const entriesPage = ref(1)
const entriesTotalPages = ref(0)
const searchKeyword = ref('')
const searchInput = ref('')
const selectedEntryId = ref('')
const displayedEntryId = ref('')
const pendingEntryId = ref('')
const displayedEntrySnapshot = ref<EntryPreviewItem | null>(null)
const pendingEntrySnapshot = ref<EntryPreviewItem | null>(null)
const isBookTurning = ref(false)
const bookTurnKey = ref(0)
const bookTurnDirection = ref<'forward' | 'backward'>('forward')
const bookTurnDistance = ref(1)
const isEntryEditMode = ref(false)
const editingEntryField = ref<EntryEditField | null>(null)
const showEntryEditConfirm = ref(false)
const entryEditError = ref('')
const entryEditSubmitting = ref(false)
const entryDeleteSubmitting = ref(false)
const entryEditForm = reactive({
  title: '',
  tagsText: '',
  content: ''
})
let bookTurnTimer: ReturnType<typeof window.setTimeout> | null = null
const BOOK_TURN_TOTAL_DURATION = 460
const BOOK_TURN_PAGE_DURATION = 360
const BOOK_TURN_FALLBACK_DELAY = BOOK_TURN_TOTAL_DURATION + 120
const hasSearchKeyword = computed(() => searchKeyword.value.length > 0)
const canLoadMoreEntries = computed(() => entriesPage.value < entriesTotalPages.value)
const routeEntryId = computed(() => {
  const entryId = route.query.entryId
  return typeof entryId === 'string' ? entryId : ''
})
const displayedEntry = computed(() =>
  entries.value.find(entry => entry.entryId === displayedEntryId.value)
  ?? (displayedEntrySnapshot.value?.entryId === displayedEntryId.value ? displayedEntrySnapshot.value : null)
)
const pendingEntry = computed(() =>
  entries.value.find(entry => entry.entryId === pendingEntryId.value)
  ?? (pendingEntrySnapshot.value?.entryId === pendingEntryId.value ? pendingEntrySnapshot.value : null)
)
const bookEntry = computed(() => displayedEntry.value ?? pendingEntry.value)
const editableEntry = computed(() => (!isBookTurning.value ? displayedEntry.value : null))
const isEditingDisplayedEntry = computed(() => isEntryEditMode.value && editableEntry.value != null)
const parsedEntryEditTags = computed(() => parseEntryTags(entryEditForm.tagsText))
const isEntryEditDirty = computed(() => {
  const entry = editableEntry.value
  if (!entry) return false

  return (
    entryEditForm.title.trim() !== entry.title
    || entryEditForm.content.trim() !== getEntryContent(entry)
    || parsedEntryEditTags.value.join('\n') !== entry.tags.join('\n')
  )
})
const displayedEntryIndex = computed(() =>
  displayedEntry.value ? entries.value.findIndex(entry => entry.entryId === displayedEntry.value?.entryId) : -1
)
const pendingEntryIndex = computed(() =>
  pendingEntry.value ? entries.value.findIndex(entry => entry.entryId === pendingEntry.value?.entryId) : -1
)
const displayedEntryLabel = computed(() =>
  displayedEntryIndex.value >= 0 ? `Entry ${displayedEntryIndex.value + 1}` : 'Entry'
)
const pendingEntryLabel = computed(() =>
  pendingEntryIndex.value >= 0 ? `Entry ${pendingEntryIndex.value + 1}` : 'Entry'
)
const bookTurnPages = computed(() => {
  const count = Math.min(bookTurnDistance.value, 10)
  const totalDuration = BOOK_TURN_TOTAL_DURATION
  const pageDuration = count === 1 ? totalDuration : BOOK_TURN_PAGE_DURATION
  const delayStep = count === 1 ? 0 : (totalDuration - pageDuration) / (count - 1)

  return Array.from({ length: count }, (_, index) => {
    const isSpacer = index !== 0 && index !== count - 1
    const delay = index * delayStep

    return {
      index,
      isSpacer,
      isLast: index === count - 1,
      style: {
        '--page-delay': `${Math.round(delay)}ms`,
        '--page-duration': `${Math.round(pageDuration)}ms`,
        '--page-z': `${count - index}px`,
        '--page-arc': `${18 + Math.min(count, 6) * 2 - index}px`,
        '--page-shadow': `${0.14 - index * 0.008}`
      }
    }
  })
})

// ── Graph ──
const graphData = ref<PushGraphData | null>(null)
const graphLoading = ref(false)
const graphError = ref('')
const graphContainerRef = ref<HTMLElement | null>(null)
let network: Network | null = null

type GraphPopoverMode = 'content' | 'actions'

const graphPopover = ref<{
  mode: GraphPopoverMode
  node: PushGraphNode
  x: number
  y: number
} | null>(null)

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
function formatEntryDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function buildEntryPreview(content: string): string {
  return content.trim()
}

function buildEntrySummary(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= 160) return trimmed
  return `${trimmed.slice(0, 160).trimEnd()}...`
}

function getEntryContent(entry: EntryPreviewItem): string {
  return entry.contentPreview || entry.summary || '暂无正文内容。'
}

function parseEntryTags(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[,，\n]/)
      .map(tag => tag.trim())
      .filter(Boolean)
  ))
}

function seedEntryEditForm(entry: EntryPreviewItem) {
  entryEditForm.title = entry.title
  entryEditForm.tagsText = entry.tags.join('，')
  entryEditForm.content = getEntryContent(entry)
  editingEntryField.value = null
  entryEditError.value = ''
}

function closeEntryEditMode() {
  isEntryEditMode.value = false
  editingEntryField.value = null
  showEntryEditConfirm.value = false
  entryEditError.value = ''
}

function closeEntryEditConfirm() {
  if (entryEditSubmitting.value) return
  showEntryEditConfirm.value = false
  entryEditError.value = ''
}

function handleEntryQuillClick() {
  if (!canEditWorld.value || !editableEntry.value || entryEditSubmitting.value || entryDeleteSubmitting.value) return

  if (!isEntryEditMode.value) {
    seedEntryEditForm(editableEntry.value)
    isEntryEditMode.value = true
    return
  }

  openEntryEditConfirm()
}

function beginInlineEntryEdit(field: EntryEditField) {
  if (!isEditingDisplayedEntry.value || entryEditSubmitting.value || entryDeleteSubmitting.value) return
  editingEntryField.value = field
}

function openEntryEditConfirm() {
  if (!editableEntry.value || entryEditSubmitting.value || entryDeleteSubmitting.value) return

  editingEntryField.value = null
  entryEditError.value = ''
  const validationError = validateEntryEditForm()
  if (validationError) {
    entryEditError.value = validationError
    return
  }

  if (!isEntryEditDirty.value) {
    closeEntryEditMode()
    return
  }

  showEntryEditConfirm.value = true
}

function validateEntryEditForm(): string | null {
  const title = entryEditForm.title.trim()
  if (!title) return '请输入词条标题。'
  if (title.length > 100) return '词条标题不能超过 100 个字符。'

  const content = entryEditForm.content.trim()
  if (!content) return '请输入词条正文。'
  if (content.length > 100000) return '词条正文不能超过 100,000 个字符。'

  return null
}

function getEditableTitle(entry: EntryPreviewItem): string {
  return isEditingDisplayedEntry.value && editableEntry.value?.entryId === entry.entryId
    ? entryEditForm.title
    : entry.title
}

function getEditableTags(entry: EntryPreviewItem): string[] {
  return isEditingDisplayedEntry.value && editableEntry.value?.entryId === entry.entryId
    ? parsedEntryEditTags.value
    : entry.tags
}

function getEditableContent(entry: EntryPreviewItem): string {
  return isEditingDisplayedEntry.value && editableEntry.value?.entryId === entry.entryId
    ? entryEditForm.content
    : getEntryContent(entry)
}

function syncEditedEntry(detail: EntryDetail) {
  const updatedPreview: EntryPreviewItem = {
    entryId: detail.entryId,
    worldId: detail.worldId,
    title: detail.title,
    summary: buildEntrySummary(detail.content),
    tags: [...detail.tags],
    updatedAt: detail.updatedAt,
    contentPreview: buildEntryPreview(detail.content)
  }

  entries.value = entries.value.map(entry =>
    entry.entryId === detail.entryId ? updatedPreview : entry
  )

  if (displayedEntryId.value === detail.entryId) {
    displayedEntrySnapshot.value = updatedPreview
  }
  if (pendingEntryId.value === detail.entryId) {
    pendingEntrySnapshot.value = updatedPreview
  }
}

async function confirmEntryEdit() {
  const entry = editableEntry.value
  if (!entry || entryEditSubmitting.value || entryDeleteSubmitting.value) return

  entryEditError.value = ''
  const validationError = validateEntryEditForm()
  if (validationError) {
    entryEditError.value = validationError
    return
  }

  if (!isEntryEditDirty.value) {
    closeEntryEditMode()
    return
  }

  entryEditSubmitting.value = true
  try {
    const updatedEntry = await publishEntryRevision(entry.worldId, entry.entryId, {
      title: entryEditForm.title.trim(),
      content: entryEditForm.content.trim(),
      tags: parsedEntryEditTags.value
    })

    syncEditedEntry(updatedEntry)
    closeEntryEditMode()
    showToast('词条修订已完成。')
  } catch (error) {
    entryEditError.value = error instanceof ApiError ? error.message : '修订暂时无法发布，请稍后重试。'
  } finally {
    entryEditSubmitting.value = false
  }
}

async function handleDeleteEditedEntry() {
  const entry = editableEntry.value
  if (!entry || entryEditSubmitting.value || entryDeleteSubmitting.value) return

  const confirmed = window.confirm('确定要删除这个词条吗？删除后它会从当前世界的词条列表中移除。')
  if (!confirmed) return

  entryDeleteSubmitting.value = true
  entryEditError.value = ''
  try {
    const deletedIndex = entries.value.findIndex(item => item.entryId === entry.entryId)
    await deleteEntry(entry.worldId, entry.entryId)

    entries.value = entries.value.filter(item => item.entryId !== entry.entryId)
    closeEntryEditMode()
    pendingEntryId.value = ''
    pendingEntrySnapshot.value = null
    isBookTurning.value = false

    const nextEntry = entries.value[Math.min(Math.max(deletedIndex, 0), entries.value.length - 1)]
    if (nextEntry) {
      selectedEntryId.value = nextEntry.entryId
      displayedEntryId.value = nextEntry.entryId
      displayedEntrySnapshot.value = nextEntry
      await router.replace({
        query: {
          ...route.query,
          view: 'entries',
          entryId: nextEntry.entryId
        }
      })
    } else {
      selectedEntryId.value = ''
      displayedEntryId.value = ''
      displayedEntrySnapshot.value = null
      const nextQuery = { ...route.query, view: 'entries' }
      delete nextQuery.entryId
      await router.replace({ query: nextQuery })
    }

    showToast('词条已删除。')
  } catch (error) {
    entryEditError.value = error instanceof ApiError ? error.message : '词条删除失败，请稍后重试。'
  } finally {
    entryDeleteSubmitting.value = false
  }
}

function getTurningExcerpt(entry: EntryPreviewItem | null): string {
  if (!entry) return ''
  const content = getEntryContent(entry).replace(/\s+/g, ' ').trim()
  if (content.length <= 120) return content
  return `${content.slice(0, 120).trimEnd()}...`
}

function trapEntryIndexWheel(event: WheelEvent) {
  const scroller = event.currentTarget as HTMLElement | null
  if (!scroller || event.deltaY === 0) return

  event.preventDefault()
  event.stopPropagation()

  const delta =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 32
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * scroller.clientHeight
        : event.deltaY

  scroller.scrollTop += delta
}

function selectEntry(entry: EntryPreviewItem, index: number) {
  if (isBookTurning.value || isEntryEditMode.value || entryEditSubmitting.value) return

  const currentIndex = entries.value.findIndex(item => item.entryId === displayedEntryId.value)
  if (currentIndex === index) return

  selectedEntryId.value = entry.entryId

  if (!displayedEntryId.value || currentIndex < 0) {
    displayedEntryId.value = entry.entryId
    displayedEntrySnapshot.value = entry
    pendingEntryId.value = ''
    pendingEntrySnapshot.value = null
    isBookTurning.value = false
    bookTurnKey.value += 1
    return
  }

  if (bookTurnTimer) {
    clearTimeout(bookTurnTimer)
    bookTurnTimer = null
  }
  pendingEntryId.value = entry.entryId
  pendingEntrySnapshot.value = entry
  bookTurnDistance.value = Math.max(1, Math.abs(index - currentIndex))
  bookTurnDirection.value = index < currentIndex ? 'backward' : 'forward'
  isBookTurning.value = true
  bookTurnKey.value += 1

  bookTurnTimer = window.setTimeout(() => {
    completeBookTurn()
  }, BOOK_TURN_FALLBACK_DELAY)
}

function selectRouteEntry() {
  if (!routeEntryId.value) return

  const entryIndex = entries.value.findIndex(entry => entry.entryId === routeEntryId.value)
  if (entryIndex < 0) return

  selectEntry(entries.value[entryIndex], entryIndex)
}

function completeBookTurn() {
  if (!isBookTurning.value || !pendingEntryId.value) return

  if (bookTurnTimer) {
    clearTimeout(bookTurnTimer)
    bookTurnTimer = null
  }

  const settledEntryId = pendingEntryId.value
  const settledEntry = pendingEntry.value
  displayedEntryId.value = settledEntryId
  displayedEntrySnapshot.value = settledEntry
  pendingEntryId.value = ''
  pendingEntrySnapshot.value = null
  isBookTurning.value = false
}

function handleBookTurnAnimationEnd(pageIndex: number) {
  if (!isBookTurning.value || pageIndex !== bookTurnPages.value.length - 1) return

  completeBookTurn()
}

async function hydrateEntryPreviews(items: EntryListItem[]): Promise<EntryPreviewItem[]> {
  return Promise.all(
    items.map(async (entry) => {
      try {
        const detail = await getEntryDetail(entry.worldId, entry.entryId)
        return {
          ...entry,
          contentPreview: buildEntryPreview(detail.content)
        }
      } catch {
        return entry
      }
    })
  )
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

    const hydratedItems = await hydrateEntryPreviews(data.items)
    entries.value = append ? entries.value.concat(hydratedItems) : hydratedItems
    if (!append) {
      const refreshedDisplayedEntry = hydratedItems.find(entry => entry.entryId === displayedEntryId.value)
      const refreshedPendingEntry = hydratedItems.find(entry => entry.entryId === pendingEntryId.value)
      if (refreshedDisplayedEntry) displayedEntrySnapshot.value = refreshedDisplayedEntry
      if (refreshedPendingEntry) pendingEntrySnapshot.value = refreshedPendingEntry
      selectRouteEntry()
    }
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

function findGraphNode(pushId: string): PushGraphNode | null {
  return graphData.value?.nodes.find(n => n.pushId === pushId) ?? null
}

function getPointerPosition(params: any) {
  const sourceEvent = params?.event?.srcEvent
  let rawX = typeof sourceEvent?.clientX === 'number' ? sourceEvent.clientX : null
  let rawY = typeof sourceEvent?.clientY === 'number' ? sourceEvent.clientY : null

  if ((rawX == null || rawY == null) && params?.pointer?.DOM && graphContainerRef.value) {
    const rect = graphContainerRef.value.getBoundingClientRect()
    rawX = rect.left + params.pointer.DOM.x
    rawY = rect.top + params.pointer.DOM.y
  }

  rawX ??= window.innerWidth / 2
  rawY ??= window.innerHeight / 2

  return {
    x: Math.min(rawX + 14, window.innerWidth - 340),
    y: Math.min(rawY + 14, window.innerHeight - 260),
  }
}

function showGraphPopover(mode: GraphPopoverMode, node: PushGraphNode, params: any) {
  const position = getPointerPosition(params)
  graphPopover.value = {
    mode,
    node,
    x: Math.max(12, position.x),
    y: Math.max(12, position.y),
  }
}

function closeGraphPopover() {
  graphPopover.value = null
}

function graphNodeText(node: PushGraphNode): string {
  if (node.isHead) {
    return node.isPlaceholder
      ? '这条故事线还没有已通过的推送。'
      : `${node.lineName} 的起点`
  }
  return node.content?.trim() || node.title || '这次推送没有文本内容。'
}

function graphNodeTitle(node: PushGraphNode): string {
  return node.isHead ? node.lineName : node.title
}

async function hydrateApprovedPushContents(items: SubmissionListItem[]): Promise<SubmissionListItem[]> {
  return Promise.all(
    items.map(async push => {
      if (push.content?.trim()) {
        return push
      }

      try {
        const detail = await getStoryPushDetail(worldId.value, push.submissionId)
        return { ...push, content: detail.content }
      } catch {
        return push
      }
    })
  )
}

function openLineContent(node: PushGraphNode) {
  closeGraphPopover()
  router.push({ name: 'line-content', params: { worldId: worldId.value, lineId: node.lineId } })
}

function openPushDetail(node: PushGraphNode) {
  if (node.isHead) return
  closeGraphPopover()
  router.push({ name: 'push-detail', params: { worldId: worldId.value, submissionId: node.pushId } })
}

function openForkFromNode(node: PushGraphNode) {
  closeGraphPopover()
  openForkModal(node.lineId, node.isHead ? undefined : node.pushId)
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
    closeGraphPopover()
    if (params.nodes.length === 0) return
    const pushId = params.nodes[0] as string
    const pushNode = findGraphNode(pushId)
    if (!pushNode) return
    if (pushNode.isHead) {
      router.push({ name: 'line-content', params: { worldId: worldId.value, lineId: pushNode.lineId } })
    } else {
      router.push({ name: 'push-detail', params: { worldId: worldId.value, submissionId: pushId } })
    }
  })

  network.on('click', (params: any) => {
    if (params.nodes.length > 0) {
      const pushNode = findGraphNode(params.nodes[0] as string)
      if (pushNode) {
        showGraphPopover('content', pushNode, params)
      }
    } else {
      closeGraphPopover()
    }
  })

  network.on('dragStart', closeGraphPopover)
  network.on('dragging', closeGraphPopover)
  network.on('zoom', closeGraphPopover)
  network.on('animationStarted', closeGraphPopover)

  network.on('oncontext', (params: any) => {
    params.event?.preventDefault?.()
    const nodeId = network?.getNodeAt(params.pointer.DOM)
    if (!nodeId) {
      closeGraphPopover()
      return
    }
    const pushNode = findGraphNode(String(nodeId))
    if (pushNode) {
      showGraphPopover('actions', pushNode, params)
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
  closeGraphPopover()
  const scale = network.getScale()
  network.moveTo({ scale: scale * 1.3, animation: { duration: 300 } })
}

function zoomOut() {
  if (!network) return
  closeGraphPopover()
  const scale = network.getScale()
  network.moveTo({ scale: scale / 1.3, animation: { duration: 300 } })
}

function fitToScreen() {
  if (!network) return
  closeGraphPopover()
  network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
}

function toggleGraphDirection() {
  closeGraphPopover()
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

    const approvedPushes: SubmissionListItem[] = await hydrateApprovedPushContents(
      await listApprovedStoryPushes(worldId.value)
    )

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
  closeGraphPopover()
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
  } else if (view === 'entries') {
    selectRouteEntry()
  }
  if (view === 'graph' && !graphData.value && !graphLoading.value) {
    await loadGraph()
  }
})

watch(routeEntryId, () => {
  if (activeView.value === 'entries') {
    selectRouteEntry()
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
  if (event.key === 'Escape' && showEntryEditConfirm.value && !entryEditSubmitting.value) {
    closeEntryEditConfirm()
    return
  }
  if (event.key === 'Escape' && editingEntryField.value) {
    editingEntryField.value = null
    return
  }
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
  if (bookTurnTimer) clearTimeout(bookTurnTimer)
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

        <div class="entry-book-layout">
          <aside class="entry-book-index" aria-label="词条目录" @wheel="trapEntryIndexWheel">
            <div v-if="entriesLoading" class="entry-index-state" role="status">
              <p>正在整理词条目录...</p>
            </div>

            <div v-else-if="entriesError" class="entry-index-state entry-index-state--error" role="status">
              <strong>词条列表暂时不可用</strong>
              <p>{{ entriesError }}</p>
              <button type="button" class="studio-action studio-action--primary" @click="reloadEntries">
                重新加载
              </button>
            </div>

            <div v-else-if="entries.length === 0" class="entry-index-state entry-index-state--empty">
              <strong>{{ hasSearchKeyword ? '没有匹配词条' : '还没有词条' }}</strong>
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

            <template v-else>
              <button
                v-for="(entry, index) in entries"
                :key="entry.entryId"
                type="button"
                class="entry-index-item"
                :class="{ 'entry-index-item--active': selectedEntryId === entry.entryId }"
                :aria-pressed="selectedEntryId === entry.entryId"
                :disabled="isBookTurning || isEntryEditMode || entryEditSubmitting"
                @click="selectEntry(entry, index)"
              >
                <span class="entry-index-item__title">{{ entry.title }}</span>
                <span class="entry-index-item__date">{{ formatEntryDate(entry.updatedAt) }}</span>
                <span v-if="entry.tags.length > 0" class="entry-index-item__tags">
                  <span v-for="tag in entry.tags.slice(0, 3)" :key="tag">{{ tag }}</span>
                </span>
              </button>
            </template>
          </aside>

          <section class="entry-book-stage" aria-live="polite">
            <div v-if="!bookEntry" class="entry-closed-book">
              <div class="entry-closed-book__cover">
                <span>WorldForge</span>
                <strong>词条典藏</strong>
                <small>从左侧选择词条翻阅</small>
              </div>
              <div class="entry-closed-book__pages" aria-hidden="true"></div>
            </div>

            <div
              v-else
              class="entry-open-book"
              :class="[
                `entry-open-book--${bookTurnDirection}`,
                {
                  'entry-open-book--turning': isBookTurning,
                  'entry-open-book--editing': isEntryEditMode
                }
              ]"
            >
              <button
                v-if="canEditWorld && displayedEntry && !isBookTurning"
                type="button"
                class="entry-quill"
                :class="{ 'entry-quill--active': isEntryEditMode }"
                :disabled="entryEditSubmitting || entryDeleteSubmitting"
                :aria-label="isEntryEditMode ? '确认词条修改' : '编辑词条'"
                :title="isEntryEditMode ? '确认词条修改' : '编辑词条'"
                @click="handleEntryQuillClick"
              >
                <span class="entry-quill__feather" aria-hidden="true"></span>
                <span class="entry-quill__shaft" aria-hidden="true"></span>
              </button>

              <div v-if="isEditingDisplayedEntry" class="entry-edit-actions" aria-label="词条编辑操作">
                <button
                  type="button"
                  class="entry-edit-action entry-edit-action--save"
                  :disabled="entryEditSubmitting || entryDeleteSubmitting"
                  @click="openEntryEditConfirm"
                >
                  <span v-if="entryEditSubmitting" class="spinner" aria-hidden="true"></span>
                  {{ entryEditSubmitting ? '保存中' : '保存' }}
                </button>
                <button
                  type="button"
                  class="entry-edit-action entry-edit-action--delete"
                  :disabled="entryEditSubmitting || entryDeleteSubmitting"
                  @click="handleDeleteEditedEntry"
                >
                  <span v-if="entryDeleteSubmitting" class="spinner" aria-hidden="true"></span>
                  {{ entryDeleteSubmitting ? '删除中' : '删除词条' }}
                </button>
              </div>

              <div v-if="pendingEntry && isBookTurning" class="entry-book-spread entry-book-spread--target">
                <article class="entry-book-page entry-book-page--left">
                  <p class="entry-book-page__eyebrow">{{ pendingEntryLabel }}</p>
                  <h2>{{ pendingEntry.title }}</h2>
                  <dl class="entry-book-meta">
                    <div>
                      <dt>更新时间</dt>
                      <dd>{{ formatEntryDate(pendingEntry.updatedAt) }}</dd>
                    </div>
                    <div>
                      <dt>词条编号</dt>
                      <dd>{{ pendingEntry.entryId }}</dd>
                    </div>
                  </dl>
                  <div v-if="pendingEntry.tags.length > 0" class="entry-book-tags" aria-label="标签">
                    <span v-for="tag in pendingEntry.tags" :key="tag">{{ tag }}</span>
                  </div>
                </article>

                <article class="entry-book-page entry-book-page--right">
                  <p class="entry-book-page__eyebrow">Content</p>
                  <div class="entry-book-content">
                    <p>{{ getEntryContent(pendingEntry) }}</p>
                  </div>
                </article>
              </div>

              <div v-if="displayedEntry || bookEntry" class="entry-book-spread entry-book-spread--current">
                <article
                  class="entry-book-page entry-book-page--left"
                  :class="{ 'entry-book-page--turning-side-hidden': isBookTurning && bookTurnDirection === 'backward' }"
                >
                  <p class="entry-book-page__eyebrow">{{ displayedEntryLabel }}</p>
                  <div
                    class="entry-editable-zone entry-editable-zone--title"
                    :class="{
                      'entry-editable-zone--enabled': isEditingDisplayedEntry,
                      'entry-editable-zone--active': editingEntryField === 'title'
                    }"
                    data-edit-label="可编辑标题"
                    @click="beginInlineEntryEdit('title')"
                  >
                    <input
                      v-if="editingEntryField === 'title' && displayedEntry"
                      v-model="entryEditForm.title"
                      class="entry-inline-input entry-inline-input--title"
                      maxlength="100"
                      type="text"
                      @click.stop
                      @keydown.stop
                    />
                    <h2 v-else>{{ getEditableTitle((displayedEntry || bookEntry)!) }}</h2>
                  </div>
                  <dl class="entry-book-meta">
                    <div>
                      <dt>更新时间</dt>
                      <dd>{{ formatEntryDate((displayedEntry || bookEntry)!.updatedAt) }}</dd>
                    </div>
                    <div>
                      <dt>词条编号</dt>
                      <dd>{{ (displayedEntry || bookEntry)?.entryId }}</dd>
                    </div>
                  </dl>
                  <div
                    class="entry-editable-zone entry-editable-zone--tags"
                    :class="{
                      'entry-editable-zone--enabled': isEditingDisplayedEntry,
                      'entry-editable-zone--active': editingEntryField === 'tags'
                    }"
                    data-edit-label="可编辑标签"
                    @click="beginInlineEntryEdit('tags')"
                  >
                    <input
                      v-if="editingEntryField === 'tags' && displayedEntry"
                      v-model="entryEditForm.tagsText"
                      class="entry-inline-input"
                      maxlength="500"
                      placeholder="用逗号分隔标签"
                      type="text"
                      @click.stop
                      @keydown.stop
                    />
                    <p v-if="editingEntryField === 'tags' && displayedEntry" class="entry-edit-field-hint">
                      多个标签请用逗号分隔。
                    </p>
                    <div
                      v-else-if="getEditableTags((displayedEntry || bookEntry)!).length > 0"
                      class="entry-book-tags"
                      aria-label="标签"
                    >
                      <span v-for="tag in getEditableTags((displayedEntry || bookEntry)!)" :key="tag">{{ tag }}</span>
                    </div>
                    <p v-else class="entry-empty-edit-hint">暂无标签</p>
                  </div>
                </article>

                <article
                  class="entry-book-page entry-book-page--right"
                  :class="{ 'entry-book-page--turning-side-hidden': isBookTurning && bookTurnDirection === 'forward' }"
                >
                  <p class="entry-book-page__eyebrow">Content</p>
                  <div
                    class="entry-editable-zone entry-editable-zone--content"
                    :class="{
                      'entry-editable-zone--enabled': isEditingDisplayedEntry,
                      'entry-editable-zone--active': editingEntryField === 'content'
                    }"
                    data-edit-label="可编辑正文"
                    @click="beginInlineEntryEdit('content')"
                  >
                    <textarea
                      v-if="editingEntryField === 'content' && displayedEntry"
                      v-model="entryEditForm.content"
                      class="entry-inline-textarea"
                      maxlength="100000"
                      @click.stop
                      @keydown.stop
                    ></textarea>
                    <div v-else class="entry-book-content">
                      <p>{{ getEditableContent((displayedEntry || bookEntry)!) }}</p>
                    </div>
                  </div>
                </article>
              </div>

              <div
                v-if="isBookTurning && displayedEntry && pendingEntry"
                :key="bookTurnKey"
                class="entry-turning-stack"
                aria-hidden="true"
              >
                <div
                  v-for="page in bookTurnPages"
                  :key="page.index"
                  class="entry-turning-sheet"
                  :class="{ 'entry-turning-sheet--blank': page.isSpacer }"
                  :style="page.style"
                  @animationend.self="handleBookTurnAnimationEnd(page.index)"
                >
                  <div class="entry-turning-sheet__face entry-turning-sheet__face--front">
                    <article
                      class="entry-book-page entry-turning-sheet__page"
                      :class="[
                        bookTurnDirection === 'backward' ? 'entry-book-page--left' : 'entry-book-page--right',
                        { 'entry-turning-sheet__page--blank': page.index !== 0 }
                      ]"
                    >
                      <template v-if="page.index === 0">
                        <template v-if="bookTurnDirection === 'backward'">
                          <p class="entry-book-page__eyebrow">{{ displayedEntryLabel }}</p>
                          <h2>{{ displayedEntry.title }}</h2>
                          <dl class="entry-book-meta">
                            <div>
                              <dt>更新时间</dt>
                              <dd>{{ formatEntryDate(displayedEntry.updatedAt) }}</dd>
                            </div>
                            <div>
                              <dt>词条编号</dt>
                              <dd>{{ displayedEntry.entryId }}</dd>
                            </div>
                          </dl>
                          <div v-if="displayedEntry.tags.length > 0" class="entry-book-tags" aria-label="标签">
                            <span v-for="tag in displayedEntry.tags" :key="tag">{{ tag }}</span>
                          </div>
                        </template>
                        <template v-else>
                          <p class="entry-book-page__eyebrow">Content</p>
                          <div class="entry-book-content">
                            <p>{{ getEntryContent(displayedEntry) }}</p>
                          </div>
                        </template>
                      </template>
                    </article>
                  </div>
                  <div class="entry-turning-sheet__face entry-turning-sheet__face--back">
                    <article
                      class="entry-book-page entry-turning-sheet__page"
                      :class="[
                        bookTurnDirection === 'backward' ? 'entry-book-page--right' : 'entry-book-page--left',
                        { 'entry-turning-sheet__page--blank': page.index !== bookTurnPages.length - 1 }
                      ]"
                    >
                      <template v-if="page.index === bookTurnPages.length - 1">
                        <template v-if="bookTurnDirection === 'forward'">
                          <p class="entry-book-page__eyebrow">{{ pendingEntryLabel }}</p>
                          <h2>{{ pendingEntry.title }}</h2>
                          <dl class="entry-book-meta">
                            <div>
                              <dt>更新时间</dt>
                              <dd>{{ formatEntryDate(pendingEntry.updatedAt) }}</dd>
                            </div>
                            <div>
                              <dt>词条编号</dt>
                              <dd>{{ pendingEntry.entryId }}</dd>
                            </div>
                          </dl>
                          <div v-if="pendingEntry.tags.length > 0" class="entry-book-tags" aria-label="标签">
                            <span v-for="tag in pendingEntry.tags" :key="tag">{{ tag }}</span>
                          </div>
                        </template>
                        <template v-else>
                          <p class="entry-book-page__eyebrow">Content</p>
                          <div class="entry-book-content">
                            <p>{{ getEntryContent(pendingEntry) }}</p>
                          </div>
                        </template>
                      </template>
                    </article>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div v-if="entriesAppendError && !entriesLoading" class="append-error-row" role="status">
          <span>{{ entriesAppendError }}</span>
          <button type="button" @click="loadMoreEntries">再试一次</button>
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
                @contextmenu.prevent
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

          </div>
        </div>
      </template>
    </section>

    <Teleport to="body">
      <Transition name="graph-popover">
        <div
          v-if="graphPopover"
          class="graph-popover"
          :class="`graph-popover--${graphPopover.mode}`"
          :style="{ left: `${graphPopover.x}px`, top: `${graphPopover.y}px` }"
          @click.stop
          @contextmenu.prevent.stop
        >
          <template v-if="graphPopover.mode === 'content'">
            <div class="graph-popover__header">
              <span :class="['node-badge', formatNodeTypeClass(graphPopover.node.lineType)]">
                {{ formatNodeType(graphPopover.node.lineType) }}
              </span>
              <strong>{{ graphNodeTitle(graphPopover.node) }}</strong>
            </div>
            <p class="graph-popover__meta" v-if="!graphPopover.node.isHead">
              {{ graphPopover.node.lineName }} · {{ graphPopover.node.authorNickname }}
            </p>
            <div class="graph-popover__content">
              {{ graphNodeText(graphPopover.node) }}
            </div>
          </template>

          <template v-else>
            <div class="graph-popover__header">
              <span :class="['node-badge', formatNodeTypeClass(graphPopover.node.lineType)]">
                {{ formatNodeType(graphPopover.node.lineType) }}
              </span>
              <strong>{{ graphNodeTitle(graphPopover.node) }}</strong>
            </div>
            <div class="graph-popover__actions">
              <button
                v-if="isMember && !(graphPopover.node.isHead && graphPopover.node.isPlaceholder)"
                type="button"
                class="graph-popover__action"
                @click="openForkFromNode(graphPopover.node)"
              >
                在此创建剧情分支
              </button>
              <button
                type="button"
                class="graph-popover__action"
                @click="openLineContent(graphPopover.node)"
              >
                查看该线内容
              </button>
              <button
                v-if="!graphPopover.node.isHead"
                type="button"
                class="graph-popover__action graph-popover__action--primary"
                @click="openPushDetail(graphPopover.node)"
              >
                进入推送详情
              </button>
            </div>
          </template>
        </div>
      </Transition>
    </Teleport>

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

    <!-- Entry Edit Confirm Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="showEntryEditConfirm"
          class="modal-overlay"
          @click.self="closeEntryEditConfirm"
        >
          <div class="modal-card entry-edit-confirm" role="dialog" aria-modal="true" aria-labelledby="entry-edit-confirm-title">
            <div class="modal-header">
              <h2 id="entry-edit-confirm-title" class="modal-title">确认修改词条</h2>
              <button
                type="button"
                class="modal-close-btn"
                aria-label="关闭"
                :disabled="entryEditSubmitting"
                @click="closeEntryEditConfirm"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="3" x2="15" y2="15" /><line x1="15" y1="3" x2="3" y2="15" /></svg>
              </button>
            </div>

            <div class="modal-body">
              <p class="entry-edit-confirm__text">
                确认发布当前书页上的修改吗？确认后会生成一次新的词条修订。
              </p>
              <p v-if="!isEntryEditDirty" class="entry-edit-confirm__note">
                当前没有检测到内容变更，确认后会退出编辑状态。
              </p>
              <p v-if="entryEditError" class="form-error" role="alert">{{ entryEditError }}</p>
            </div>

            <div class="modal-footer">
              <button
                type="button"
                class="cancel-btn"
                :disabled="entryEditSubmitting"
                @click="closeEntryEditConfirm"
              >
                继续修改
              </button>
              <button
                type="button"
                class="submit-btn"
                :disabled="entryEditSubmitting"
                @click="confirmEntryEdit"
              >
                <span v-if="entryEditSubmitting" class="spinner" aria-hidden="true"></span>
                {{ entryEditSubmitting ? '正在提交...' : '确认修改' }}
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
                      {{ push.title || push.summary }}
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

/* Entry book */
.entry-book-layout {
  display: grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.entry-book-index {
  display: grid;
  gap: 8px;
  max-height: min(72vh, 760px);
  padding: 2px 10px 2px 2px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}

.entry-book-index::-webkit-scrollbar {
  display: none;
}

.entry-index-state {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 180px;
  padding: 18px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-left: 4px solid rgb(69 148 122 / 70%);
  border-radius: 8px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 64%);
  box-shadow: 0 8px 20px rgb(24 33 31 / 5%);
}

.entry-index-state strong {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.08rem;
  line-height: 1.2;
}

.entry-index-state p {
  margin: 0;
  line-height: 1.7;
}

.entry-index-state--error {
  border-left-color: #b15f4a;
  background: rgb(255 244 238 / 78%);
}

.entry-index-state--empty {
  border-left-color: rgb(111 91 55 / 44%);
}

.entry-index-item {
  display: grid;
  gap: 7px;
  width: calc(100% - 8px);
  padding: 13px 14px 13px 18px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-left: 4px solid rgb(69 148 122 / 70%);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  box-shadow: 0 8px 20px rgb(24 33 31 / 5%);
  text-align: left;
  cursor: pointer;
  will-change: transform;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.entry-index-item:not(:disabled):hover,
.entry-index-item:not(:disabled):focus-visible {
  border-color: rgb(69 148 122 / 34%);
  background: rgb(255 255 251 / 88%);
  box-shadow: 0 14px 26px rgb(24 33 31 / 8%);
  transform: translate3d(6px, 0, 0);
  outline: none;
}

.entry-index-item:disabled {
  cursor: wait;
}

.entry-index-item--active {
  border-color: rgb(16 59 49 / 34%);
  border-left-color: #103b31;
  background: rgb(231 241 236 / 84%);
}

.entry-index-item__title {
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 900;
  line-height: 1.18;
  overflow-wrap: anywhere;
}

.entry-index-item__date {
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.entry-index-item__tags,
.entry-book-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entry-index-item__tags span,
.entry-book-tags span {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgb(79 151 128 / 22%);
  border-radius: 7px;
  color: #305349;
  background: rgb(255 255 255 / 65%);
  font-size: 0.76rem;
  font-weight: 800;
}

.entry-book-stage {
  min-height: 520px;
  perspective: 1800px;
}

.entry-closed-book {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 520px;
}

.entry-closed-book__cover {
  position: relative;
  z-index: 1;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 14px;
  width: min(430px, 78%);
  min-height: 440px;
  padding: 46px;
  border: 1px solid rgb(12 42 36 / 24%);
  border-radius: 8px 16px 16px 8px;
  color: #f8f1df;
  background:
    linear-gradient(90deg, rgb(13 51 43), rgb(24 82 67) 58%, rgb(34 99 80)),
    #103b31;
  box-shadow:
    0 30px 70px rgb(24 33 31 / 20%),
    inset 18px 0 24px rgb(0 0 0 / 16%);
}

.entry-closed-book__cover::before {
  position: absolute;
  top: 24px;
  bottom: 24px;
  left: 42px;
  width: 1px;
  background: rgb(248 241 223 / 24%);
  content: '';
}

.entry-closed-book__cover span {
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.entry-closed-book__cover strong {
  font-family: var(--font-display);
  font-size: clamp(2rem, 3vw, 3.1rem);
  line-height: 1.05;
}

.entry-closed-book__cover small {
  color: rgb(248 241 223 / 76%);
  font-weight: 800;
}

.entry-closed-book__pages {
  position: absolute;
  width: min(430px, 78%);
  min-height: 430px;
  border-radius: 8px 16px 16px 8px;
  background: repeating-linear-gradient(180deg, #f7f0df 0 5px, #e8ddc6 5px 7px);
  transform: translate(14px, 11px);
  box-shadow: 0 22px 40px rgb(24 33 31 / 12%);
}

.entry-open-book {
  position: relative;
  min-height: 520px;
  border-radius: 8px;
  transform-style: preserve-3d;
  filter: drop-shadow(0 28px 60px rgb(24 33 31 / 14%));
  animation: book-settle 560ms cubic-bezier(0.22, 1, 0.36, 1);
}

.entry-quill {
  position: absolute;
  top: 34px;
  right: -52px;
  z-index: 8;
  width: 74px;
  height: 190px;
  border: 0;
  background: transparent;
  cursor: pointer;
  transform: rotate(18deg) translateZ(26px);
  transform-style: preserve-3d;
  filter: drop-shadow(0 20px 18px rgb(34 28 18 / 22%));
  transition:
    filter 220ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.entry-quill:hover,
.entry-quill:focus-visible {
  outline: none;
  filter: drop-shadow(0 30px 22px rgb(34 28 18 / 28%));
  transform: rotate(14deg) translate3d(-4px, -14px, 34px);
}

.entry-quill:disabled {
  cursor: wait;
  opacity: 0.72;
}

.entry-quill--active {
  filter:
    drop-shadow(0 30px 22px rgb(34 28 18 / 30%))
    drop-shadow(0 0 10px rgb(16 59 49 / 18%));
  transform: rotate(14deg) translate3d(-4px, -14px, 34px);
}

.entry-quill__feather {
  position: absolute;
  top: 0;
  left: 17px;
  width: 40px;
  height: 126px;
  border-radius: 72% 28% 64% 36% / 84% 68% 32% 16%;
  background:
    linear-gradient(124deg, rgb(255 255 255 / 96%) 0 35%, rgb(215 229 221 / 94%) 36% 62%, rgb(126 160 146 / 92%) 100%);
  box-shadow:
    inset -10px 8px 16px rgb(40 75 64 / 16%),
    inset 7px -4px 12px rgb(255 255 255 / 76%);
  transform-origin: 50% 100%;
}

.entry-quill__feather::before {
  position: absolute;
  top: 12px;
  bottom: -4px;
  left: 19px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(180deg, #f9f4e6, #8d7650);
  content: '';
  z-index: 1;
}

.entry-quill__feather::after {
  position: absolute;
  inset: 16px 8px 18px 8px;
  background:
    repeating-linear-gradient(136deg, rgb(45 91 76 / 28%) 0 1px, transparent 1px 10px),
    repeating-linear-gradient(44deg, rgb(255 255 255 / 52%) 0 1px, transparent 1px 12px);
  clip-path: polygon(46% 0, 100% 10%, 68% 100%, 0 88%);
  content: '';
}

.entry-quill__shaft {
  position: absolute;
  top: 110px;
  left: 35px;
  width: 8px;
  height: 76px;
  border-radius: 999px;
  background: linear-gradient(180deg, #a88648, #3b2f21 82%);
  box-shadow: inset -2px 0 2px rgb(255 255 255 / 34%);
}

.entry-quill__shaft::after {
  position: absolute;
  right: -2px;
  bottom: -4px;
  width: 12px;
  height: 22px;
  border-radius: 60% 40% 70% 30%;
  background: linear-gradient(160deg, #2d241c, #0f0d0a);
  content: '';
}

.entry-edit-actions {
  position: absolute;
  right: 24px;
  bottom: 20px;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 1px solid rgb(69 148 122 / 22%);
  border-radius: 999px;
  background: rgb(250 248 241 / 92%);
  box-shadow: 0 16px 32px rgb(32 58 50 / 12%);
  backdrop-filter: blur(8px);
}

.entry-edit-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 76px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 900;
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.entry-edit-action:hover:not(:disabled),
.entry-edit-action:focus-visible:not(:disabled) {
  outline: none;
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgb(32 58 50 / 14%);
}

.entry-edit-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

.entry-edit-action--save {
  color: #f8f1df;
  background: #103b31;
  border-color: rgb(16 59 49 / 18%);
}

.entry-edit-action--save:hover:not(:disabled),
.entry-edit-action--save:focus-visible:not(:disabled) {
  background: #174d40;
}

.entry-edit-action--delete {
  color: #8c3128;
  background: rgb(255 255 251 / 80%);
  border-color: rgb(140 49 40 / 24%);
}

.entry-edit-action--delete:hover:not(:disabled),
.entry-edit-action--delete:focus-visible:not(:disabled) {
  color: #f8f1df;
  background: #8c3128;
  border-color: #8c3128;
}

.entry-open-book::before {
  position: absolute;
  top: 22px;
  bottom: 22px;
  left: 50%;
  z-index: 6;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgb(87 68 39 / 10%), rgb(66 52 31 / 16%) 52%, rgb(255 255 255 / 14%));
  opacity: 0.78;
  transform: translateX(-50%);
  content: '';
  pointer-events: none;
}

.entry-book-spread {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  min-height: 520px;
  transform-style: preserve-3d;
}

.entry-book-spread--target {
  z-index: 1;
}

.entry-book-spread--current {
  z-index: 2;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.entry-book-page {
  display: grid;
  align-content: start;
  gap: 18px;
  min-height: 520px;
  padding: 42px 44px;
  border: 1px solid rgb(111 91 55 / 18%);
  color: #263631;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 42%), transparent 18%),
    repeating-linear-gradient(180deg, rgb(255 252 243 / 94%) 0 34px, rgb(237 226 204 / 30%) 35px 36px),
    #fbf6e8;
  overflow: hidden;
}

.entry-book-page--left {
  border-radius: 10px 3px 3px 10px;
  box-shadow: inset -20px 0 30px rgb(84 66 36 / 9%);
}

.entry-book-page--right {
  border-radius: 3px 10px 10px 3px;
  box-shadow: inset 20px 0 30px rgb(84 66 36 / 8%);
}

.entry-book-page__eyebrow {
  margin: 0;
  color: rgb(86 107 100);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.entry-book-page h2 {
  margin: 0;
  color: #17241f;
  font-family: var(--font-display);
  font-size: clamp(2rem, 3vw, 3.3rem);
  line-height: 1.08;
  overflow-wrap: anywhere;
}

.entry-editable-zone {
  position: relative;
  min-width: 0;
  margin: -8px;
  padding: 8px;
  border: 1px dashed transparent;
  border-radius: 8px;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.entry-editable-zone--enabled {
  border-color: rgb(69 148 122 / 42%);
  background:
    linear-gradient(90deg, rgb(69 148 122 / 8%), transparent 72%),
    rgb(255 255 255 / 18%);
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 34%),
    0 8px 18px rgb(32 58 50 / 6%);
  cursor: text;
}

.entry-editable-zone--enabled::after {
  position: absolute;
  top: -10px;
  right: 10px;
  padding: 2px 8px;
  border: 1px solid rgb(69 148 122 / 34%);
  border-radius: 999px;
  color: #285247;
  background: rgb(250 248 241 / 96%);
  box-shadow: 0 6px 14px rgb(32 58 50 / 8%);
  content: attr(data-edit-label);
  font-size: 0.68rem;
  font-weight: 900;
  line-height: 1.35;
  pointer-events: none;
}

.entry-editable-zone--enabled:hover,
.entry-editable-zone--active {
  border-color: rgb(16 59 49 / 62%);
  background:
    linear-gradient(90deg, rgb(69 148 122 / 14%), transparent 72%),
    rgb(255 255 255 / 26%);
  box-shadow:
    inset 0 0 0 1px rgb(16 59 49 / 12%),
    0 10px 22px rgb(32 58 50 / 9%);
}

.entry-editable-zone--active {
  border-style: solid;
}

.entry-editable-zone--active::after {
  border-color: rgb(16 59 49 / 48%);
  color: #f8f1df;
  background: #103b31;
}

.entry-editable-zone--title {
  align-self: start;
}

.entry-editable-zone--tags {
  min-height: 42px;
}

.entry-editable-zone--content {
  min-height: 360px;
}

.entry-inline-input,
.entry-inline-textarea {
  width: 100%;
  border: 1px dashed rgb(16 59 49 / 38%);
  border-radius: 6px;
  color: #17241f;
  background:
    linear-gradient(180deg, rgb(255 252 243 / 10%), rgb(255 252 243 / 20%)),
    transparent;
  box-shadow:
    inset 0 -1px 0 rgb(16 59 49 / 10%),
    0 8px 16px rgb(48 39 24 / 4%);
  font: inherit;
  outline: 0;
}

.entry-inline-input:focus,
.entry-inline-textarea:focus {
  border-color: #103b31;
  background:
    linear-gradient(180deg, rgb(255 252 243 / 8%), rgb(255 252 243 / 16%)),
    transparent;
  box-shadow:
    inset 0 -2px 0 rgb(16 59 49 / 18%),
    0 0 0 2px rgb(69 148 122 / 12%);
}

.entry-inline-input {
  min-height: 40px;
  padding: 8px 10px;
  font-weight: 800;
}

.entry-inline-input--title {
  min-height: 52px;
  padding: 2px 8px 5px;
  border-color: transparent transparent rgb(16 59 49 / 34%);
  border-radius: 0;
  font-family: var(--font-display);
  font-size: clamp(1.7rem, 2.5vw, 2.8rem);
  font-weight: 900;
  line-height: 1.08;
  box-shadow: inset 0 -1px 0 rgb(16 59 49 / 14%);
}

.entry-inline-textarea {
  min-height: 360px;
  resize: vertical;
  padding: 12px;
  line-height: 1.85;
}

.entry-empty-edit-hint {
  margin: 0;
  color: rgb(86 107 100 / 72%);
  font-size: 0.86rem;
  font-weight: 800;
}

.entry-edit-field-hint {
  margin: 6px 2px 0;
  color: rgb(86 107 100 / 76%);
  font-size: 0.76rem;
  font-weight: 800;
}

.entry-book-meta {
  display: grid;
  gap: 12px;
  margin: 0;
}

.entry-book-meta div {
  display: grid;
  gap: 4px;
}

.entry-book-meta dt {
  color: rgb(88 102 97);
  font-size: 0.78rem;
  font-weight: 900;
}

.entry-book-meta dd {
  margin: 0;
  color: #273c35;
  font-size: 0.92rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.entry-book-content {
  max-height: 410px;
  padding-right: 6px;
  overflow: auto;
}

.entry-book-content p {
  margin: 0;
  color: #31423c;
  font-size: 1rem;
  line-height: 1.9;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.entry-book-page--turning-side-hidden {
  visibility: hidden;
}

.entry-turning-stack {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  z-index: 5;
  width: 50%;
  pointer-events: none;
  transform-style: preserve-3d;
}

.entry-turning-sheet {
  position: absolute;
  inset: 0;
  border-radius: 3px 10px 10px 3px;
  box-shadow: -8px 0 16px rgb(67 54 35 / var(--page-shadow));
  transform: translateZ(var(--page-z)) rotateY(0deg);
  transform-origin: left center;
  transform-style: preserve-3d;
  animation: page-turn-forward var(--page-duration) linear var(--page-delay) both;
  backface-visibility: hidden;
  will-change: transform;
}

.entry-turning-sheet--blank {
  box-shadow: -5px 0 10px rgb(67 54 35 / 6%);
  animation-name: page-turn-forward-spacer;
}

.entry-turning-sheet::before {
  display: none;
}

.entry-turning-sheet::after {
  display: none;
}

.entry-turning-sheet__face {
  position: absolute;
  inset: 0;
  display: block;
  border-radius: inherit;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}

.entry-turning-sheet__face--back {
  transform: rotateY(180deg);
}

.entry-turning-sheet__page {
  position: absolute;
  inset: 0;
  min-height: 520px;
}

.entry-turning-sheet__page--blank {
  position: relative;
  padding: 0;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 46%), transparent 18%),
    repeating-linear-gradient(180deg, rgb(255 252 243) 0 34px, rgb(237 226 204 / 42%) 35px 36px),
    #fbf6e8;
}

.entry-turning-sheet__page--blank::before,
.entry-turning-sheet__page--blank::after {
  position: absolute;
  content: '';
  pointer-events: none;
}

.entry-turning-sheet__page--blank::before {
  inset: 42px 44px;
  opacity: 0.2;
  filter: blur(0.2px);
}

.entry-turning-sheet__page--blank.entry-book-page--left::before {
  background:
    linear-gradient(rgb(38 54 49 / 46%) 0 0) 0 0 / 58% 20px no-repeat,
    linear-gradient(rgb(38 54 49 / 28%) 0 0) 0 56px / 38% 12px no-repeat,
    linear-gradient(rgb(38 54 49 / 24%) 0 0) 0 84px / 66% 10px no-repeat,
    radial-gradient(circle, rgb(47 83 72 / 38%) 0 46%, transparent 48%) 0 132px / 18px 18px no-repeat,
    radial-gradient(circle, rgb(47 83 72 / 32%) 0 46%, transparent 48%) 28px 132px / 18px 18px no-repeat,
    radial-gradient(circle, rgb(47 83 72 / 28%) 0 46%, transparent 48%) 56px 132px / 18px 18px no-repeat,
    repeating-linear-gradient(180deg, transparent 0 24px, rgb(49 66 60 / 22%) 24px 26px, transparent 26px 36px);
}

.entry-turning-sheet__page--blank.entry-book-page--right::before {
  background:
    linear-gradient(rgb(38 54 49 / 28%) 0 0) 0 0 / 30% 12px no-repeat,
    repeating-linear-gradient(180deg, rgb(49 66 60 / 34%) 0 2px, transparent 2px 18px);
}

.entry-turning-sheet__page--blank::after {
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(90deg, rgb(255 255 255 / 28%), transparent 20%),
    radial-gradient(circle at 72% 18%, rgb(120 95 55 / 8%), transparent 30%);
}

.entry-open-book--backward .entry-turning-stack {
  left: 0;
}

.entry-open-book--backward .entry-turning-sheet {
  border-right-color: rgb(78 58 34 / 22%);
  border-left-color: rgb(120 95 55 / 16%);
  border-radius: 10px 3px 3px 10px;
  box-shadow: 8px 0 16px rgb(67 54 35 / var(--page-shadow));
  transform-origin: right center;
  animation-name: page-turn-backward;
}

.entry-open-book--backward .entry-turning-sheet--blank {
  box-shadow: 5px 0 10px rgb(67 54 35 / 6%);
  animation-name: page-turn-backward-spacer;
}

.entry-open-book--backward .entry-turning-sheet::before {
  display: none;
}

.entry-open-book--backward .entry-turning-sheet::after {
  display: none;
}

@keyframes page-turn-forward {
  0% {
    transform: translateZ(var(--page-z)) rotateY(0deg);
  }
  50% {
    transform: translateZ(var(--page-arc)) rotateY(-90deg);
  }
  100% {
    transform: translateZ(0) rotateY(-178deg);
  }
}

@keyframes page-turn-forward-spacer {
  0% {
    opacity: 1;
    transform: translateZ(var(--page-z)) rotateY(0deg);
  }
  50% {
    opacity: 1;
    transform: translateZ(var(--page-arc)) rotateY(-90deg);
  }
  100% {
    opacity: 0;
    transform: translateZ(0) rotateY(-170deg);
  }
}

@keyframes page-turn-backward {
  0% {
    transform: translateZ(var(--page-z)) rotateY(0deg);
  }
  50% {
    transform: translateZ(var(--page-arc)) rotateY(90deg);
  }
  100% {
    transform: translateZ(0) rotateY(178deg);
  }
}

@keyframes page-turn-backward-spacer {
  0% {
    opacity: 1;
    transform: translateZ(var(--page-z)) rotateY(0deg);
  }
  50% {
    opacity: 1;
    transform: translateZ(var(--page-arc)) rotateY(90deg);
  }
  100% {
    opacity: 0;
    transform: translateZ(0) rotateY(170deg);
  }
}

@keyframes book-settle {
  0% {
    opacity: 0.82;
    transform: translateY(8px) rotateX(2deg);
  }
  100% {
    opacity: 1;
    transform: translateY(0) rotateX(0deg);
  }
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.graph-layout {
  display: block;
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

.graph-popover {
  position: fixed;
  z-index: 220;
  width: min(320px, calc(100vw - 24px));
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(16 59 49 / 16%);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 253 250 / 96%);
  box-shadow: 0 18px 46px rgb(24 33 31 / 16%);
  backdrop-filter: blur(10px);
}

.graph-popover__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.graph-popover__header strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 0.98rem;
  font-weight: 900;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-popover__meta {
  margin: -2px 0 0;
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.graph-popover__content {
  max-height: 220px;
  overflow: auto;
  padding: 10px;
  border: 1px solid rgb(16 59 49 / 8%);
  border-radius: 6px;
  color: #31423c;
  background: rgb(248 246 238 / 76%);
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.graph-popover__actions {
  display: grid;
  gap: 6px;
}

.graph-popover__action {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 7px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 72%);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 900;
  cursor: pointer;
}

.graph-popover__action:hover {
  border-color: rgb(20 115 90 / 22%);
  background: rgb(232 241 237 / 72%);
}

.graph-popover__action--primary {
  color: #fff;
  border-color: #14735a;
  background: #14735a;
}

.graph-popover__action--primary:hover {
  background: #103b31;
}

.graph-popover-enter-active,
.graph-popover-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.graph-popover-enter-from,
.graph-popover-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* Responsive */
@media (max-width: 1040px) {
  .entry-book-layout {
    grid-template-columns: 1fr;
  }

  .entry-quill {
    right: 8px;
    top: 18px;
    transform: rotate(18deg) scale(0.86) translateZ(26px);
  }

  .entry-book-index {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 760px) {
  .studio-page {
    padding-block: 18px 40px;
  }

  .entry-book-index,
  .entry-open-book {
    grid-template-columns: 1fr;
  }

  .entry-book-stage,
  .entry-closed-book,
  .entry-open-book,
  .entry-book-page {
    min-height: auto;
  }

  .entry-book-page {
    padding: 28px 24px;
  }

  .entry-open-book::before,
  .entry-turning-stack {
    display: none;
  }

  .entry-book-page--left,
  .entry-book-page--right {
    border-radius: 8px;
  }

  .entry-book-content {
    max-height: 46vh;
  }

  .entry-quill {
    width: 56px;
    height: 150px;
    transform: rotate(18deg) scale(0.72) translateZ(20px);
    transform-origin: top right;
  }

  .entry-quill:hover,
  .entry-quill:focus-visible,
  .entry-quill--active {
    transform: rotate(14deg) scale(0.72) translate3d(-2px, -8px, 24px);
  }

  .entry-editable-zone--content,
  .entry-inline-textarea {
    min-height: 260px;
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

.entry-edit-confirm__text,
.entry-edit-confirm__note {
  margin: 0;
  line-height: 1.75;
}

.entry-edit-confirm__text {
  color: var(--color-ink);
  font-weight: 800;
}

.entry-edit-confirm__note {
  margin-top: 10px;
  color: var(--color-muted);
  font-size: 0.92rem;
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
