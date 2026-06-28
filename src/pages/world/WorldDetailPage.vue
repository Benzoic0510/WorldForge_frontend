<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useClickOutside } from '@/composables/useClickOutside'
import { listChangeLog } from '@/api/changelog'
import { listEntries } from '@/api/entry'
import { ApiError } from '@/api/http'
import { searchUsers } from '@/api/user'
import { forkWorld, getWorldDetail, joinWorld, applyJoinWorld, createWorldInvitation, listWorldMembers } from '@/api/world'
import { getStoryGraph } from '@/api/storyline'
import { useAuthStore } from '@/stores/auth'
import type { ChangeLogItem } from '@/types/changelog'
import type { EntryListItem } from '@/types/entry'
import type { StoryGraphData } from '@/types/storyline'
import type { UserSummary } from '@/types/user'
import type { ForkWorldResponse, PageResponse, WorldDetail } from '@/types/world'

type DetailTab = 'overview' | 'entries' | 'storylines' | 'updates'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isAuthenticated = computed(() => auth.isAuthenticated)
const world = ref<WorldDetail | null>(null)
const loading = ref(true)
const errorCode = ref('')
const errorMessage = ref('')
const activeTab = ref<DetailTab>('overview')

const entries = ref<EntryListItem[]>([])
const entriesLoaded = ref(false)
const entriesLoading = ref(false)
const entriesError = ref('')

const updates = ref<ChangeLogItem[]>([])
const updatesLoaded = ref(false)
const updatesLoading = ref(false)
const updatesError = ref('')

// --- Story lines ---
const storyGraphData = ref<StoryGraphData | null>(null)
const storyLinesLoading = ref(false)
const storyLinesLoaded = ref(false)

const worldId = computed(() => String(route.params.worldId || ''))
const isCreateMode = computed(() => route.query.mode === 'create')
const canEditWorld = computed(() => world.value?.viewer.canEdit === true)
const canReviewWorld = computed(() => world.value?.viewer.canReview === true)
const canManageWorld = computed(() => {
  const role = world.value?.viewer.role
  return role === 'creator' || role === 'co_admin'
})

const storyLineCounts = computed(() => {
  const nodes = storyGraphData.value?.nodes
  if (!nodes || nodes.length === 0) return null
  const main = nodes.filter(n => n.type === 'main').length
  const fork = nodes.filter(n => n.type === 'fork').length
  const merge = nodes.filter(n => n.type === 'merge').length
  return { total: nodes.length, main, fork, merge }
})

// --- Manage dropdown ---
const showManageDropdown = ref(false)
const manageDropdownRef = ref<HTMLElement | null>(null)

function toggleManageDropdown() {
  showManageDropdown.value = !showManageDropdown.value
}

useClickOutside(manageDropdownRef, () => {
  showManageDropdown.value = false
})

// --- Join / Apply / Invite ---
const isNotMember = computed(() => isAuthenticated.value && !world.value?.viewer.role)
const canJoinDirectly = computed(() =>
  isNotMember.value && world.value?.visibility === 'public'
)
const canApplyJoin = computed(() =>
  isNotMember.value &&
  (world.value?.visibility === 'protected')
)

function formatRole(role: string | null | undefined): string {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共同管理员'
  if (role === 'contributor') return '协作者'
  return ''
}

const showJoinModal = ref(false)
const joinModalMode = ref<'join' | 'apply' | 'invite'>('join')
const joinLoading = ref(false)
const joinError = ref('')
const applyMessage = ref('')
const inviteKeyword = ref('')
const inviteUsers = ref<UserSummary[]>([])
const inviteSearchLoading = ref(false)
const inviteHasSearched = ref(false)
const inviteSendingKey = ref('')
const invitedUserIds = ref<Set<string>>(new Set())
const inviteWorldMemberIds = ref<Set<string>>(new Set())
const brokenInviteAvatarIds = ref<Set<string>>(new Set())
const inviteSearchError = ref('')
const joinSuccessMessage = ref('')
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function dismissToast() {
  if (toastTimer.value) {
    clearTimeout(toastTimer.value)
    toastTimer.value = null
  }
  joinSuccessMessage.value = ''
}

function openJoinModal(mode: 'join' | 'apply' | 'invite') {
  joinModalMode.value = mode
  joinError.value = ''
  joinSuccessMessage.value = ''
  applyMessage.value = ''
  inviteKeyword.value = ''
  inviteUsers.value = []
  inviteHasSearched.value = false
  inviteSearchError.value = ''
  inviteSendingKey.value = ''
  invitedUserIds.value = new Set()
  brokenInviteAvatarIds.value = new Set()
  showJoinModal.value = true
  if (mode === 'invite') {
    void loadInviteWorldMembers()
  }
}

function closeJoinModal() {
  showJoinModal.value = false
}

async function executeJoinWorld() {
  joinLoading.value = true
  joinError.value = ''
  joinSuccessMessage.value = ''
  try {
    await joinWorld(worldId.value)
    joinSuccessMessage.value = '已成功加入世界！'
    toastTimer.value = setTimeout(() => { joinSuccessMessage.value = '' }, 5000)
    await loadWorld()
  } catch (error) {
    joinError.value = error instanceof ApiError ? error.message : '加入失败，请稍后重试。'
  } finally {
    joinLoading.value = false
  }
}

async function executeApplyJoin() {
  joinLoading.value = true
  joinError.value = ''
  try {
    await applyJoinWorld(worldId.value, {
      message: applyMessage.value.trim() || undefined
    })
    showJoinModal.value = false
    joinSuccessMessage.value = '申请已提交，等待世界管理员审核。'
    toastTimer.value = setTimeout(() => { joinSuccessMessage.value = '' }, 5000)
  } catch (error) {
    joinError.value = error instanceof ApiError ? error.message : '申请提交失败，请稍后重试。'
  } finally {
    joinLoading.value = false
  }
}

