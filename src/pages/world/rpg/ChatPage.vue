<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  addChannelMembers,
  createChannel,
  deleteChannel,
  leaveChannel,
  listChannelMessages,
  listChannels,
  listMyOcs,
  recallChannelMessage,
  removeChannelMember
} from '@/api/rpg'
import { ApiError } from '@/api/http'
import { buildWebSocketUrl as buildApiWebSocketUrl } from '@/api/websocket'
import { getWorldDetail, listWorldMembers } from '@/api/world'
import { useAuthStore } from '@/stores/auth'
import { useClickOutside } from '@/composables/useClickOutside'
import type { ChatMessageResponse, OcResponse, RpgChannelResponse } from '@/types/rpg'
import type { WorldMember } from '@/types/world'

const route = useRoute()
const authStore = useAuthStore()

const worldId = computed(() => String(route.params.worldId || ''))

const channels = ref<RpgChannelResponse[]>([])
const channelsLoading = ref(true)
const channelsError = ref('')
const selectedChannelId = ref<string | null>(null)

const selectedChannel = computed(() =>
  channels.value.find((channel) => channel.channelId === selectedChannelId.value) ?? null
)
const selectedChannelMemberIds = computed(() => selectedChannel.value?.memberUserIds ?? [])
const selectedChannelCreatorId = computed(() =>
  selectedChannel.value?.creatorUserId ?? ''
)

const worldRole = ref<'creator' | 'co_admin' | 'contributor' | null>(null)
const members = ref<WorldMember[]>([])
const membersLoading = ref(false)
const membersError = ref('')

const canCreatePublicChannel = computed(() =>
  worldRole.value === 'creator' || worldRole.value === 'co_admin'
)

const canCreateChannel = computed(() => Boolean(worldRole.value))
const canManageSelectedChannel = computed(() =>
  Boolean(selectedChannel.value && selectedChannelCreatorId.value === authStore.currentUser?.userId)
)
const canLeaveSelectedChannel = computed(() =>
  Boolean(
    selectedChannel.value?.channelType === 'private' &&
    authStore.currentUser?.userId &&
    selectedChannelMemberIds.value.includes(authStore.currentUser.userId) &&
    !canManageSelectedChannel.value
  )
)
const canInviteSelectedChannelMembers = computed(() =>
  Boolean(selectedChannel.value?.channelType === 'private' && canManageSelectedChannel.value)
)
const canOpenChannelPanel = computed(() =>
  Boolean(selectedChannel.value?.channelType === 'private' || canManageSelectedChannel.value)
)

const visibleMembers = computed(() =>
  members.value.filter((member) => member.userId !== authStore.currentUser?.userId)
)
const channelMembers = computed(() =>
  members.value.filter((member) => selectedChannelMemberIds.value.includes(member.userId))
)
const availableChannelMembers = computed(() =>
  visibleMembers.value.filter((member) => !selectedChannelMemberIds.value.includes(member.userId))
)

const messages = ref<ChatMessageResponse[]>([])
const messagesLoading = ref(false)
const messagesError = ref('')
const hasMoreMessages = ref(false)
const nextBeforeSentAt = ref<string | null>(null)
const nextBeforeMessageId = ref<string | null>(null)
const messageAreaRef = ref<HTMLElement | null>(null)

const messageInput = ref('')
const sending = ref(false)
const sendError = ref('')
const recallError = ref('')

const contextMenu = ref<{
  visible: boolean
  x: number
  y: number
  message: ChatMessageResponse | null
}>({
  visible: false,
  x: 0,
  y: 0,
  message: null
})

const socket = ref<WebSocket | null>(null)
const socketReady = ref(false)
const socketError = ref('')
const reconnectTimer = ref<number | null>(null)
const shouldReconnect = ref(true)

type Identity =
  | { type: 'ooc' }
  | { type: 'oc'; oc: OcResponse }

const selectedIdentity = ref<Identity>({ type: 'ooc' })
const identityPanelOpen = ref(false)
const identityRef = ref<HTMLElement | null>(null)
const ocs = ref<OcResponse[]>([])
const ocsLoaded = ref(false)
const ocsError = ref('')

const createPanelOpen = ref(false)
const createName = ref('')
const createChannelType = ref<'public' | 'private'>('private')
const selectedMemberIds = ref<string[]>([])
const creatingChannel = ref(false)
const createError = ref('')
const managePanelOpen = ref(false)
const channelAddMemberIds = ref<string[]>([])
const channelManaging = ref(false)
const channelActionKey = ref('')
const channelManageError = ref('')
const channelManageMessage = ref('')

const displayName = computed(() => {
  if (selectedIdentity.value.type === 'oc') {
    return selectedIdentity.value.oc.name
  }
  return authStore.currentUser?.nickname || authStore.currentUser?.username || '本人'
})

const isOoc = computed(() => selectedIdentity.value.type === 'ooc')

const identityAvatarLetter = computed(() => {
  if (selectedIdentity.value.type === 'oc') {
    return selectedIdentity.value.oc.name.charAt(0)
  }
  return (authStore.currentUser?.nickname || authStore.currentUser?.username || '?').charAt(0)
})

const identityAvatarUrl = computed(() => {
  if (selectedIdentity.value.type === 'oc') {
    return selectedIdentity.value.oc.avatarUrl || null
  }
  return authStore.currentUser?.avatarUrl || null
})

const oocDisplayName = computed(() => {
  const nick = authStore.currentUser?.nickname || authStore.currentUser?.username || '本人'
  return `本人（${nick}）`
})

const channelTypeHint = computed(() => {
  if (canCreatePublicChannel.value) {
    return '公开频道对所有世界成员可见，私有频道仅成员可见'
  }
  return '你的角色只能创建私有频道，且只有频道成员可见'
})

