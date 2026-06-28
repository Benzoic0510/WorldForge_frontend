<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import {
  deleteReadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from '@/api/notification'
import { acceptWorldInvitationById, rejectWorldInvitation } from '@/api/world'
import { useAuthStore } from '@/stores/auth'
import type { NotificationItem } from '@/types/notification'

interface WebSocketEnvelope {
  type: string
  requestId?: string | null
  worldId?: string | null
  channelId?: string | null
  payload?: Record<string, unknown> | null
}

interface NotificationDetailView {
  kind: 'status' | 'review' | 'join-review' | 'join-status' | 'invitation' | 'unknown'
  title: string
  worldName: string
  worldUrl: string
  worldId?: string
  proposalTitle: string
  requestId?: string
  invitationId?: string
  roleLabel?: string
  statusLabel?: string
  statusTone?: 'accepted' | 'rejected' | 'neutral'
  rejectReason?: string
  submitterName?: string
  actionLabel?: string
  actionUrl?: string
  fallbackContent: string
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const notifications = ref<NotificationItem[]>([])
const allCount = ref(0)
const unreadCount = ref(0)
const page = ref(1)
const totalPages = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const appendError = ref('')
const markingIds = ref<Set<string>>(new Set())
const realtimeConnected = ref(false)
const selectedNotification = ref<NotificationItem | null>(null)
const invitationActionLoading = ref('')
const invitationActionMessage = ref('')
const invitationActionError = ref('')
const deleteReadCountdown = ref(0)
const deleteReadArmed = ref(false)
let deleteReadTimer: number | null = null
let deleteReadResetTimer: number | null = null

let notificationSocket: WebSocket | null = null
let reconnectTimer: number | null = null
let manuallyClosed = false

const canLoadMore = computed(() => page.value < totalPages.value)
const readCount = computed(() => Math.max(allCount.value - unreadCount.value, 0))
const isEmpty = computed(() => !loading.value && !errorMessage.value && notifications.value.length === 0)
const hasUnread = computed(() => unreadCount.value > 0)
const hasRead = computed(() => readCount.value > 0)
const deleteReadLabel = computed(() =>
  deleteReadArmed.value ? `确认删除 ${deleteReadCountdown.value > 0 ? `${deleteReadCountdown.value}s` : ''}`.trim() : '删除已读'
)
const selectedDetail = computed(() => selectedNotification.value ? buildNotificationDetail(selectedNotification.value) : null)

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  return '通知暂时无法加载，请稍后重试。'
}

function redirectToLoginIfUnauthorized(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return false
  }

  authStore.clearSession()
  router.replace({
    name: 'login',
    query: { redirect: route.fullPath }
  })
  return true
}

function formatDateTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function buildWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/ws`
}

function parseNotificationLink(linkUrl: string) {
  const result = {
    worldId: '',
    submissionId: '',
    requestId: '',
    invitationId: ''
  }

  if (!linkUrl) return result

  const url = new URL(linkUrl, window.location.origin)
  const match = url.pathname.match(/^\/worlds\/([^/]+)(?:\/submissions\/([^/]+)|\/review-submissions|\/invitations\/([^/]+))?/)
  if (match) {
    result.worldId = decodeURIComponent(match[1] || '')
    result.submissionId = decodeURIComponent(match[2] || '')
    result.invitationId = decodeURIComponent(match[3] || '')
  }
  result.submissionId = result.submissionId || url.searchParams.get('submissionId') || ''
  result.requestId = result.requestId || url.searchParams.get('requestId') || ''
  result.invitationId = result.invitationId || url.searchParams.get('invitationId') || ''
  return result
}

function buildNotificationDetail(notification: NotificationItem): NotificationDetailView {
  const { worldId, submissionId, requestId, invitationId } = parseNotificationLink(notification.linkUrl)
  const worldUrl = worldId ? `/worlds/${encodeURIComponent(worldId)}` : ''
  const pushUrl = worldId && submissionId
    ? `/worlds/${encodeURIComponent(worldId)}/submissions/${encodeURIComponent(submissionId)}`
    : notification.linkUrl
  const reviewUrl = worldId
    ? `/worlds/${encodeURIComponent(worldId)}/review-submissions${submissionId ? `?submissionId=${encodeURIComponent(submissionId)}` : ''}`
    : notification.linkUrl
  const joinReviewUrl = worldId
    ? `/worlds/${encodeURIComponent(worldId)}/members${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`
    : notification.linkUrl

  const statusMatch = notification.content.match(/^您对(.+)的(.+)提案状态已变更为：([^；]+)(?:；拒绝原因：(.+))?$/)
  if (statusMatch) {
    const statusLabel = statusMatch[3]
    return {
      kind: 'status',
      title: '提案状态变更',
      worldName: statusMatch[1],
      worldUrl,
      proposalTitle: statusMatch[2],
      statusLabel,
      statusTone: statusLabel === '接受' ? 'accepted' : statusLabel === '拒绝' ? 'rejected' : 'neutral',
      rejectReason: statusMatch[4] || '',
      actionLabel: '查看推送详情',
      actionUrl: pushUrl,
      fallbackContent: notification.content
    }
  }

  const reviewMatch = notification.content.match(/^您管理的(.+)有来自(.+)的(.+)提案$/)
  if (reviewMatch) {
    return {
      kind: 'review',
      title: 'PUSH 审核',
      worldName: reviewMatch[1],
      worldUrl,
      proposalTitle: reviewMatch[3],
      submitterName: reviewMatch[2],
      actionLabel: '前去审核',
      actionUrl: reviewUrl,
      fallbackContent: notification.content
    }
  }

  const joinReviewMatch = notification.content.match(/^您管理的(.+)有来自(.+)的加入申请$/)
  if (joinReviewMatch) {
    return {
      kind: 'join-review',
      title: '加入申请审核',
      worldName: joinReviewMatch[1],
      worldUrl,
      worldId,
      proposalTitle: '',
      requestId,
      submitterName: joinReviewMatch[2],
      actionLabel: '前去审核',
      actionUrl: joinReviewUrl,
      fallbackContent: notification.content
    }
  }

  const joinStatusMatch = notification.content.match(/^您加入(.+)的申请已([^；]+)(?:；拒绝原因：(.+))?$/)
  if (joinStatusMatch) {
    const statusLabel = joinStatusMatch[2]
    return {
      kind: 'join-status',
      title: '加入申请结果',
      worldName: joinStatusMatch[1],
      worldUrl,
      proposalTitle: '',
      statusLabel,
      statusTone: statusLabel === '通过' ? 'accepted' : statusLabel === '拒绝' ? 'rejected' : 'neutral',
      rejectReason: joinStatusMatch[3] || '',
      actionLabel: '查看世界',
      actionUrl: worldUrl || notification.linkUrl,
      fallbackContent: notification.content
    }
  }

  const invitationMatch = notification.content.match(/^您被邀请加入(.+)，身份为：(.+)$/)
  if (invitationMatch) {
    return {
      kind: 'invitation',
      title: '世界邀请',
      worldName: invitationMatch[1],
      worldUrl,
      worldId,
      proposalTitle: '',
      invitationId,
      roleLabel: invitationMatch[2],
      fallbackContent: notification.content
    }
  }

  return {
    kind: 'unknown',
    title: '消息详情',
    worldName: '',
    worldUrl: '',
    proposalTitle: '',
    fallbackContent: notification.content
  }
}

function notificationSummary(notification: NotificationItem): string {
  return notification.content.replace(/；拒绝原因：.+$/, '')
}

function toNotificationItem(payload: Record<string, unknown>): NotificationItem | null {
  const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : ''
  const content = typeof payload.content === 'string' ? payload.content : ''
  if (!notificationId || !content) {
    return null
  }

  return {
    notificationId,
    content,
    linkUrl: typeof payload.linkUrl === 'string' ? payload.linkUrl : '',
    isRead: payload.isRead === true,
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString()
  }
}

function prependRealtimeNotification(notification: NotificationItem) {
  if (notifications.value.some((item) => item.notificationId === notification.notificationId)) {
    return
  }

  allCount.value += 1
  if (!notification.isRead) {
    unreadCount.value += 1
  }

  notifications.value = [notification, ...notifications.value]
}

function handleRealtimeMessage(raw: string) {
  let envelope: WebSocketEnvelope
  try {
    envelope = JSON.parse(raw) as WebSocketEnvelope
  } catch {
    return
  }

  if (envelope.type !== 'notification.new' || !envelope.payload) {
    return
  }

  const notification = toNotificationItem(envelope.payload)
  if (notification) {
    prependRealtimeNotification(notification)
  }
}

function scheduleReconnect() {
  if (manuallyClosed || reconnectTimer != null) {
    return
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connectNotificationSocket()
  }, 3000)
}

function connectNotificationSocket() {
  if (notificationSocket && notificationSocket.readyState !== WebSocket.CLOSED) {
    return
  }

  notificationSocket = new WebSocket(buildWebSocketUrl())
  notificationSocket.addEventListener('open', () => {
    realtimeConnected.value = true
  })
  notificationSocket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      handleRealtimeMessage(event.data)
    }
  })
  notificationSocket.addEventListener('close', () => {
    realtimeConnected.value = false
    notificationSocket = null
    scheduleReconnect()
  })
  notificationSocket.addEventListener('error', () => {
    realtimeConnected.value = false
  })
}

function closeNotificationSocket() {
  manuallyClosed = true
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (deleteReadTimer != null) {
    window.clearInterval(deleteReadTimer)
    deleteReadTimer = null
  }
  notificationSocket?.close()
  notificationSocket = null
}

async function fetchNotifications(options: { append?: boolean } = {}) {
  const append = options.append === true

  if (append) {
    loadingMore.value = true
    appendError.value = ''
  } else {
    loading.value = true
    errorMessage.value = ''
    appendError.value = ''
  }

  try {
    const data = await listNotifications({
      status: 'all',
      page: page.value,
      pageSize: 20
    })
    notifications.value = append ? notifications.value.concat(data.items) : data.items
    allCount.value = data.allCount
    unreadCount.value = data.unreadCount
    totalPages.value = data.totalPages
  } catch (error) {
    if (redirectToLoginIfUnauthorized(error)) {
      return
    }
    const message = getErrorMessage(error)
    if (append && notifications.value.length > 0) {
      appendError.value = message
    } else {
      errorMessage.value = message
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function handleLoadMore() {
  if (!canLoadMore.value || loadingMore.value) return

  const previousPage = page.value
  page.value += 1
  await fetchNotifications({ append: true })
  if (appendError.value) {
    page.value = previousPage
  }
}

async function markAsRead(notification: NotificationItem) {
  if (notification.isRead || markingIds.value.has(notification.notificationId)) {
    return
  }

  markingIds.value = new Set(markingIds.value).add(notification.notificationId)
  try {
    await markNotificationRead(notification.notificationId)
    notification.isRead = true
    unreadCount.value = Math.max(unreadCount.value - 1, 0)
  } catch (error) {
    appendError.value = getErrorMessage(error)
  } finally {
    const next = new Set(markingIds.value)
    next.delete(notification.notificationId)
    markingIds.value = next
  }
}

async function openNotificationDetail(notification: NotificationItem) {
  invitationActionLoading.value = ''
  invitationActionMessage.value = ''
  invitationActionError.value = ''
  await markAsRead(notification)
  selectedNotification.value = notification
}

function closeNotificationDetail() {
  selectedNotification.value = null
  invitationActionLoading.value = ''
  invitationActionMessage.value = ''
  invitationActionError.value = ''
}

function navigateFromNotification(url: string) {
  if (!url) return
  closeNotificationDetail()
  router.push(url)
}

async function handleInvitationDecision(decision: 'accept' | 'reject') {
  const detail = selectedDetail.value
  if (!detail || detail.kind !== 'invitation' || !detail.worldId || !detail.invitationId) {
    invitationActionError.value = '邀请信息不完整，无法处理。'
    return
  }

  invitationActionLoading.value = decision
  invitationActionError.value = ''
  invitationActionMessage.value = ''
  try {
    if (decision === 'accept') {
      await acceptWorldInvitationById(detail.worldId, detail.invitationId)
      invitationActionMessage.value = '已接受邀请。'
    } else {
      await rejectWorldInvitation(detail.worldId, detail.invitationId)
      invitationActionMessage.value = '已拒绝邀请。'
    }
  } catch (error) {
    invitationActionError.value = getErrorMessage(error)
  } finally {
    invitationActionLoading.value = ''
  }
}

async function retry() {
  page.value = 1
  await fetchNotifications()
}

function clearDeleteReadTimer() {
  if (deleteReadTimer != null) {
    window.clearInterval(deleteReadTimer)
    deleteReadTimer = null
  }
  if (deleteReadResetTimer != null) {
    window.clearTimeout(deleteReadResetTimer)
    deleteReadResetTimer = null
  }
  deleteReadCountdown.value = 0
  deleteReadArmed.value = false
}

function startDeleteReadCountdown() {
  if (deleteReadArmed.value || !hasRead.value) {
    return
  }

  deleteReadArmed.value = true
  deleteReadCountdown.value = 3
  deleteReadTimer = window.setInterval(() => {
    deleteReadCountdown.value -= 1
    if (deleteReadCountdown.value <= 0) {
      if (deleteReadTimer != null) {
        window.clearInterval(deleteReadTimer)
        deleteReadTimer = null
      }
      deleteReadCountdown.value = 0
      deleteReadResetTimer = window.setTimeout(() => {
        clearDeleteReadTimer()
      }, 5000)
    }
  }, 1000)
}

async function handleMarkAllRead() {
  if (!hasUnread.value) return

  await markAllNotificationsRead()
  notifications.value.forEach((notification) => {
    notification.isRead = true
  })
  unreadCount.value = 0
}

async function handleDeleteRead() {
  if (!deleteReadArmed.value) {
    startDeleteReadCountdown()
    return
  }

  if (deleteReadCountdown.value > 0 || !hasRead.value) return

  const deletedCount = readCount.value
  await deleteReadNotifications()
  notifications.value = notifications.value.filter((notification) => !notification.isRead)
  allCount.value = Math.max(allCount.value - deletedCount, notifications.value.length)
  unreadCount.value = notifications.value.filter((notification) => !notification.isRead).length
  totalPages.value = allCount.value === 0 ? 0 : Math.ceil(allCount.value / 20)
  clearDeleteReadTimer()
}

onMounted(() => {
  fetchNotifications()
  connectNotificationSocket()
})

onBeforeUnmount(() => {
  closeNotificationSocket()
})
</script>

<template>
  <main class="messages-page">
    <section class="messages-shell page-container">
      <header class="messages-header">
        <div class="command-title">
          <h1>消息</h1>
          <span>全部通知 · {{ notifications.length }} / {{ allCount }}</span>
        </div>

        <div class="command-toolbar">
          <div class="message-toolbar-actions" aria-label="消息操作">
            <button
              type="button"
              class="toolbar-action"
              :disabled="!hasUnread"
              @click="handleMarkAllRead"
            >
              全部已读
            </button>
            <button
              type="button"
              class="toolbar-action toolbar-action--danger"
              :class="{ 'toolbar-action--confirm': deleteReadArmed }"
              :disabled="!hasRead || deleteReadCountdown > 0"
              @click="handleDeleteRead"
            >
              {{ deleteReadLabel }}
            </button>
          </div>

          <div class="stat-strip" aria-label="通知概况">
            <span><strong>{{ allCount }}</strong>全部</span>
            <span><strong>{{ unreadCount }}</strong>未读</span>
            <span><strong>{{ readCount }}</strong>已读</span>
          </div>
        </div>
      </header>

      <section v-if="loading" class="message-state" aria-live="polite">
        <p>正在读取系统通知...</p>
      </section>

      <section v-else-if="errorMessage" class="message-state message-state--error">
        <h2>通知暂时不可用</h2>
        <p>{{ errorMessage }}</p>
        <button type="button" class="message-action" @click="retry">重新加载</button>
      </section>

      <section v-else-if="isEmpty" class="message-state">
        <h2>暂无系统通知</h2>
        <p>当世界协作、审核结果或系统事件发生变化时，你会在这里看到更新。</p>
      </section>

      <section v-else class="notification-list" aria-live="polite">
        <button
          v-for="notification in notifications"
          :key="notification.notificationId"
          type="button"
          class="notification-card"
          :class="{ 'notification-card--unread': !notification.isRead }"
          @click="openNotificationDetail(notification)"
        >
          <div class="notification-marker" aria-hidden="true"></div>

          <div class="notification-body">
            <div class="notification-meta">
              <time>{{ formatDateTime(notification.createdAt) }}</time>
            </div>
            <p>{{ notificationSummary(notification) }}</p>
          </div>
        </button>

        <div v-if="appendError" class="append-error-row" role="status">
          <span>{{ appendError }}</span>
          <button type="button" @click="handleLoadMore">再试一次</button>
        </div>

        <div v-if="canLoadMore" class="load-more-row">
          <button
            type="button"
            class="message-action"
            :disabled="loadingMore"
            @click="handleLoadMore"
          >
            {{ loadingMore ? '读取中...' : '加载更多' }}
          </button>
        </div>
      </section>
    </section>

    <Transition name="notification-modal">
      <div
        v-if="selectedNotification"
        class="notification-modal-backdrop"
        role="presentation"
        @click.self="closeNotificationDetail"
      >
        <section
          class="notification-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-modal-title"
        >
        <header class="notification-modal__header">
          <div class="notification-modal__heading">
            <span class="notification-modal__eyebrow">系统通知</span>
            <h2 id="notification-modal-title">{{ selectedDetail?.title || '消息详情' }}</h2>
          </div>
          <button type="button" class="notification-modal__close" aria-label="关闭" @click="closeNotificationDetail">
            &times;
          </button>
        </header>
        <div class="notification-modal__body" v-if="selectedDetail">
          <div class="notification-modal__panel">
            <template v-if="selectedDetail.kind === 'status'">
              <div class="notification-modal__lede notification-modal__lede--stacked">
                <span class="notification-modal__small">关于这个世界</span>
                <button
                  v-if="selectedDetail.worldUrl"
                  type="button"
                  class="inline-link inline-link--display"
                  @click="navigateFromNotification(selectedDetail.worldUrl)"
                >
                  {{ selectedDetail.worldName }}
                </button>
                <span v-else class="inline-plain inline-plain--display">{{ selectedDetail.worldName }}</span>
              </div>

              <p class="notification-modal__sentence">
                <strong class="notification-modal__emphasis">「{{ selectedDetail.proposalTitle }}」</strong>
                提案状态已变更为
                <strong
                  class="status-label"
                  :class="{
                    'status-label--accepted': selectedDetail.statusTone === 'accepted',
                    'status-label--rejected': selectedDetail.statusTone === 'rejected'
                  }"
                >
                  {{ selectedDetail.statusLabel }}
                </strong>
              </p>

              <p v-if="selectedDetail.rejectReason" class="notification-modal__reason">
                <strong>拒绝原因</strong>
                <span>{{ selectedDetail.rejectReason }}</span>
              </p>
            </template>

            <template v-else-if="selectedDetail.kind === 'review'">
              <div class="notification-modal__lede notification-modal__lede--stacked">
                <span class="notification-modal__small">待审核世界</span>
                <button
                  v-if="selectedDetail.worldUrl"
                  type="button"
                  class="inline-link inline-link--display"
                  @click="navigateFromNotification(selectedDetail.worldUrl)"
                >
                  {{ selectedDetail.worldName }}
                </button>
                <span v-else class="inline-plain inline-plain--display">{{ selectedDetail.worldName }}</span>
              </div>

              <p class="notification-modal__sentence">
                有来自
                <strong class="notification-modal__emphasis">{{ selectedDetail.submitterName }}</strong>
                的
                <strong class="notification-modal__emphasis">「{{ selectedDetail.proposalTitle }}」</strong>
                提案
              </p>
            </template>

            <template v-else-if="selectedDetail.kind === 'join-review'">
              <div class="notification-modal__lede notification-modal__lede--stacked">
                <span class="notification-modal__small">待审核世界</span>
                <button
                  v-if="selectedDetail.worldUrl"
                  type="button"
                  class="inline-link inline-link--display"
                  @click="navigateFromNotification(selectedDetail.worldUrl)"
                >
                  {{ selectedDetail.worldName }}
                </button>
                <span v-else class="inline-plain inline-plain--display">{{ selectedDetail.worldName }}</span>
              </div>

              <p class="notification-modal__sentence">
                有来自
                <strong class="notification-modal__emphasis">{{ selectedDetail.submitterName }}</strong>
                的加入申请
              </p>
            </template>

            <template v-else-if="selectedDetail.kind === 'join-status'">
              <div class="notification-modal__lede notification-modal__lede--stacked">
                <span class="notification-modal__small">申请加入世界</span>
                <button
                  v-if="selectedDetail.worldUrl"
                  type="button"
                  class="inline-link inline-link--display"
                  @click="navigateFromNotification(selectedDetail.worldUrl)"
                >
                  {{ selectedDetail.worldName }}
                </button>
                <span v-else class="inline-plain inline-plain--display">{{ selectedDetail.worldName }}</span>
              </div>

              <p class="notification-modal__sentence">
                你的加入申请已
                <strong
                  class="status-label"
                  :class="{
                    'status-label--accepted': selectedDetail.statusTone === 'accepted',
                    'status-label--rejected': selectedDetail.statusTone === 'rejected'
                  }"
                >
                  {{ selectedDetail.statusLabel }}
                </strong>
              </p>

              <p v-if="selectedDetail.rejectReason" class="notification-modal__reason">
                <strong>拒绝原因</strong>
                <span>{{ selectedDetail.rejectReason }}</span>
              </p>
            </template>

            <template v-else-if="selectedDetail.kind === 'invitation'">
              <div class="notification-modal__lede notification-modal__lede--stacked">
                <span class="notification-modal__small">邀请加入世界</span>
                <button
                  v-if="selectedDetail.worldUrl"
                  type="button"
                  class="inline-link inline-link--display"
                  @click="navigateFromNotification(selectedDetail.worldUrl)"
                >
                  {{ selectedDetail.worldName }}
                </button>
                <span v-else class="inline-plain inline-plain--display">{{ selectedDetail.worldName }}</span>
              </div>

              <p class="notification-modal__sentence">
                对方邀请你以
                <strong class="status-label status-label--accepted">{{ selectedDetail.roleLabel }}</strong>
                身份加入该世界
              </p>

              <p v-if="invitationActionMessage" class="notification-modal__result notification-modal__result--success">
                {{ invitationActionMessage }}
              </p>
              <p v-if="invitationActionError" class="notification-modal__result notification-modal__result--error">
                {{ invitationActionError }}
              </p>
            </template>

            <p v-else class="notification-modal__sentence notification-modal__sentence--fallback">
              {{ selectedDetail.fallbackContent }}
            </p>
          </div>

          <div class="notification-modal__actions">
            <template v-if="selectedDetail.kind === 'invitation'">
              <button
                type="button"
                class="message-action message-action--accept"
                :disabled="!!invitationActionMessage || !!invitationActionLoading"
                @click="handleInvitationDecision('accept')"
              >
                {{ invitationActionLoading === 'accept' ? '处理中...' : '接受' }}
              </button>
              <button
                type="button"
                class="message-action message-action--reject"
                :disabled="!!invitationActionMessage || !!invitationActionLoading"
                @click="handleInvitationDecision('reject')"
              >
                {{ invitationActionLoading === 'reject' ? '处理中...' : '拒绝' }}
              </button>
            </template>
            <button
              v-else-if="selectedDetail.actionUrl"
              type="button"
              class="message-action message-action--secondary"
              @click="navigateFromNotification(selectedDetail.actionUrl)"
            >
              {{ selectedDetail.actionLabel }}
            </button>
          </div>
        </div>
        </section>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.messages-page {
  padding-block: 22px 54px;
}

.messages-shell {
  display: grid;
  gap: 14px;
}

.messages-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 8px;
  background: rgb(255 255 255 / 54%);
}

.command-title h1,
.message-state h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.command-title h1 {
  font-size: 1.55rem;
  line-height: 1;
}

.command-title {
  display: grid;
  flex: 0 0 auto;
  gap: 6px;
}

.command-title span,
.message-state p,
.notification-body p {
  color: var(--color-muted);
}

.command-title span {
  font-size: 0.86rem;
  line-height: 1.2;
}

.command-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: end;
  min-width: 0;
}

.message-toolbar-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgb(16 59 49 / 14%);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 72%);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.toolbar-action:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.toolbar-action--danger.toolbar-action--confirm {
  border-color: rgb(163 58 58 / 28%);
  color: #fff;
  background: #a33a3a;
  opacity: 1;
}

.toolbar-action--danger.toolbar-action--confirm:disabled {
  cursor: wait;
  opacity: 0.76;
}

.stat-strip {
  display: inline-flex;
  gap: 1px;
  padding: 2px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 999px;
  background: rgb(255 255 255 / 50%);
}

.stat-strip span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 0 10px;
  color: #5d6b66;
  font-size: 0.72rem;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

.stat-strip strong {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 900;
}

.message-state {
  display: grid;
  gap: 12px;
  min-height: 180px;
  padding: 22px;
  align-content: center;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 44%);
}

.message-state--error {
  background: rgb(108 36 36 / 6%);
}

.message-state h2,
.message-state p {
  margin: 0;
}

.message-state h2 {
  font-size: 1.35rem;
}

.notification-list {
  display: grid;
  gap: 10px;
}

.notification-card {
  position: relative;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  width: 100%;
  padding: 14px;
  border: 1px solid #dde5df;
  border-radius: 8px;
  color: inherit;
  background: #fffdfa;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.notification-card:hover {
  transform: translateY(-2px);
  border-color: #b8ccc2;
  box-shadow: 0 12px 24px rgb(24 33 31 / 8%);
}

.notification-card--unread {
  border-color: rgb(20 115 90 / 22%);
  background:
    linear-gradient(90deg, rgb(232 241 237 / 58%), rgb(255 253 250 / 92%)),
    #fffdfa;
}

.notification-marker {
  width: 8px;
  min-height: 46px;
  border-radius: 6px;
  background: rgb(48 83 73 / 28%);
}

.notification-card--unread .notification-marker {
  background: #14735a;
}

.notification-body {
  min-width: 0;
}

.notification-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 7px;
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.notification-body p {
  margin: 0;
  color: var(--color-ink);
  font-size: 0.94rem;
  font-weight: 800;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.notification-card:not(.notification-card--unread) .notification-body p {
  color: #6f7a75;
  font-weight: 700;
}

.message-action,
.append-error-row button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 13px;
  border-radius: 8px;
  font: inherit;
  font-size: 0.84rem;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}

.message-action {
  border: 1px solid #103b31;
  color: #fff;
  background: #103b31;
}

.message-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

.load-more-row {
  display: flex;
  justify-content: center;
  padding-top: 8px;
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
  border: 1px solid rgb(108 36 36 / 24%);
  color: #6c2424;
  background: rgb(255 255 255 / 68%);
}

.notification-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(16 24 22 / 42%);
}

.notification-modal {
  width: min(520px, 100%);
  min-height: 220px;
  overflow: hidden;
  border: 1px solid rgb(16 59 49 / 16%);
  border-radius: 10px;
  background: #fffdfa;
  box-shadow: 0 26px 80px rgb(16 24 22 / 22%);
}

.notification-modal-enter-active,
.notification-modal-leave-active {
  transition: opacity 180ms ease;
}

.notification-modal-enter-active .notification-modal {
  transition:
    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.notification-modal-leave-active .notification-modal {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.notification-modal-enter-from,
.notification-modal-leave-to {
  opacity: 0;
}

.notification-modal-enter-from .notification-modal {
  opacity: 0;
  transform: translateY(14px) scale(0.96);
}

.notification-modal-enter-to .notification-modal,
.notification-modal-leave-from .notification-modal {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.notification-modal-leave-to .notification-modal {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.notification-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid rgb(16 59 49 / 10%);
}

.notification-modal__heading {
  display: grid;
  gap: 4px;
}

.notification-modal__eyebrow {
  color: #8a6d3d;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
}

.notification-modal__header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.45rem;
  line-height: 1.1;
}

.notification-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgb(16 59 49 / 14%);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 72%);
  font: inherit;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
}

.notification-modal__body {
  min-height: 150px;
  padding: 20px;
}

.notification-modal__panel {
  display: grid;
  gap: 16px;
  padding: 2px 0 8px;
  border-bottom: 1px solid rgb(16 59 49 / 12%);
}

.notification-modal__lede {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.notification-modal__lede--stacked {
  display: grid;
  gap: 5px;
}

.notification-modal__small {
  color: #7b827e;
  font-size: 0.82rem;
  font-weight: 800;
}

.notification-modal__emphasis {
  color: #8a4b23;
  font-family: var(--font-display);
  font-size: 1.22rem;
  font-weight: 900;
}

.notification-modal__sentence,
.notification-modal__reason {
  margin: 0;
  color: var(--color-ink);
  font-size: 1.03rem;
  font-weight: 700;
  line-height: 1.85;
}

.notification-modal__reason {
  display: grid;
  gap: 4px;
  padding: 2px 0 2px 14px;
  border-left: 3px solid #a33a3a;
  color: #7c2f2f;
}

.notification-modal__reason strong {
  color: #a33a3a;
  font-size: 0.9rem;
  font-weight: 900;
}

.notification-modal__result {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 900;
}

.notification-modal__result--success {
  border: 1px solid rgb(20 115 90 / 18%);
  color: #14735a;
  background: rgb(232 241 237 / 72%);
}

.notification-modal__result--error {
  border: 1px solid rgb(163 58 58 / 22%);
  color: #a33a3a;
  background: rgb(255 235 235 / 72%);
}

.notification-modal__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.message-action--accept {
  border-color: #14735a;
  background: #14735a;
}

.message-action--reject {
  border-color: #a33a3a;
  background: #a33a3a;
}

.message-action--secondary {
  border-color: rgb(16 59 49 / 18%);
  color: var(--color-ink);
  background: #ffffff;
  box-shadow: 0 8px 18px rgb(16 24 22 / 8%);
}

.inline-link {
  padding: 0;
  border: 0;
  color: #14735a;
  background: transparent;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.inline-link--display {
  width: fit-content;
  color: #146b55;
  font-family: var(--font-display);
  font-size: 1.72rem;
  line-height: 1.12;
  font-weight: 900;
  text-align: left;
}

.inline-plain--display {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.72rem;
  line-height: 1.12;
  font-weight: 900;
}

.status-label {
  font-family: var(--font-display);
  font-size: 1.48rem;
  line-height: 1;
  font-weight: 900;
}

.status-label--accepted {
  color: #14735a;
}

.status-label--rejected {
  color: #a33a3a;
}

@media (max-width: 860px) {
  .messages-header {
    align-items: stretch;
    flex-direction: column;
  }

  .command-toolbar {
    justify-content: start;
    flex-wrap: wrap;
  }

  .message-toolbar-actions {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  .messages-page {
    padding-block: 20px 42px;
  }

  .messages-header,
  .message-state {
    padding: 12px;
  }

  .command-toolbar,
  .stat-strip,
  .notification-card {
    width: 100%;
  }

  .stat-strip span {
    flex: 1 1 0;
    justify-content: center;
  }

  .notification-card {
    grid-template-columns: 8px minmax(0, 1fr);
    gap: 10px;
  }

  .append-error-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