async function executeInviteSearch() {
  const keyword = inviteKeyword.value.trim()
  inviteSearchError.value = ''
  joinError.value = ''
  inviteHasSearched.value = true
  if (!keyword) {
    inviteUsers.value = []
    return
  }

  inviteSearchLoading.value = true
  try {
    await loadInviteWorldMembers()
    const users = await searchUsers(keyword, 20)
    const currentUserId = auth.currentUser?.userId || ''
    inviteUsers.value = users.filter((user) =>
      user.userId !== currentUserId &&
      !inviteWorldMemberIds.value.has(user.userId)
    )
  } catch (error) {
    inviteSearchError.value = error instanceof ApiError ? error.message : '用户搜索失败，请稍后重试。'
  } finally {
    inviteSearchLoading.value = false
  }
}

async function loadInviteWorldMembers() {
  if (!world.value) return
  try {
    const members = await listWorldMembers(world.value.worldId)
    inviteWorldMemberIds.value = new Set(members.map((member) => member.userId))
  } catch {
    inviteWorldMemberIds.value = new Set()
  }
}

function resetInviteSearchResults() {
  inviteUsers.value = []
  inviteHasSearched.value = false
  inviteSearchError.value = ''
}

function markInviteAvatarBroken(userId: string) {
  brokenInviteAvatarIds.value = new Set(brokenInviteAvatarIds.value).add(userId)
}

function shouldShowInviteAvatar(user: UserSummary): boolean {
  return Boolean(user.avatarUrl) && !brokenInviteAvatarIds.value.has(user.userId)
}

function inviteUserInitial(user: UserSummary): string {
  return (user.nickname || user.username || '?').trim().charAt(0).toUpperCase()
}

async function sendWorldInvitation(user: UserSummary, role: 'contributor' | 'co_admin') {
  if (!world.value || invitedUserIds.value.has(user.userId)) return
  const key = `${user.userId}:${role}`
  inviteSendingKey.value = key
  joinError.value = ''
  try {
    await createWorldInvitation(world.value.worldId, {
      inviteeUserId: user.userId,
      role,
      expiresInHours: 168
    })
    invitedUserIds.value = new Set(invitedUserIds.value).add(user.userId)
    joinSuccessMessage.value = `已向 ${user.nickname || user.username} 发送邀请。`
    toastTimer.value = setTimeout(() => { joinSuccessMessage.value = '' }, 5000)
  } catch (error) {
    joinError.value = error instanceof ApiError ? error.message : '邀请发送失败，请稍后重试。'
  } finally {
    inviteSendingKey.value = ''
  }
}

// --- Fork ---
const showForkModal = ref(false)
const forking = ref(false)
const forkError = ref('')
const forkName = ref('')
const forkVisibility = ref<WorldDetail['visibility']>('private')

function openForkModal() {
  if (!world.value) return
  forkName.value = `${world.value.name} Fork`.slice(0, 50)
  forkVisibility.value = 'private'
  forkError.value = ''
  showForkModal.value = true
}

function cancelFork() {
  showForkModal.value = false
  forkError.value = ''
}

async function executeFork() {
  const name = forkName.value.trim()
  if (!name) return

  forking.value = true
  forkError.value = ''

  try {
    const result: ForkWorldResponse = await forkWorld(worldId.value, {
      name,
      visibility: forkVisibility.value
    })
    showForkModal.value = false
    await router.push({ name: 'world-detail', params: { worldId: result.worldId } })
  } catch (error) {
    if (error instanceof ApiError) {
      forkError.value = error.message
    } else {
      forkError.value = 'Fork 失败，请稍后重试。'
    }
  } finally {
    forking.value = false
  }
}

const statusTitle = computed(() => {
  if (errorCode.value === 'NOT_FOUND') {
    return '这个世界没有被找到'
  }
  if (errorCode.value === 'FORBIDDEN') {
    return '你当前无法访问这个世界'
  }
  if (errorCode.value === 'UNAUTHORIZED') {
    return '登录后可访问更多内容'
  }
  return '世界档案暂时无法加载'
})

async function loadWorld() {
  loading.value = true
  errorCode.value = ''
  errorMessage.value = ''

  try {
    world.value = await getWorldDetail(worldId.value)
    if (isCreateMode.value && world.value.viewer.canEdit) {
      activeTab.value = 'entries'
      if (!entriesLoaded.value && !entriesLoading.value) {
        await fetchEntries()
      }
    }
  } catch (error) {
    world.value = null

    if (error instanceof ApiError) {
      errorCode.value = error.code
      errorMessage.value = error.message
    } else {
      errorMessage.value = '请稍后再试。'
    }
  } finally {
    loading.value = false
  }
}

function resetEntries() {
  entries.value = []
  entriesLoaded.value = false
  entriesLoading.value = false
  entriesError.value = ''
}

function resetUpdates() {
  updates.value = []
  updatesLoaded.value = false
  updatesLoading.value = false
  updatesError.value = ''
}

function resetTabData() {
  activeTab.value = 'overview'
  resetEntries()
  resetUpdates()
  storyGraphData.value = null
  storyLinesLoaded.value = false
  storyLinesLoading.value = false
}

function getPanelErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

async function fetchEntries() {
  entriesLoading.value = true
  entriesError.value = ''

  try {
    const data: PageResponse<EntryListItem> = await listEntries(worldId.value, {
      page: 1,
      pageSize: 4
    })

    entries.value = data.items
    entriesLoaded.value = true
    entriesError.value = ''
  } catch (error) {
    entriesError.value = getPanelErrorMessage(error, '词条列表暂时无法加载，请稍后重试。')
  } finally {
    entriesLoading.value = false
  }
}

async function fetchUpdates() {
  updatesLoading.value = true
  updatesError.value = ''

  try {
    const data: PageResponse<ChangeLogItem> = await listChangeLog(worldId.value, {
      page: 1,
      pageSize: 5
    })

    updates.value = data.items
    updatesLoaded.value = true
    updatesError.value = ''
  } catch (error) {
    updatesError.value = getPanelErrorMessage(error, '更新记录暂时无法加载，请稍后重试。')
  } finally {
    updatesLoading.value = false
  }
}