const sendDisabled = computed(() =>
  !selectedChannel.value ||
  !messageInput.value.trim() ||
  sending.value ||
  !socketReady.value
)

useClickOutside(identityRef, () => {
  if (identityPanelOpen.value) {
    identityPanelOpen.value = false
  }
})

function channelTypeLabel(channelType: string) {
  return channelType === 'private' ? '私密' : '公开'
}

function roleLabel(role: string) {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共管'
  return '贡献者'
}

function senderInitial(message: ChatMessageResponse) {
  return (message.sender.displayName || '?').charAt(0)
}

function isSelfMessage(message: ChatMessageResponse) {
  return message.sender.userId === authStore.currentUser?.userId
}

function canRecallMessage(message: ChatMessageResponse) {
  if (!isSelfMessage(message) || message.isRecalled) {
    return false
  }
  const sentAt = new Date(message.sentAt).getTime()
  if (Number.isNaN(sentAt)) {
    return false
  }
  return Date.now() - sentAt <= 3 * 60 * 1000
}

function formatMessageTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function buildWebSocketUrl() {
  const url = buildApiWebSocketUrl()
  url.searchParams.set('worldId', worldId.value)
  return url.toString()
}

function makeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

async function scrollMessagesToBottom() {
  await nextTick()
  const el = messageAreaRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

function toggleIdentityPanel() {
  identityPanelOpen.value = !identityPanelOpen.value
  if (identityPanelOpen.value && !ocsLoaded.value) {
    loadOcs()
  }
}

async function loadOcs() {
  ocsError.value = ''
  try {
    ocs.value = await listMyOcs(worldId.value)
    ocsLoaded.value = true
  } catch (error) {
    ocsError.value = error instanceof ApiError ? error.message : '加载角色列表失败'
  }
}

function selectOoc() {
  selectedIdentity.value = { type: 'ooc' }
  identityPanelOpen.value = false
}

function selectOc(oc: OcResponse) {
  selectedIdentity.value = { type: 'oc', oc }
  identityPanelOpen.value = false
}

async function loadWorldContext() {
  try {
    const detail = await getWorldDetail(worldId.value)
    worldRole.value = detail.viewer.role
  } catch {
    worldRole.value = null
  }
}

async function loadMembers() {
  membersLoading.value = true
  membersError.value = ''
  try {
    members.value = await listWorldMembers(worldId.value)
  } catch (error) {
    membersError.value = error instanceof ApiError ? error.message : '成员列表加载失败'
  } finally {
    membersLoading.value = false
  }
}

async function fetchChannels() {
  channelsLoading.value = true
  channelsError.value = ''
  try {
    channels.value = await listChannels(worldId.value)
    if (!selectedChannelId.value || !channels.value.some((ch) => ch.channelId === selectedChannelId.value)) {
      selectedChannelId.value = channels.value[0]?.channelId ?? null
    }
  } catch (error) {
    channelsError.value = error instanceof ApiError ? error.message : '频道列表加载失败'
  } finally {
    channelsLoading.value = false
  }
}

function selectChannel(channelId: string) {
  if (selectedChannelId.value !== channelId) {
    selectedChannelId.value = channelId
  }
}

async function loadMessages(channelId: string) {
  messagesLoading.value = true
  messagesError.value = ''
  try {
    const history = await listChannelMessages(worldId.value, channelId, { limit: 50 })
    messages.value = history.messages
    hasMoreMessages.value = history.hasMore
    nextBeforeSentAt.value = history.nextBeforeSentAt
    nextBeforeMessageId.value = history.nextBeforeMessageId
    await scrollMessagesToBottom()
  } catch (error) {
    messages.value = []
    messagesError.value = error instanceof ApiError ? error.message : '历史消息加载失败'
  } finally {
    messagesLoading.value = false
  }
}

async function loadOlderMessages() {
  if (!selectedChannelId.value || !hasMoreMessages.value || messagesLoading.value) {
    return
  }
  const el = messageAreaRef.value
  const oldScrollHeight = el?.scrollHeight ?? 0
  messagesLoading.value = true
  messagesError.value = ''
  try {
    const history = await listChannelMessages(worldId.value, selectedChannelId.value, {
      beforeSentAt: nextBeforeSentAt.value,
      beforeMessageId: nextBeforeMessageId.value,
      limit: 50
    })
    messages.value = [...history.messages, ...messages.value]
    hasMoreMessages.value = history.hasMore
    nextBeforeSentAt.value = history.nextBeforeSentAt
    nextBeforeMessageId.value = history.nextBeforeMessageId
    await nextTick()
    if (el) {
      el.scrollTop = el.scrollHeight - oldScrollHeight
    }
  } catch (error) {
    messagesError.value = error instanceof ApiError ? error.message : '历史消息加载失败'
  } finally {
    messagesLoading.value = false
  }
}

function connectSocket() {
  closeSocket()
  shouldReconnect.value = true
  socketReady.value = false
  socketError.value = ''

  const ws = new WebSocket(buildWebSocketUrl())
  socket.value = ws

  ws.onopen = () => {
    socketReady.value = true
    socketError.value = ''
  }

  ws.onmessage = (event) => {
    handleSocketMessage(event.data)
  }

  ws.onerror = () => {
    socketError.value = '实时连接异常'
  }

  ws.onclose = () => {
    socketReady.value = false
    if (shouldReconnect.value) {
      reconnectTimer.value = window.setTimeout(connectSocket, 3000)
    }
  }
}

function closeSocket() {
  if (reconnectTimer.value != null) {
    window.clearTimeout(reconnectTimer.value)
    reconnectTimer.value = null
  }
  if (socket.value) {
    socket.value.close()
    socket.value = null
  }
}

function updateMessage(updated: ChatMessageResponse) {
  messages.value = messages.value.map((message) =>
    message.messageId === updated.messageId
      ? {
          ...message,
          ...updated,
          channelId: updated.channelId || message.channelId
        }
      : message
  )
}

function handleSocketMessage(raw: string) {
  let envelope: {
    type?: string
    requestId?: string
    channelId?: string | null
    payload?: unknown
  }
  try {
    envelope = JSON.parse(raw)
  } catch {
    return
  }

  if (envelope.type === 'chat.message.created') {
    const payload = envelope.payload as Omit<ChatMessageResponse, 'channelId'> | undefined
    const channelId = envelope.channelId || selectedChannelId.value
    if (!payload || !channelId || channelId !== selectedChannelId.value) {
      return
    }
    const message: ChatMessageResponse = {
      ...payload,
      channelId
    }
    if (!messages.value.some((item) => item.messageId === message.messageId)) {
      messages.value = [...messages.value, message]
      scrollMessagesToBottom()
    }
    return
  }

  if (envelope.type === 'chat.message.recalled') {
    const payload = envelope.payload as {
      messageId?: string
      content?: string
      isRecalled?: boolean
      recalledAt?: string | null
    } | undefined
    const channelId = envelope.channelId || selectedChannelId.value
    if (!payload?.messageId || !channelId || channelId !== selectedChannelId.value) {
      return
    }
    messages.value = messages.value.map((message) =>
      message.messageId === payload.messageId
        ? {
            ...message,
            content: payload.content || '消息已撤回',
            isRecalled: Boolean(payload.isRecalled),
            recalledAt: payload.recalledAt ?? null
          }
        : message
    )
    return
  }

  if (envelope.type === 'websocket.error') {
    const payload = envelope.payload as { message?: string } | undefined
    sendError.value = payload?.message || '消息发送失败'
  }
}

function openMessageContextMenu(event: MouseEvent, message: ChatMessageResponse) {
  event.preventDefault()
  if (!canRecallMessage(message)) {
    closeMessageContextMenu()
    return
  }
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    message
  }
}

function closeMessageContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.message = null
}

async function recallSelectedMessage() {
  const message = contextMenu.value.message
  closeMessageContextMenu()
  if (!message || !canRecallMessage(message)) {
    return
  }

  recallError.value = ''
  try {
    const recalled = await recallChannelMessage(worldId.value, message.channelId, message.messageId)
    updateMessage(recalled)
  } catch (error) {
    recallError.value = error instanceof ApiError ? error.message : '消息撤回失败'
  }
}

async function sendMessage() {
  const content = messageInput.value.trim()
  if (!content || !selectedChannel.value || !socket.value || socket.value.readyState !== WebSocket.OPEN) {
    return
  }

  sending.value = true
  sendError.value = ''
  const payload: Record<string, unknown> = {
    content,
    mode: selectedIdentity.value.type === 'oc' ? 'ic' : 'ooc'
  }
  if (selectedIdentity.value.type === 'oc') {
    payload.speakAsOcId = selectedIdentity.value.oc.ocId
  }

  socket.value.send(JSON.stringify({
    type: 'chat.message.send',
    requestId: makeRequestId(),
    channelId: selectedChannel.value.channelId,
    payload
  }))
  messageInput.value = ''
  sending.value = false
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

function openCreatePanel() {
  if (!canCreateChannel.value) {
    return
  }
  createPanelOpen.value = true
  createName.value = ''
  createChannelType.value = canCreatePublicChannel.value ? 'public' : 'private'
  selectedMemberIds.value = []
  createError.value = ''
  if (members.value.length === 0 && !membersLoading.value) {
    loadMembers()
  }
}

function closeCreatePanel() {
  createPanelOpen.value = false
}

function toggleMember(userId: string) {
  if (selectedMemberIds.value.includes(userId)) {
    selectedMemberIds.value = selectedMemberIds.value.filter((id) => id !== userId)
  } else {
    selectedMemberIds.value = [...selectedMemberIds.value, userId]
  }
}

function toggleChannelAddMember(userId: string) {
  if (channelAddMemberIds.value.includes(userId)) {
    channelAddMemberIds.value = channelAddMemberIds.value.filter((id) => id !== userId)
  } else {
    channelAddMemberIds.value = [...channelAddMemberIds.value, userId]
  }
}

function updateChannel(updated: RpgChannelResponse) {
  channels.value = channels.value.map((channel) =>
    channel.channelId === updated.channelId ? updated : channel
  )
}

function removeSelectedChannelFromList() {
  const leavingId = selectedChannelId.value
  channels.value = channels.value.filter((channel) => channel.channelId !== leavingId)
  selectedChannelId.value = channels.value[0]?.channelId ?? null
}

function openManagePanel() {
  if (!selectedChannel.value || !canOpenChannelPanel.value) return
  managePanelOpen.value = true
  channelAddMemberIds.value = []
  channelManageError.value = ''
  channelManageMessage.value = ''
  if (members.value.length === 0 && !membersLoading.value) {
    loadMembers()
  }
}

function closeManagePanel() {
  if (channelManaging.value) return
  managePanelOpen.value = false
}

async function submitAddChannelMembers() {
  if (!selectedChannel.value || !canInviteSelectedChannelMembers.value || channelAddMemberIds.value.length === 0) return

  channelManaging.value = true
  channelManageError.value = ''
  channelManageMessage.value = ''
  try {
    const updated = await addChannelMembers(worldId.value, selectedChannel.value.channelId, {
      memberUserIds: channelAddMemberIds.value
    })
    updateChannel(updated)
    channelAddMemberIds.value = []
    channelManageMessage.value = '已邀请成员进入频道。'
  } catch (error) {
    channelManageError.value = error instanceof ApiError ? error.message : '邀请成员失败'
  } finally {
    channelManaging.value = false
  }
}

async function kickChannelMember(member: WorldMember) {
  if (!selectedChannel.value || !canInviteSelectedChannelMembers.value) return
  if (member.userId === selectedChannelCreatorId.value) return
  const confirmed = window.confirm(`确定要将 ${member.nickname || member.username} 移出频道吗？`)
  if (!confirmed) return

  channelActionKey.value = `remove:${member.userId}`
  channelManageError.value = ''
  channelManageMessage.value = ''
  try {
    await removeChannelMember(worldId.value, selectedChannel.value.channelId, member.userId)
    updateChannel({
      ...selectedChannel.value,
      memberUserIds: selectedChannel.value.memberUserIds.filter((id) => id !== member.userId)
    })
    channelManageMessage.value = '已将成员移出频道。'
  } catch (error) {
    channelManageError.value = error instanceof ApiError ? error.message : '移出成员失败'
  } finally {
    channelActionKey.value = ''
  }
}

async function leaveSelectedChannel() {
  if (!selectedChannel.value || !canLeaveSelectedChannel.value) return
  const confirmed = window.confirm('确定要退出这个私密频道吗？')
  if (!confirmed) return

  channelActionKey.value = 'leave:self'
  channelManageError.value = ''
  channelManageMessage.value = ''
  try {
    await leaveChannel(worldId.value, selectedChannel.value.channelId)
    closeManagePanel()
    removeSelectedChannelFromList()
  } catch (error) {
    channelManageError.value = error instanceof ApiError ? error.message : '退出频道失败'
  } finally {
    channelActionKey.value = ''
  }
}

async function deleteSelectedChannel() {
  if (!selectedChannel.value || !canManageSelectedChannel.value) return
  const confirmed = window.confirm(`确定要解散频道「${selectedChannel.value.name}」吗？频道消息将不再可见。`)
  if (!confirmed) return

  channelActionKey.value = 'delete:channel'
  channelManageError.value = ''
  channelManageMessage.value = ''
  try {
    await deleteChannel(worldId.value, selectedChannel.value.channelId)
    closeManagePanel()
    removeSelectedChannelFromList()
  } catch (error) {
    channelManageError.value = error instanceof ApiError ? error.message : '解散频道失败'
  } finally {
    channelActionKey.value = ''
  }
}

async function submitCreateChannel() {
  const name = createName.value.trim()
  if (!name) {
    createError.value = '频道名称不能为空'
    return
  }

  const channelType = canCreatePublicChannel.value ? createChannelType.value : 'private'
  creatingChannel.value = true
  createError.value = ''
  try {
    const created = await createChannel(worldId.value, {
      name,
      channelType,
      memberUserIds: channelType === 'private' ? selectedMemberIds.value : []
    })
    channels.value = [
      ...channels.value,
      created.creatorUserId
        ? created
        : { ...created, creatorUserId: authStore.currentUser?.userId ?? '' }
    ]
    selectedChannelId.value = created.channelId
    createPanelOpen.value = false
  } catch (error) {
    createError.value = error instanceof ApiError ? error.message : '创建频道失败'
  } finally {
    creatingChannel.value = false
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    identityPanelOpen.value = false
    createPanelOpen.value = false
    managePanelOpen.value = false
    closeMessageContextMenu()
  }
}

watch(selectedChannelId, (channelId) => {
  if (channelId) {
    loadMessages(channelId)
  } else {
    messages.value = []
  }
})

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', closeMessageContextMenu)
  await Promise.all([loadWorldContext(), loadMembers(), fetchChannels()])
  connectSocket()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', closeMessageContextMenu)
  shouldReconnect.value = false
  closeSocket()
})
</script>

<template>
  <main class="chat-page" @contextmenu.prevent>
    <aside class="chat-sidebar" aria-label="频道列表">
      <div class="sidebar-header">
        <div>
          <h2 class="sidebar-title">频道</h2>
          <p class="sidebar-subtitle">世界频道聊天</p>
        </div>
        <div class="sidebar-actions">
          <button
            class="sidebar-icon-btn"
            type="button"
            :disabled="!canCreateChannel"
            title="新建频道"
            @click="openCreatePanel"
          >
            +
          </button>
          <RouterLink class="sidebar-back" :to="{ name: 'world-detail', params: { worldId } }">
            返回
          </RouterLink>
        </div>
      </div>

      <div class="channel-list">
        <div v-if="channelsLoading" class="sidebar-state">
          <p>加载频道中...</p>
        </div>

        <div v-else-if="channelsError" class="sidebar-state sidebar-state--error">
          <p>{{ channelsError }}</p>
          <button class="sidebar-retry" type="button" @click="fetchChannels">重试</button>
        </div>

        <div v-else-if="channels.length === 0" class="sidebar-state">
          <p>暂无频道</p>
        </div>

        <button
          v-for="channel in channels"
          :key="channel.channelId"
          class="channel-item"
          :class="{ 'channel-item--active': channel.channelId === selectedChannelId }"
          type="button"
          @click="selectChannel(channel.channelId)"
        >
          <span class="channel-icon">#</span>
          <span class="channel-name">{{ channel.name }}</span>
          <span class="channel-type-tag" :class="{ 'channel-type-tag--private': channel.channelType === 'private' }">
            {{ channelTypeLabel(channel.channelType) }}
          </span>
        </button>
      </div>
    </aside>

    <section class="chat-main">
      <div class="chat-header">
        <div class="chat-header-left">
          <span v-if="selectedChannel" class="chat-header-icon">#</span>
          <div class="chat-heading">
            <h3 class="chat-header-title">{{ selectedChannel?.name || '未选择频道' }}</h3>
            <p>{{ selectedChannel ? channelTypeLabel(selectedChannel.channelType) : '请选择一个频道' }}</p>
          </div>
        </div>

        <div class="chat-header-right">
          <span class="socket-status" :class="{ 'socket-status--online': socketReady }">
            {{ socketReady ? '实时在线' : '连接中' }}
          </span>

          <button
            v-if="canOpenChannelPanel"
            class="chat-header__action"
            type="button"
            @click="openManagePanel"
          >
            频道成员
          </button>

          <RouterLink class="chat-header__action" :to="{ name: 'rpg-ocs', params: { worldId } }">
            管理角色
          </RouterLink>

          <div ref="identityRef" class="identity-switcher">
            <button
              class="identity-trigger"
              type="button"
              :aria-expanded="identityPanelOpen"
              @click="toggleIdentityPanel"
            >
              <div class="identity-trigger-avatar">
                <img v-if="identityAvatarUrl" :src="identityAvatarUrl" alt="" class="identity-trigger-img" />
                <span v-else class="identity-trigger-fallback">{{ identityAvatarLetter }}</span>
              </div>
              <span class="identity-trigger-name">{{ displayName }}</span>
              <span class="identity-trigger-tag">{{ isOoc ? '本人' : 'IC' }}</span>
              <span class="identity-trigger-chevron" :class="{ 'identity-trigger-chevron--open': identityPanelOpen }">
                v
              </span>
            </button>

            <Transition name="dropdown">
              <div v-if="identityPanelOpen" class="identity-panel">
                <button class="identity-option" :class="{ 'identity-option--active': isOoc }" type="button" @click="selectOoc">
                  <div class="identity-option-avatar">
                    <img
                      v-if="authStore.currentUser?.avatarUrl"
                      :src="authStore.currentUser.avatarUrl"
                      alt=""
                      class="identity-option-img"
                    />
                    <span v-else class="identity-option-fallback">
                      {{ (authStore.currentUser?.nickname || authStore.currentUser?.username || '?').charAt(0) }}
                    </span>
                  </div>
                  <span class="identity-option-name">{{ oocDisplayName }}</span>
                  <span class="identity-option-tag">OOC</span>
                </button>

                <div class="identity-divider">
                  <span>以角色身份发言</span>
                </div>

                <div v-if="ocsError" class="identity-ocs-error">{{ ocsError }}</div>
                <div v-else-if="!ocsLoaded && identityPanelOpen" class="identity-ocs-loading">加载中...</div>
                <div v-else-if="ocsLoaded && ocs.length === 0" class="identity-ocs-empty">
                  还没有创建角色，
                  <RouterLink
                    class="identity-ocs-link"
                    :to="{ name: 'rpg-ocs', params: { worldId } }"
                    @click="identityPanelOpen = false"
                  >
                    去创建
                  </RouterLink>
                </div>
                <button
                  v-for="oc in ocs"
                  :key="oc.ocId"
                  class="identity-option"
                  :class="{
                    'identity-option--active':
                      selectedIdentity.type === 'oc' && selectedIdentity.oc.ocId === oc.ocId
                  }"
                  type="button"
                  @click="selectOc(oc)"
                >
                  <div class="identity-option-avatar">
                    <img v-if="oc.avatarUrl" :src="oc.avatarUrl" alt="" class="identity-option-img" />
                    <span v-else class="identity-option-fallback">{{ oc.name.charAt(0) }}</span>
                  </div>
                  <span class="identity-option-name">{{ oc.name }}</span>
                  <span class="identity-option-tag identity-option-tag--ic">IC</span>
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </div>

      <div ref="messageAreaRef" class="message-area">
        <div v-if="hasMoreMessages" class="load-more-wrap">
          <button class="load-more-btn" type="button" :disabled="messagesLoading" @click="loadOlderMessages">
            {{ messagesLoading ? '加载中...' : '加载更早消息' }}
          </button>
        </div>

        <div v-if="messagesError" class="message-state message-state--error">
          {{ messagesError }}
        </div>
        <div v-else-if="messagesLoading && messages.length === 0" class="message-state">
          正在加载历史消息...
        </div>
        <div v-else-if="!selectedChannel" class="message-state">
          请选择一个频道
        </div>
        <div v-else-if="messages.length === 0" class="message-state">
          这个频道还没有消息
        </div>

        <div
          v-for="message in messages"
          :key="message.messageId"
          class="message-row"
          :class="{
            'message-row--self': isSelfMessage(message),
            'message-row--recalled': message.isRecalled
          }"
          @contextmenu="openMessageContextMenu($event, message)"
        >
          <div class="message-avatar">
            <img
              v-if="message.sender.avatarUrl"
              :src="message.sender.avatarUrl"
              alt=""
              class="message-avatar-img"
            />
            <span v-else class="message-avatar-fallback">{{ senderInitial(message) }}</span>
          </div>
          <div class="message-body">
            <div class="message-meta">
              <span class="message-sender">{{ message.sender.displayName }}</span>
              <span class="message-mode">{{ message.sender.mode === 'ic' ? 'IC' : 'OOC' }}</span>
              <span class="message-time">{{ formatMessageTime(message.sentAt) }}</span>
            </div>
            <p class="message-content">{{ message.isRecalled ? '消息已撤回' : message.content }}</p>
          </div>
        </div>
      </div>

      <div class="input-area">
        <p v-if="socketError || sendError || recallError" class="send-error">
          {{ recallError || sendError || socketError }}
        </p>
        <div class="input-wrapper">
          <textarea
            v-model="messageInput"
            class="chat-input"
            rows="1"
            maxlength="2000"
            :disabled="!selectedChannel || !socketReady"
            :placeholder="selectedChannel ? '输入消息，Enter 发送，Shift + Enter 换行' : '请选择频道'"
            @keydown="handleInputKeydown"
          />
          <button class="send-btn" type="button" :disabled="sendDisabled" @click="sendMessage">
            发送
          </button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <Transition name="context-menu">
        <div
          v-if="contextMenu.visible"
          class="message-context-menu"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          @click.stop
        >
          <button class="context-menu-item context-menu-item--danger" type="button" @click="recallSelectedMessage">
            撤回
          </button>
        </div>
      </Transition>
    </Teleport>

    <Transition name="fade">
      <div v-if="createPanelOpen" class="modal-backdrop" @click.self="closeCreatePanel">
        <section class="create-panel" aria-label="新建频道">
          <header class="create-panel__header">
            <div>
              <h3>新建频道</h3>
              <p>{{ channelTypeHint }}</p>
            </div>
            <button class="modal-close" type="button" title="关闭" @click="closeCreatePanel">x</button>
          </header>

          <label class="form-field">
            <span>频道名称</span>
            <input v-model="createName" type="text" maxlength="50" placeholder="例如：主线讨论" />
          </label>

          <div class="form-field">
            <span>频道类型</span>
            <div class="segmented">
              <button
                type="button"
                :disabled="!canCreatePublicChannel"
                :class="{ 'segmented__item--active': createChannelType === 'public' }"
                @click="createChannelType = 'public'"
              >
                公开
              </button>
              <button
                type="button"
                :class="{ 'segmented__item--active': createChannelType === 'private' }"
                @click="createChannelType = 'private'"
              >
                私密
              </button>
            </div>
          </div>

          <div v-if="createChannelType === 'private'" class="member-picker">
            <div class="member-picker__top">
              <span>频道成员</span>
              <small>你会自动加入频道</small>
            </div>
            <div v-if="membersLoading" class="member-state">成员加载中...</div>
            <div v-else-if="membersError" class="member-state member-state--error">{{ membersError }}</div>
            <div v-else-if="visibleMembers.length === 0" class="member-state">暂无其他成员可选</div>
            <button
              v-for="member in visibleMembers"
              :key="member.userId"
              class="member-option"
              :class="{ 'member-option--selected': selectedMemberIds.includes(member.userId) }"
              type="button"
              @click="toggleMember(member.userId)"
            >
              <span class="member-avatar">
                <img v-if="member.avatarUrl" :src="member.avatarUrl" alt="" />
                <span v-else>{{ (member.nickname || member.username || '?').charAt(0) }}</span>
              </span>
              <span class="member-name">{{ member.nickname || member.username }}</span>
              <span class="member-role">{{ roleLabel(member.role) }}</span>
            </button>
          </div>

          <p v-if="createError" class="create-error">{{ createError }}</p>

          <footer class="create-panel__footer">
            <button class="secondary-btn" type="button" @click="closeCreatePanel">取消</button>
            <button class="primary-btn" type="button" :disabled="creatingChannel" @click="submitCreateChannel">
              {{ creatingChannel ? '创建中...' : '创建频道' }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="managePanelOpen" class="modal-backdrop" @click.self="closeManagePanel">
        <section class="create-panel" aria-label="频道成员管理">
          <header class="create-panel__header">
            <div>
              <h3>频道成员</h3>
              <p>{{ selectedChannel?.name || '私密频道' }}</p>
            </div>
            <button class="modal-close" type="button" title="关闭" @click="closeManagePanel">x</button>
          </header>

          <div class="channel-member-section">
            <div class="member-picker__top">
              <span>已在频道</span>
              <small>{{ channelMembers.length }} 人</small>
            </div>
            <div v-if="membersLoading" class="member-state">成员加载中...</div>
            <div v-else-if="membersError" class="member-state member-state--error">{{ membersError }}</div>
            <div v-else-if="channelMembers.length === 0" class="member-state">暂无成员信息</div>
            <div v-else class="channel-member-list">
              <div v-for="member in channelMembers" :key="member.userId" class="channel-member-row">
                <span class="member-avatar">
                  <img v-if="member.avatarUrl" :src="member.avatarUrl" alt="" />
                  <span v-else>{{ (member.nickname || member.username || '?').charAt(0) }}</span>
                </span>
                <span class="member-name">{{ member.nickname || member.username }}</span>
                <span class="member-role">{{ roleLabel(member.role) }}</span>
                <button
                  v-if="canInviteSelectedChannelMembers && member.userId !== selectedChannelCreatorId"
                  type="button"
                  class="tiny-danger-btn"
                  :disabled="Boolean(channelActionKey)"
                  @click="kickChannelMember(member)"
                >
                  {{ channelActionKey === `remove:${member.userId}` ? '移出中...' : '移出' }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="canInviteSelectedChannelMembers" class="member-picker">
            <div class="member-picker__top">
              <span>邀请成员</span>
              <small>选择要加入此私密频道的世界成员</small>
            </div>
            <div v-if="membersLoading" class="member-state">成员加载中...</div>
            <div v-else-if="membersError" class="member-state member-state--error">{{ membersError }}</div>
            <div v-else-if="availableChannelMembers.length === 0" class="member-state">暂无可邀请成员</div>
            <button
              v-for="member in availableChannelMembers"
              :key="member.userId"
              class="member-option"
              :class="{ 'member-option--selected': channelAddMemberIds.includes(member.userId) }"
              type="button"
              @click="toggleChannelAddMember(member.userId)"
            >
              <span class="member-avatar">
                <img v-if="member.avatarUrl" :src="member.avatarUrl" alt="" />
                <span v-else>{{ (member.nickname || member.username || '?').charAt(0) }}</span>
              </span>
              <span class="member-name">{{ member.nickname || member.username }}</span>
              <span class="member-role">{{ roleLabel(member.role) }}</span>
            </button>
          </div>

          <p v-if="channelManageMessage" class="create-success">{{ channelManageMessage }}</p>
          <p v-if="channelManageError" class="create-error">{{ channelManageError }}</p>

          <footer class="create-panel__footer">
            <button
              v-if="canLeaveSelectedChannel"
              class="danger-outline-btn"
              type="button"
              :disabled="Boolean(channelActionKey)"
              @click="leaveSelectedChannel"
            >
              {{ channelActionKey === 'leave:self' ? '退出中...' : '退出频道' }}
            </button>
            <button
              v-if="canManageSelectedChannel"
              class="danger-outline-btn"
              type="button"
              :disabled="Boolean(channelActionKey)"
              @click="deleteSelectedChannel"
            >
              {{ channelActionKey === 'delete:channel' ? '解散中...' : '解散频道' }}
            </button>
            <button class="secondary-btn" type="button" @click="closeManagePanel">关闭</button>
            <button
              v-if="canInviteSelectedChannelMembers"
              class="primary-btn"
              type="button"
              :disabled="channelManaging || channelAddMemberIds.length === 0"
              @click="submitAddChannelMembers"
            >
              {{ channelManaging ? '邀请中...' : '邀请成员' }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.chat-page {
  display: flex;
  height: calc(100vh - var(--nav-height));
  overflow: hidden;
  background: rgb(246 242 232 / 30%);
}

.chat-sidebar {
  width: 276px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-line);
  background: linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 50%));
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid var(--color-line);
}