async function selectTab(nextTab: DetailTab) {
  activeTab.value = nextTab

  if (nextTab === 'entries' && !entriesLoaded.value && !entriesLoading.value) {
    await fetchEntries()
  }

  if (nextTab === 'updates' && !updatesLoaded.value && !updatesLoading.value) {
    await fetchUpdates()
  }

  if (nextTab === 'storylines' && !storyLinesLoaded.value && !storyLinesLoading.value) {
    await fetchStoryLines()
  }
}

async function fetchStoryLines() {
  storyLinesLoading.value = true
  try {
    storyGraphData.value = await getStoryGraph(worldId.value)
  } catch {
    storyGraphData.value = null
  } finally {
    storyLinesLoading.value = false
    storyLinesLoaded.value = true
  }
}

async function retryEntries() {
  await fetchEntries()
}

async function retryUpdates() {
  await fetchUpdates()
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function formatVisibility(value: WorldDetail['visibility']) {
  if (value === 'public') {
    return '公开'
  }
  if (value === 'protected') {
    return '受保护'
  }
  return '私有'
}

function formatActionType(value: string) {
  const actionMap: Record<string, string> = {
    'entry.create': '新增',
    'entry.update': '更新',
    'entry.delete': '删除',
    'story_push.approve': '采纳',
    create: '新增',
    update: '更新',
    delete: '删除',
    approve: '采纳'
  }

  return actionMap[value] || value
}

function formatTargetType(value: string) {
  const targetMap: Record<string, string> = {
    entry: '词条',
    story_push: '剧情提案',
    storyline: '故事线',
    world: '世界'
  }

  return targetMap[value] || value
}

function formatLineType(type: string): string {
  const map: Record<string, string> = { main: '主', fork: '分', merge: '合' }
  return map[type] || type
}

onMounted(async () => {
  await loadWorld()
})

onUnmounted(() => {
  if (toastTimer.value) {
    clearTimeout(toastTimer.value)
  }
})

watch(
  () => route.params.worldId,
  async () => {
    resetTabData()
    await loadWorld()
  }
)
</script>

<template>
  <main class="world-detail-page">
    <section v-if="loading" class="detail-shell page-container">
      <div class="detail-state">
        <p>正在展开世界档案...</p>
      </div>
    </section>

    <section v-else-if="!world" class="detail-shell page-container">
      <div class="detail-state detail-state--error">
        <h1>{{ statusTitle }}</h1>
        <p>{{ errorMessage || '请稍后再试。' }}</p>
        <div class="detail-state__actions">
          <button type="button" class="state-button state-button--primary" @click="loadWorld">
            重新加载
          </button>
          <RouterLink class="state-button" :to="{ name: 'discover' }">返回发现页</RouterLink>
        </div>
      </div>
    </section>

    <section v-else class="detail-shell page-container">
      <nav class="detail-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <strong>{{ world.name }}</strong>
      </nav>

      <header class="detail-hero">
        <div class="detail-hero__cover" :class="{ 'detail-hero__cover--empty': !world.coverImageUrl }">
          <img v-if="world.coverImageUrl" :src="world.coverImageUrl" :alt="`${world.name} 封面`" />
          <div v-else class="cover-fallback" aria-hidden="true">
            <span>World Record</span>
            <strong>{{ world.name }}</strong>
          </div>
        </div>

        <div class="detail-hero__body">
          <p class="eyebrow">World Record</p>
          <h1>{{ world.name }}</h1>
          <p class="detail-summary">
            {{ world.description || '这个世界还没有填写简介。' }}
          </p>

          <div class="tag-list" aria-label="标签">
            <span v-for="tag in world.tags" :key="tag">{{ tag }}</span>
          </div>

          <dl class="detail-meta">
            <div>
              <dt>创建者</dt>
              <dd>{{ world.creator.nickname }}</dd>
            </div>
            <div>
              <dt>可见性</dt>
              <dd>{{ formatVisibility(world.visibility) }}</dd>
            </div>
            <div>
              <dt>允许 Fork</dt>
              <dd>{{ world.allowFork ? '允许' : '关闭' }}</dd>
            </div>
            <div>
              <dt>允许 Merge</dt>
              <dd>{{ world.allowMerge ? '允许' : '关闭' }}</dd>
            </div>
          </dl>

          <!-- 操作按钮横条 -->
          <div class="detail-hero__actions">
            <template v-if="canEditWorld">
              <div class="detail-hero__button-row">
                <div ref="manageDropdownRef" class="manage-dropdown">
                  <button type="button" class="action-link" @click.stop="toggleManageDropdown">
                    管理世界 ▾
                  </button>
                  <div v-if="showManageDropdown" class="manage-dropdown__menu">
                    <RouterLink
                      v-if="canManageWorld"
                      class="manage-dropdown__item"
                      :to="{ name: 'world-edit', params: { worldId: world.worldId } }"
                      @click="showManageDropdown = false"
                    >
                      编辑世界信息
                    </RouterLink>
                    <button
                      v-if="world.allowFork"
                      type="button"
                      class="manage-dropdown__item"
                      @click="showManageDropdown = false; openForkModal()"
                    >
                      Fork 此世界观
                    </button>
                    <button
                      v-if="canManageWorld"
                      type="button"
                      class="manage-dropdown__item"
                      @click="showManageDropdown = false; openJoinModal('invite')"
                    >
                      邀请成员
                    </button>
                    <RouterLink
                      v-if="canManageWorld"
                      class="manage-dropdown__item"
                      :to="{ name: 'world-members', params: { worldId: world.worldId } }"
                      @click="showManageDropdown = false"
                    >
                      成员与申请
                    </RouterLink>
                  </div>
                </div>
                <RouterLink
                  class="action-link"
                  :to="{ name: 'world-studio', params: { worldId: world.worldId }, query: { view: 'entries' } }"
                >
                  进入创作
                </RouterLink>
                <RouterLink
                  class="action-link"
                  :to="{ name: 'rpg-chat', params: { worldId: world.worldId } }"
                >
                  角色扮演
                </RouterLink>
                <RouterLink
                  v-if="canReviewWorld"
                  class="action-link"
                  :to="{ name: 'review-submissions', params: { worldId: world.worldId } }"
                >
                  审核
                </RouterLink>
              </div>
              <span v-if="world.viewer.role" class="role-badge">你的权限：{{ formatRole(world.viewer.role) }}</span>
            </template>

            <template v-else>
              <!-- 未登录用户 -->
              <template v-if="!isAuthenticated">
                <RouterLink
                  class="action-link"
                  :to="{ name: 'world-studio', params: { worldId: world.worldId }, query: { view: 'entries' } }"
                >
                  查看词条
                </RouterLink>
                <RouterLink
                  class="action-link action-link--primary"
                  :to="{ name: 'login', query: { redirect: $route.fullPath } }"
                >
                  登录后加入
                </RouterLink>
              </template>

              <!-- 已登录但未加入 -->
              <template v-else>
                <RouterLink
                  class="action-link"
                  :to="{ name: 'world-studio', params: { worldId: world.worldId }, query: { view: 'entries' } }"
                >
                  查看词条
                </RouterLink>

                <!-- 公开世界 — 直接加入 -->
                <template v-if="canJoinDirectly">
                  <button
                    type="button"
                    class="action-link action-link--primary"
                    :disabled="joinLoading"
                    @click="executeJoinWorld"
                  >
                    {{ joinLoading ? '正在加入...' : '加入世界' }}
                  </button>
                  <div v-if="joinError" class="join-error" role="alert">{{ joinError }}</div>
                </template>

                <!-- 受保护世界 — 申请加入 -->
                <template v-else-if="canApplyJoin">
                  <button
                    type="button"
                    class="action-link action-link--primary"
                    :disabled="joinLoading"
                    @click="openJoinModal('apply')"
                  >
                    申请加入
                  </button>
                </template>

                <!-- 私有世界 — 仅限邀请 -->
                <template v-else>
                  <p class="invite-only-note">该世界仅能通过管理员邀请加入。</p>
                </template>
              </template>
            </template>
          </div>
        </div>
      </header>

      <nav class="detail-tabs" aria-label="世界内容">
        <button
          type="button"
          class="detail-tab"
          :class="{ 'detail-tab--active': activeTab === 'overview' }"
          @click="selectTab('overview')"
        >
          概览
        </button>
        <button
          type="button"
          class="detail-tab"
          :class="{ 'detail-tab--active': activeTab === 'entries' }"
          @click="selectTab('entries')"
        >
          词条
        </button>
        <button
          type="button"
          class="detail-tab"
          :class="{ 'detail-tab--active': activeTab === 'storylines' }"
          @click="selectTab('storylines')"
        >
          故事线
        </button>
        <button
          type="button"
          class="detail-tab"
          :class="{ 'detail-tab--active': activeTab === 'updates' }"
          @click="selectTab('updates')"
        >
          更新
        </button>
      </nav>

      <section v-if="activeTab === 'overview'" class="detail-grid">
        <article class="detail-panel">
          <div class="panel-heading">
            <p class="eyebrow">Statistics</p>
            <h2>世界规模</h2>
          </div>

          <dl class="stats-grid">
            <div>
              <dt>词条数</dt>
              <dd>{{ world.stats.entryCount }}</dd>
            </div>
            <div>
              <dt>成员数</dt>
              <dd>{{ world.stats.memberCount }}</dd>
            </div>
            <div>
              <dt>Fork 数</dt>
              <dd>{{ world.stats.forkCount }}</dd>
            </div>
          </dl>
        </article>

        <article class="detail-panel">
          <div class="panel-heading">
            <p class="eyebrow">Timestamps</p>
            <h2>档案时间</h2>
          </div>

          <dl class="time-list">
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatDate(world.createdAt) }}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{{ formatDate(world.updatedAt) }}</dd>
            </div>
            <div>
              <dt>世界 ID</dt>
              <dd>{{ world.worldId }}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section v-else-if="activeTab === 'entries'" class="content-panel">
        <div class="panel-heading panel-heading--split">
          <div>
            <p class="eyebrow">Entries</p>
            <h2>设定词条</h2>
          </div>
          <div class="panel-heading__actions">
            <span>{{ entries.length }} 条已加载</span>
            <RouterLink
              class="panel-action"
              :to="{ name: 'world-studio', params: { worldId: world.worldId }, query: { view: 'entries' } }"
            >
              查看全部词条
            </RouterLink>
          </div>
        </div>

        <div v-if="entriesLoading" class="inline-state">
          <p>正在整理词条档案...</p>
        </div>

        <div v-else-if="entriesError" class="inline-state inline-state--error">
          <h3>词条列表暂时不可用</h3>
          <p>{{ entriesError }}</p>
          <button type="button" class="panel-action" @click="retryEntries">重新加载</button>
        </div>

        <div v-else-if="entries.length === 0" class="inline-state">
          <h3>还没有词条</h3>
          <p>这个世界还没有公开可阅读的设定词条。</p>
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
              <strong>查看词条</strong>
            </div>
            <h3>{{ entry.title }}</h3>
            <p>{{ entry.summary || '暂无摘要。' }}</p>
            <div class="tag-list tag-list--compact" aria-label="标签">
              <span v-for="tag in entry.tags" :key="tag">{{ tag }}</span>
            </div>
          </RouterLink>
        </div>
      </section>

      <section v-else-if="activeTab === 'storylines'" class="content-panel">
        <div class="panel-heading">
          <p class="eyebrow">Story Lines</p>
          <h2>故事线</h2>
        </div>

        <!-- 加载中 -->
        <p v-if="storyLinesLoading" class="storylines-intro">正在读取世界线结构...</p>

        <!-- 有数据 -->
        <template v-else-if="storyGraphData && storyLineCounts">
          <p class="storylines-intro">
            这个世界共有 <strong>{{ storyLineCounts.total }}</strong> 条故事线：
            主 {{ storyLineCounts.main }} · 分叉 {{ storyLineCounts.fork }} · 合并 {{ storyLineCounts.merge }}
          </p>

          <div class="storyline-mini-list">
            <RouterLink
              v-for="node in storyGraphData.nodes"
              :key="node.nodeId"
              class="storyline-mini-chip"
              :class="`storyline-mini-chip--${node.type}`"
              :to="{ name: 'line-content', params: { worldId, lineId: node.lineId } }"
            >
              <span class="storyline-mini-chip__type">{{ formatLineType(node.type) }}</span>
              {{ node.name }}
            </RouterLink>
          </div>

          <div class="storylines-actions">
            <RouterLink
              class="panel-action"
              :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }"
            >
              查看完整世界线树图
            </RouterLink>
          </div>
        </template>

        <!-- 无数据或加载失败 -->
        <template v-else>
          <p class="storylines-intro">
            世界线树图展示这个世界中所有剧情分支与合并收束的关系。
          </p>
          <div class="storylines-actions">
            <RouterLink
              class="panel-action"
              :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }"
            >
              查看世界线树图
            </RouterLink>
          </div>
        </template>
      </section>

      <section v-else-if="activeTab === 'updates'" class="content-panel">
        <div class="panel-heading panel-heading--split">
          <div>
            <p class="eyebrow">Change Log</p>
            <h2>更新记录</h2>
          </div>
          <div class="panel-heading__actions">
            <span>{{ updates.length }} 条已加载</span>
            <RouterLink
              class="panel-action"
              :to="{ name: 'world-changelog', params: { worldId: world.worldId } }"
            >
              查看全部更新
            </RouterLink>
          </div>
        </div>

        <div v-if="updatesLoading" class="inline-state">
          <p>正在读取世界更新记录...</p>
        </div>

        <div v-else-if="updatesError" class="inline-state inline-state--error">
          <h3>更新记录暂时不可用</h3>
          <p>{{ updatesError }}</p>
          <button type="button" class="panel-action" @click="retryUpdates">重新加载</button>
        </div>

        <div v-else-if="updates.length === 0" class="inline-state">
          <h3>还没有更新记录</h3>
          <p>当词条或剧情提案发生变化时，这里会留下可阅读的时间线。</p>
        </div>

        <div v-else class="timeline-list">
          <article v-for="item in updates" :key="item.changelogId" class="timeline-item">
            <div class="timeline-item__rail" aria-hidden="true"></div>
            <div class="timeline-item__body">
              <div class="timeline-item__meta">
                <span>{{ formatActionType(item.actionType) }}</span>
                <strong>{{ formatTargetType(item.targetType) }}</strong>
                <time>{{ formatDate(item.occurredAt) }}</time>
              </div>
              <h3>{{ item.title || item.targetId }}</h3>
              <p>{{ item.summary || '这次更新没有留下摘要。' }}</p>
              <small v-if="item.lineName">关联故事线：{{ item.lineName }}</small>
            </div>
          </article>
        </div>
      </section>
    </section>
  </main>

  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="showForkModal"
        class="modal-overlay"
        @click.self="cancelFork"
        @keydown.escape="cancelFork"
      >
        <div class="modal-card modal-card--fork" role="dialog" aria-modal="true" aria-labelledby="fork-title">
          <div class="fork-modal__header">
            <h2 id="fork-title">Fork 世界观</h2>
            <p>从 <strong>{{ world?.name }}</strong> 分叉出独立的新世界。</p>
          </div>

          <div class="fork-modal__body">
            <label class="field">
              <span class="field-label">新世界名称</span>
              <input
                v-model="forkName"
                type="text"
                class="field-input"
                maxlength="50"
                placeholder="输入新世界名称"
                :disabled="forking"
                @keydown.enter="executeFork"
              />
            </label>

            <label class="field">
              <span class="field-label">可见性</span>
              <select v-model="forkVisibility" class="field-input" :disabled="forking">
                <option value="private">私有 — 仅自己可见</option>
                <option value="public">公开 — 所有人可见</option>
                <option value="protected">受保护 — 需申请或邀请加入</option>
              </select>
            </label>

            <div v-if="forkError" class="fork-error" role="alert">
              {{ forkError }}
            </div>
          </div>

          <div class="fork-modal__footer">
            <button type="button" class="btn-cancel" :disabled="forking" @click="cancelFork">
              取消
            </button>
            <button
              type="button"
              class="btn-fork"
              :disabled="forking || !forkName.trim()"
              @click="executeFork"
            >
              {{ forking ? '正在分叉...' : '确认 Fork' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Join / Apply / Invite Modal -->
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="showJoinModal"
        class="modal-overlay"
        @click.self="closeJoinModal"
        @keydown.escape="closeJoinModal"
      >
        <div class="modal-card modal-card--join" role="dialog" aria-modal="true" aria-labelledby="join-title">
          <div class="join-modal__header">
            <h2 id="join-title">
              {{ joinModalMode === 'apply' ? '申请加入世界' : '邀请成员' }}
            </h2>
          </div>

          <div class="join-modal__body">
            <!-- apply 模式：消息输入 -->
            <template v-if="joinModalMode === 'apply'">
              <label class="field">
                <span class="field-label">申请理由（可选）</span>
                <textarea
                  v-model="applyMessage"
                  class="field-input field-input--textarea"
                  maxlength="500"
                  placeholder="介绍一下自己，或者说明为什么想加入这个世界..."
                  :disabled="joinLoading"
                ></textarea>
              </label>
            </template>

            <!-- invite 模式：搜索用户并直接发送邀请 -->
            <template v-if="joinModalMode === 'invite'">
              <div class="invite-search">
                <label class="invite-search__bar">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10.8 4.5a6.3 6.3 0 1 1 0 12.6 6.3 6.3 0 0 1 0-12.6Zm0 1.8a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm5.42 9.2 3.28 3.28-1.27 1.27-3.28-3.28 1.27-1.27Z" />
                  </svg>
                  <input
                    v-model="inviteKeyword"
                    type="text"
                    placeholder="输入用户名后按 Enter 搜索"
                    :disabled="inviteSearchLoading"
                    @input="resetInviteSearchResults"
                    @keydown.enter="executeInviteSearch"
                  />
                </label>

                <div v-if="inviteSearchLoading" class="invite-search__state">正在搜索...</div>
                <div v-else-if="inviteSearchError" class="invite-search__state invite-search__state--error">
                  {{ inviteSearchError }}
                </div>
                <div v-else-if="inviteHasSearched && inviteKeyword.trim() && inviteUsers.length === 0" class="invite-search__state">
                  没有找到可邀请用户
                </div>

                <div v-if="inviteUsers.length > 0" class="invite-user-list">
                  <div v-for="user in inviteUsers" :key="user.userId" class="invite-user-row">
                    <img
                      v-if="shouldShowInviteAvatar(user)"
                      class="invite-user-row__avatar"
                      :src="user.avatarUrl"
                      :alt="`${user.nickname || user.username} 的头像`"
                      @error="markInviteAvatarBroken(user.userId)"
                    />
                    <span v-else class="invite-user-row__avatar invite-user-row__avatar--fallback">
                      {{ inviteUserInitial(user) }}
                    </span>
                    <div class="invite-user-row__identity">
                      <strong>{{ user.username }}</strong>
                      <span>{{ user.nickname || '未设置昵称' }}</span>
                    </div>
                    <div class="invite-user-row__actions">
                      <button
                        type="button"
                        class="invite-role-btn"
                        :disabled="invitedUserIds.has(user.userId) || inviteSendingKey === `${user.userId}:contributor`"
                        @click="sendWorldInvitation(user, 'contributor')"
                      >
                        {{ invitedUserIds.has(user.userId) ? '已邀请' : '邀请成为协作者' }}
                      </button>
                      <button
                        type="button"
                        class="invite-role-btn invite-role-btn--admin"
                        :disabled="invitedUserIds.has(user.userId) || inviteSendingKey === `${user.userId}:co_admin`"
                        @click="sendWorldInvitation(user, 'co_admin')"
                      >
                        {{ invitedUserIds.has(user.userId) ? '等待回应' : '邀请成为共同管理员' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 错误消息 -->
            <div v-if="joinError" class="join-error" role="alert">{{ joinError }}</div>
          </div>

          <div class="join-modal__footer">
            <button
              type="button"
              class="btn-cancel"
              :disabled="joinLoading"
              @click="closeJoinModal"
            >
              取消
            </button>

            <button
              v-if="joinModalMode === 'apply'"
              type="button"
              class="btn-join"
              :disabled="joinLoading"
              @click="executeApplyJoin"
            >
              {{ joinLoading ? '处理中...' : '提交申请' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Toast -->
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="joinSuccessMessage" class="toast" role="status" @click="dismissToast">
        <span class="toast__icon">&#10003;</span>
        <span class="toast__message">{{ joinSuccessMessage }}</span>
        <button type="button" class="toast__close" aria-label="关闭" @click.stop="dismissToast">&times;</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.world-detail-page {
  padding-block: 28px 56px;
}

.detail-shell {
  display: grid;
  gap: 18px;
}

.detail-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.detail-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.detail-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.role-badge-breadcrumb {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #14735a;
  background: rgb(232 241 237 / 72%);
  font-size: 0.72rem;
  font-weight: 800;
}

.detail-state {
  display: grid;
  gap: 16px;
  min-height: 320px;
  padding: 32px;
  align-content: center;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 48%);
  box-shadow: var(--shadow-panel);
}

.detail-state--error,
.inline-state--error {
  background: rgb(108 36 36 / 6%);
}

.detail-state h1,
.detail-state p,
.inline-state h3,
.inline-state p,
.entry-card p,
.timeline-item p {
  margin: 0;
}

.detail-state h1,
.panel-heading h2,
.detail-hero__body h1,
.entry-card h3,
.timeline-item h3 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.detail-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.detail-state p,
.inline-state p,
.entry-card p,
.timeline-item p {
  color: var(--color-muted);
  line-height: 1.75;
}

.detail-state__actions {
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
}

.panel-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

.detail-hero {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.35fr);
  gap: 18px;
  align-items: stretch;
}

.detail-hero__cover,
.detail-hero__body,
.detail-panel,
.content-panel {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 84%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.detail-hero__cover {
  overflow: hidden;
  min-height: 420px;
}

.detail-hero__cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-hero__cover--empty {
  background:
    linear-gradient(135deg, rgb(16 59 49 / 94%), rgb(42 89 74 / 92%)),
    #103b31;
}

.cover-fallback {
  display: grid;
  height: 100%;
  padding: 24px;
  align-content: space-between;
  color: rgb(246 242 232 / 92%);
}

.cover-fallback span {
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
}

.cover-fallback strong {
  max-width: 100%;
  font-family: var(--font-display);
  font-size: clamp(1.6rem, 2.8vw, 2.9rem);
  line-height: 1.08;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-hero__body,
.detail-panel,
.content-panel {
  padding: 22px;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.detail-hero__body h1 {
  margin: 0;
  font-size: clamp(2.4rem, 4vw, 4.3rem);
  line-height: 1.02;
}

.detail-summary {
  margin: 18px 0 0;
  color: var(--color-muted);
  line-height: 1.85;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.tag-list--compact {
  margin-top: 0;
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

.detail-meta,
.time-list,
.stats-grid {
  display: grid;
  gap: 12px;
}

.detail-meta {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 22px 0 0;
}

.detail-meta div,
.time-list div,
.stats-grid div {
  display: grid;
  gap: 6px;
}

.detail-meta dt,
.time-list dt,
.stats-grid dt {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-transform: uppercase;
}

.detail-meta dd,
.time-list dd,
.stats-grid dd {
  min-width: 0;
  margin: 0;
  color: var(--color-ink);
  font-size: 1rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  font: inherit;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.action-link--primary {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.action-link:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

/* ---------- Hero actions strip ---------- */
.detail-hero__actions {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding-top: 10px;
}

.detail-hero__button-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.manage-dropdown {
  position: relative;
  display: inline-flex;
}

.manage-dropdown__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 180px;
  padding: 6px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 86%), rgb(244 240 231 / 92%)),
    rgb(255 255 255 / 64%);
  box-shadow: var(--shadow-panel);
}

.manage-dropdown__item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: var(--color-ink);
  background: transparent;
  font: inherit;
  font-weight: 700;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms ease;
}

.manage-dropdown__item:hover {
  background: rgb(232 241 237 / 52%);
}

.panel-heading__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.detail-tabs {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 4px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 58%);
  box-shadow: 0 14px 40px rgb(24 33 31 / 8%);
}

.detail-tab {
  min-width: 92px;
  min-height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 7px;
  color: var(--color-muted);
  background: transparent;
  font-weight: 900;
  cursor: pointer;
}

.detail-tab--active {
  color: #fff;
  background: #103b31;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.panel-heading {
  margin-bottom: 18px;
}

.panel-heading--split {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.panel-heading h2,
.panel-heading p {
  margin: 0;
}

.panel-heading > span {
  color: var(--color-muted);
  font-size: 0.88rem;
  font-weight: 800;
  white-space: nowrap;
}

.stats-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stats-grid dd {
  font-size: 2rem;
  line-height: 1;
}

.content-panel {
  display: grid;
  gap: 18px;
}

.inline-state {
  display: grid;
  gap: 12px;
  min-height: 190px;
  padding: 24px;
  align-content: center;
  border: 1px dashed var(--color-line-strong);
  border-radius: 8px;
  background: rgb(255 255 255 / 42%);
}

.inline-state h3 {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.6rem;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.entry-card {
  display: grid;
  gap: 12px;
  min-height: 210px;
  padding: 18px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 50%);
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

.entry-card h3,
.timeline-item h3 {
  margin: 0;
  font-size: 1.45rem;
  line-height: 1.2;
}

.timeline-list {
  display: grid;
  gap: 0;
}

.timeline-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 14px;
}

.timeline-item__rail {
  position: relative;
}

.timeline-item__rail::before {
  position: absolute;
  top: 4px;
  left: 9px;
  width: 10px;
  height: 10px;
  border: 2px solid #103b31;
  border-radius: 50%;
  background: var(--surface);
  content: "";
}

.timeline-item__rail::after {
  position: absolute;
  top: 20px;
  bottom: 0;
  left: 14px;
  width: 1px;
  background: var(--color-line-strong);
  content: "";
}

.timeline-item:last-child .timeline-item__rail::after {
  display: none;
}

.timeline-item__body {
  display: grid;
  gap: 8px;
  padding: 0 0 22px;
}

.timeline-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.timeline-item__meta span,
.timeline-item__meta strong {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 999px;
}

.timeline-item__meta span {
  color: #fff;
  background: #103b31;
}

.timeline-item__meta strong {
  color: #305349;
  background: rgb(232 241 237 / 72%);
}

.timeline-item small {
  color: #446257;
  font-weight: 800;
}

/* ---------------------------------- Fork Modal ---------------------------------- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 32px 16px;
  background: rgb(16 59 49 / 26%);
  backdrop-filter: blur(4px);
}

.modal-card {
  position: relative;
  width: 100%;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 86%), rgb(244 240 231 / 92%)),
    rgb(255 255 255 / 64%);
  box-shadow: 0 32px 90px rgb(24 33 31 / 28%);
}

.modal-card--fork {
  max-width: 480px;
  padding: 28px;
}

.fork-modal__header {
  margin-bottom: 24px;
}

.fork-modal__header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.8rem;
  line-height: 1.2;
}

.fork-modal__header p {
  margin: 8px 0 0;
  color: var(--color-muted);
  line-height: 1.65;
}

.fork-modal__header strong {
  color: var(--color-ink);
  font-weight: 900;
}

.fork-modal__body {
  display: grid;
  gap: 18px;
}

.field {
  display: grid;
  gap: 6px;
}

.field-label {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-transform: uppercase;
}

.field-input {
  display: block;
  width: 100%;
  min-height: 42px;
  padding: 0 14px;
  border: 1px solid var(--color-line-strong);
  border-radius: 7px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 68%);
  font: inherit;
  font-size: 0.95rem;
}

.field-input:focus {
  border-color: #103b31;
  outline: 0;
  box-shadow: 0 0 0 3px rgb(20 115 90 / 12%);
}

.field-input:disabled {
  opacity: 0.62;
}

.fork-error {
  padding: 12px 14px;
  border: 1px solid rgb(108 36 36 / 28%);
  border-radius: 7px;
  color: #6c2424;
  background: rgb(108 36 36 / 6%);
  font-size: 0.88rem;
  font-weight: 800;
  line-height: 1.55;
}

.fork-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.btn-cancel,
.btn-fork {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 20px;
  border-radius: 8px;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.btn-cancel {
  border: 1px solid var(--color-line-strong);
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
}

.btn-cancel:disabled {
  opacity: 0.52;
}

.btn-fork {
  border: 1px solid #103b31;
  color: #fff;
  background: #103b31;
}

.btn-fork:disabled {
  opacity: 0.52;
}

/* Modal transition */
.modal-enter-active .modal-card,
.modal-leave-active .modal-card {
  transition:
    transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 240ms ease;
}

.modal-enter-active .modal-overlay,
.modal-leave-active .modal-overlay {
  transition: opacity 220ms ease;
}

.modal-enter-from .modal-card {
  transform: translateY(20px) scale(0.97);
  opacity: 0;
}

.modal-leave-to .modal-card {
  transform: translateY(14px) scale(0.98);
  opacity: 0;
}

.modal-enter-from .modal-overlay,
.modal-leave-to .modal-overlay {
  opacity: 0;
}

/* ---------- Join Modal ---------- */
.modal-card--join {
  width: min(760px, calc(100vw - 32px));
  max-width: none;
  padding: 28px;
}

.join-modal__header {
  margin-bottom: 20px;
}

.join-modal__header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.4rem;
}

.join-modal__body {
  display: grid;
  gap: 18px;
}

.join-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.field-input--textarea {
  min-height: 100px;
  resize: vertical;
  padding: 12px 14px;
  line-height: 1.6;
}

.btn-join {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 20px;
  border: 1px solid #103b31;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.btn-join:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

/* Toast */
.toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 320px;
  max-width: 480px;
  padding: 16px 20px;
  border-radius: 10px;
  background: #103b31;
  color: #fff;
  box-shadow: 0 12px 48px rgb(16 59 49 / 38%);
  cursor: pointer;
}

.toast__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(255 255 255 / 20%);
  font-size: 0.85rem;
  font-weight: 900;
  flex-shrink: 0;
}

.toast__message {
  flex: 1;
  font-weight: 800;
  font-size: 0.95rem;
  line-height: 1.4;
}

.toast__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: rgb(255 255 255 / 72%);
  background: rgb(255 255 255 / 10%);
  font-size: 1.2rem;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 140ms ease;
}

.toast__close:hover {
  background: rgb(255 255 255 / 22%);
}

/* Toast transition */
.toast-enter-active {
  transition: all 280ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.toast-leave-active {
  transition: all 200ms ease;
}

.toast-enter-from {
  transform: translateX(-50%) translateY(-16px);
  opacity: 0;
}

.toast-leave-to {
  transform: translateX(-50%) translateY(-12px);
  opacity: 0;
}

/* Join Error */
.join-error {
  padding: 12px 14px;
  border: 1px solid rgb(180 70 70 / 32%);
  border-radius: 8px;
  color: #982222;
  background: rgb(255 235 235 / 78%);
  font-size: 0.9rem;
  line-height: 1.5;
}

.invite-only-note {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 8px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 62%);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.5;
}

.invite-search {
  display: grid;
  gap: 12px;
}

.invite-search__bar {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid rgb(16 59 49 / 16%);
  border-radius: 999px;
  background: rgb(255 255 255 / 76%);
}

.invite-search__bar:focus-within {
  border-color: #14735a;
}

.invite-search__bar svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: #14735a;
}

.invite-search__bar input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--color-ink);
  background: transparent;
  font: inherit;
  font-size: 0.94rem;
}

.invite-search__bar input:focus,
.invite-search__bar input:focus-visible {
  outline: 0;
  box-shadow: none;
}

.invite-search__state {
  padding: 10px 12px;
  border: 1px dashed rgb(16 59 49 / 14%);
  border-radius: 8px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 48%);
  font-size: 0.86rem;
  font-weight: 800;
}