.sidebar-title {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 900;
}

.sidebar-subtitle {
  margin: 3px 0 0;
  color: var(--color-muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sidebar-icon-btn,
.modal-close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 70%);
  font-size: 1.1rem;
  font-weight: 900;
  cursor: pointer;
}

.sidebar-icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.sidebar-back {
  color: var(--color-muted);
  font-size: 0.8rem;
  font-weight: 800;
  text-decoration: none;
}

.sidebar-back:hover {
  color: var(--color-accent);
}

.channel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  margin-bottom: 2px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}

.channel-item:hover {
  background: rgb(20 115 90 / 6%);
}

.channel-item--active {
  background: rgb(20 115 90 / 10%);
}

.channel-icon {
  color: var(--color-muted);
  font-size: 1.1rem;
  font-weight: 900;
}

.channel-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-ink);
  font-size: 0.9rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-type-tag,
.message-mode,
.socket-status,
.member-role {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgb(232 241 237 / 80%);
  color: #305349;
  font-size: 0.66rem;
  font-weight: 900;
}

.channel-type-tag--private {
  background: rgb(239 234 224 / 88%);
  color: #6f5130;
}

.sidebar-state,
.message-state,
.member-state {
  padding: 20px 12px;
  color: var(--color-muted);
  font-size: 0.84rem;
  line-height: 1.5;
  text-align: center;
}

.sidebar-state--error,
.message-state--error,
.member-state--error,
.send-error,
.create-error {
  color: #a1322b;
}

.sidebar-retry {
  margin-top: 8px;
  padding: 4px 12px;
  border: 1px solid var(--color-line-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-line);
  background: rgb(255 255 255 / 66%);
}

.chat-header-left,
.chat-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.chat-header-right {
  flex-shrink: 0;
}

.chat-header-icon {
  color: var(--color-muted);
  font-size: 1.1rem;
  font-weight: 900;
}

.chat-heading {
  min-width: 0;
}

.chat-header-title {
  margin: 0;
  overflow: hidden;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-heading p {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.socket-status {
  background: rgb(239 234 224 / 88%);
  color: #6f5130;
}

.socket-status--online {
  background: rgb(232 241 237 / 88%);
  color: #305349;
}

.chat-header__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 62%);
  font-size: 0.82rem;
  font-weight: 800;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
}

.identity-switcher {
  position: relative;
  flex-shrink: 0;
}

.identity-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 5px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.identity-trigger-avatar,
.identity-option-avatar,
.member-avatar,
.message-avatar {
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 50%;
}

.identity-trigger-avatar {
  width: 28px;
  height: 28px;
}

.identity-option-avatar,
.message-avatar {
  width: 34px;
  height: 34px;
}