.invite-search__state--error {
  border-color: rgb(180 70 70 / 28%);
  color: #982222;
  background: rgb(255 235 235 / 68%);
}

.invite-user-list {
  display: grid;
  max-height: 360px;
  overflow: auto;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 8px;
  background: rgb(255 253 250 / 72%);
}

.invite-user-row {
  display: grid;
  grid-template-columns: 46px minmax(220px, 1fr) auto;
  gap: 13px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid rgb(16 59 49 / 8%);
}

.invite-user-row:last-child {
  border-bottom: 0;
}

.invite-user-row__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  object-fit: cover;
  background: rgb(232 241 237);
  color: #14735a;
  font-size: 1rem;
  font-weight: 900;
  flex: 0 0 auto;
}

.invite-user-row__avatar--fallback {
  border: 1px solid rgb(20 115 90 / 16%);
}

.invite-user-row__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.invite-user-row__identity strong,
.invite-user-row__identity span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.invite-user-row__identity strong {
  color: var(--color-ink);
  font-size: 0.94rem;
  font-weight: 900;
}

.invite-user-row__identity span {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
}

.invite-user-row__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.invite-role-btn {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid rgb(20 115 90 / 22%);
  border-radius: 8px;
  color: #14735a;
  background: rgb(232 241 237 / 68%);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.invite-role-btn--admin {
  color: #103b31;
  background: #fffdfa;
}

.invite-role-btn:disabled {
  cursor: not-allowed;
  opacity: 0.52;
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
}

.storylines-intro {
  margin: 16px 0 24px;
  color: var(--color-muted);
  line-height: 1.75;
}

.storylines-intro strong {
  color: var(--color-ink);
  font-weight: 900;
}

.storyline-mini-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.storyline-mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 14px 0 4px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: none;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.storyline-mini-chip:hover {
  border-color: rgb(20 115 90 / 34%);
  box-shadow: 0 4px 16px rgb(24 33 31 / 8%);
}

.storyline-mini-chip__type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  min-height: 26px;
  border-radius: 6px;
  color: #fff;
  background: #103b31;
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
}

.storyline-mini-chip--fork .storyline-mini-chip__type {
  background: #305349;
  color: #e8f1ed;
}

.storyline-mini-chip--merge .storyline-mini-chip__type {
  background: #6c5b24;
  color: #faf5e8;
}

.storylines-actions {
  display: flex;
  gap: 12px;
}

@media (max-width: 1120px) {
  .detail-hero {
    grid-template-columns: 1fr;
  }

  .detail-hero__cover {
    min-height: 320px;
  }
}

@media (max-width: 820px) {
  .entry-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .world-detail-page {
    padding-block: 18px 40px;
  }

  .detail-state,
  .detail-hero__body,
  .detail-panel,
  .content-panel {
    padding: 18px;
  }

  .detail-tabs {
    width: 100%;
  }

  .detail-tab {
    flex: 1;
    min-width: 0;
  }

  .detail-meta,
  .detail-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .panel-heading--split {
    display: grid;
  }

  .panel-heading > span {
    white-space: normal;
  }
}
</style>