.identity-trigger-img,
.identity-option-img,
.message-avatar-img,
.member-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.identity-trigger-fallback,
.identity-option-fallback,
.message-avatar-fallback,
.member-avatar span {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  color: #fff;
  background: #103b31;
  font-size: 0.76rem;
  font-weight: 900;
}

.identity-trigger-name {
  max-width: 110px;
  overflow: hidden;
  color: var(--color-ink);
  font-size: 0.84rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-trigger-tag,
.identity-option-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgb(232 241 237 / 70%);
  color: #305349;
  font-size: 0.64rem;
  font-weight: 900;
}

.identity-trigger-chevron {
  color: var(--color-muted);
  font-size: 0.64rem;
  transition: transform 150ms ease;
}

.identity-trigger-chevron--open {
  transform: rotate(180deg);
}

.identity-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 250px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  background: #fff;
  box-shadow: var(--shadow-panel);
}

.identity-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.identity-option:hover,
.identity-option--active {
  background: rgb(20 115 90 / 8%);
}

.identity-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-ink);
  font-size: 0.86rem;
  font-weight: 800;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-option-tag--ic {
  background: rgb(232 237 241 / 70%);
  color: #304053;
}

.identity-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 6px;
  color: var(--color-muted);
  font-size: 0.72rem;
  font-weight: 800;
}

.identity-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-line);
}

.identity-ocs-error,
.identity-ocs-empty,
.identity-ocs-loading {
  padding: 12px 14px;
  color: var(--color-muted);
  font-size: 0.82rem;
  text-align: center;
}

.identity-ocs-error {
  color: #a1322b;
}

.identity-ocs-link {
  color: var(--color-accent);
  font-weight: 800;
  text-decoration: none;
}

.message-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 18px 20px;
}

.load-more-wrap {
  display: flex;
  justify-content: center;
  padding: 4px 0 12px;
}

.load-more-btn {
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 66%);
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
}

.message-row {
  display: flex;
  gap: 10px;
  padding: 8px 4px;
  border-radius: 6px;
}

.message-row:hover {
  background: rgb(24 33 31 / 2%);
}

.message-row--recalled {
  opacity: 0.72;
}

.message-row--self {
  flex-direction: row-reverse;
}

.message-row--self .message-body,
.message-row--self .message-meta {
  text-align: right;
}

.message-row--self .message-meta {
  flex-direction: row-reverse;
}

.message-body {
  min-width: 0;
  max-width: 68%;
}

.message-meta {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 4px;
}

.message-sender {
  color: var(--color-ink);
  font-size: 0.82rem;
  font-weight: 900;
}

.message-time {
  color: var(--color-muted);
  font-size: 0.7rem;
}

.message-content {
  margin: 0;
  color: var(--color-ink);
  font-size: 0.92rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-row--recalled .message-content {
  color: var(--color-muted);
  font-style: italic;
}

.message-context-menu {
  position: fixed;
  z-index: 120;
  min-width: 104px;
  padding: 6px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 98%);
  box-shadow: var(--shadow-panel);
}

.context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-ink);
  font-size: 0.84rem;
  font-weight: 900;
  cursor: pointer;
  text-align: left;
}

.context-menu-item:hover {
  background: rgb(24 33 31 / 5%);
}

.context-menu-item--danger {
  color: #a1322b;
}

.input-area {
  padding: 12px 20px 14px;
  border-top: 1px solid var(--color-line);
  background: rgb(255 255 255 / 66%);
}

.send-error {
  margin: 0 0 8px;
  font-size: 0.82rem;
  font-weight: 800;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.chat-input {
  flex: 1;
  min-height: 42px;
  max-height: 120px;
  padding: 11px 14px;
  resize: vertical;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 80%);
  color: var(--color-ink);
  font-family: var(--font-body);
  font-size: 0.9rem;
}

.chat-input:disabled {
  cursor: not-allowed;
  color: var(--color-muted);
  background: rgb(246 242 232 / 50%);
}

.send-btn,
.primary-btn,
.secondary-btn {
  min-height: 42px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 900;
  cursor: pointer;
}

.send-btn,
.primary-btn {
  border: 0;
  color: #fff;
  background: #103b31;
}

.send-btn:disabled,
.primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.secondary-btn {
  border: 1px solid var(--color-line);
  color: var(--color-ink);
  background: rgb(255 255 255 / 70%);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(16 22 21 / 36%);
}

.create-panel {
  width: min(520px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 20px;
  border-radius: 8px;
  background: rgb(255 255 255 / 98%);
  box-shadow: var(--shadow-panel);
}

.create-panel__header,
.create-panel__footer,
.member-picker__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.create-panel__header {
  margin-bottom: 18px;
}

.create-panel__header h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 900;
}

.create-panel__header p,
.member-picker__top small {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.form-field {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.form-field > span,
.member-picker__top > span {
  color: var(--color-ink);
  font-size: 0.84rem;
  font-weight: 900;
}

.form-field input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: #fff;
  font: inherit;
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(246 242 232 / 52%);
}

.segmented button {
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  color: var(--color-muted);
  background: transparent;
  font-weight: 900;
  cursor: pointer;
}

.segmented button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.segmented .segmented__item--active {
  color: var(--color-ink);
  background: #fff;
  box-shadow: 0 1px 4px rgb(24 33 31 / 8%);
}

.member-picker {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.channel-member-section {
  display: grid;
  gap: 8px;
}

.channel-member-list {
  display: grid;
  gap: 8px;
}

.channel-member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 72%);
}

.member-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 7px 10px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 72%);
  cursor: pointer;
  text-align: left;
}

.member-option--selected {
  border-color: rgb(20 115 90 / 42%);
  background: rgb(20 115 90 / 8%);
}

.member-avatar {
  width: 30px;
  height: 30px;
}

.member-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-ink);
  font-size: 0.86rem;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.create-error {
  margin: 12px 0 0;
  font-size: 0.82rem;
  font-weight: 800;
}

.create-success {
  margin: 12px 0 0;
  color: #14735a;
  font-size: 0.82rem;
  font-weight: 800;
}

.tiny-danger-btn,
.danger-outline-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(176 64 64 / 24%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 72%);
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.tiny-danger-btn {
  min-height: 30px;
  padding: 0 10px;
  font-size: 0.76rem;
}

.danger-outline-btn {
  min-height: 42px;
  padding: 0 16px;
  font-size: 0.88rem;
}

.tiny-danger-btn:disabled,
.danger-outline-btn:disabled {
  cursor: wait;
  opacity: 0.6;
}

.create-panel__footer {
  justify-content: flex-end;
  margin-top: 18px;
}

.dropdown-enter-active,
.dropdown-leave-active,
.fade-enter-active,
.fade-leave-active,
.context-menu-enter-active,
.context-menu-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (max-width: 760px) {
  .chat-sidebar {
    width: 218px;
  }

  .chat-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .chat-header-right {
    width: 100%;
    flex-wrap: wrap;
  }

  .message-body {
    max-width: 82%;
  }

  .identity-trigger-name {
    max-width: 72px;
  }
}

@media (max-width: 560px) {
  .chat-page {
    flex-direction: column;
    height: auto;
    min-height: calc(100vh - var(--nav-height));
  }

  .chat-sidebar {
    width: 100%;
    max-height: 240px;
    border-right: 0;
    border-bottom: 1px solid var(--color-line);
  }

  .chat-main {
    min-height: 70vh;
  }
}
</style>
