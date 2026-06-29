<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import {
  getWorldDetail,
  leaveWorld,
  listJoinWorldRequests,
  listWorldMembers,
  removeWorldMember,
  reviewJoinRequest,
  updateWorldMemberRole
} from '@/api/world'
import { useAuthStore } from '@/stores/auth'
import type {
  PageResponse,
  WorldDetail,
  WorldJoinRequestResponse,
  WorldMember
} from '@/types/world'

type MembersTab = 'members' | 'requests'
type RequestStatus = 'pending' | 'approved' | 'rejected' | 'all'
type ReviewDecision = 'approve' | 'reject'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const worldId = computed(() => String(route.params.worldId || ''))

const world = ref<WorldDetail | null>(null)
const activeTab = ref<MembersTab>('members')
const requestStatus = ref<RequestStatus>('pending')

const loading = ref(true)
const errorMessage = ref('')

const members = ref<WorldMember[]>([])
const membersLoading = ref(false)
const membersError = ref('')

const requests = ref<WorldJoinRequestResponse[]>([])
const requestsLoading = ref(false)
const requestsLoadingMore = ref(false)
const requestsError = ref('')
const requestsAppendError = ref('')
const requestPage = ref(1)
const requestTotal = ref(0)
const requestTotalPages = ref(0)

const reviewTarget = ref<WorldJoinRequestResponse | null>(null)
const reviewDecision = ref<ReviewDecision>('approve')
const reviewComment = ref('')
const reviewSubmitting = ref(false)
const reviewError = ref('')
const successMessage = ref('')
const memberActionKey = ref('')
const memberActionError = ref('')
const leavingWorld = ref(false)

const canManageWorld = computed(() => {
  const role = world.value?.viewer.role
  return role === 'creator' || role === 'co_admin'
})
const canLeaveWorld = computed(() => {
  const role = world.value?.viewer.role
  return Boolean(role && role !== 'creator')
})
const canLoadMoreRequests = computed(() => requestPage.value < requestTotalPages.value)

const requestTabs: { value: RequestStatus; label: string }[] = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' }
]

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function formatDateTime(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN')
}

function formatRole(role: string) {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共同管理员'
  return '协作者'
}

function canChangeMemberRole(member: WorldMember) {
  if (world.value?.viewer.role !== 'creator' || member.role === 'creator') {
    return false
  }
  return member.userId !== authStore.currentUser?.userId
}

function canKickMember(member: WorldMember) {
  if (member.role === 'creator' || member.userId === authStore.currentUser?.userId) {
    return false
  }
  if (world.value?.viewer.role === 'creator') {
    return true
  }
  return world.value?.viewer.role === 'co_admin' && member.role === 'contributor'
}

function actionKey(action: string, member: WorldMember) {
  return `${action}:${member.userId}`
}

function statusLabel(status: string) {
  if (status === 'pending') return '待审核'
  if (status === 'approved') return '已通过'
  if (status === 'rejected') return '已拒绝'
  return status
}

async function loadWorld() {
  world.value = await getWorldDetail(worldId.value)
}

async function loadMembers() {
  membersLoading.value = true
  membersError.value = ''
  try {
    members.value = await listWorldMembers(worldId.value)
  } catch (error) {
    membersError.value = getErrorMessage(error, '成员列表暂时无法加载，请稍后重试。')
  } finally {
    membersLoading.value = false
  }
}

async function loadRequests(options: { append?: boolean } = {}) {
  if (!canManageWorld.value) return

  const append = options.append === true
  if (append) {
    requestsLoadingMore.value = true
    requestsAppendError.value = ''
  } else {
    requestPage.value = 1
    requestsLoading.value = true
    requestsError.value = ''
    requestsAppendError.value = ''
  }

  try {
    const data: PageResponse<WorldJoinRequestResponse> = await listJoinWorldRequests(worldId.value, {
      status: requestStatus.value,
      page: requestPage.value,
      pageSize: 10
    })
    requests.value = append ? requests.value.concat(data.items) : data.items
    requestTotal.value = data.total
    requestTotalPages.value = data.totalPages
  } catch (error) {
    const message = getErrorMessage(error, '申请列表暂时无法加载，请稍后重试。')
    if (append) {
      requestsAppendError.value = message
    } else {
      requestsError.value = message
    }
  } finally {
    requestsLoading.value = false
    requestsLoadingMore.value = false
  }
}

async function loadAll() {
  loading.value = true
  errorMessage.value = ''
  try {
    await loadWorld()
    await loadMembers()
    if (canManageWorld.value) {
      await loadRequests()
    }
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '世界档案暂时无法加载，请稍后重试。')
  } finally {
    loading.value = false
  }
}

async function switchTab(tab: MembersTab) {
  activeTab.value = tab
  if (tab === 'requests' && requests.value.length === 0 && !requestsLoading.value) {
    await loadRequests()
  }
}

async function switchRequestStatus(status: RequestStatus) {
  if (requestStatus.value === status) return
  requestStatus.value = status
  await loadRequests()
}

async function loadMoreRequests() {
  if (!canLoadMoreRequests.value || requestsLoadingMore.value) return
  const previousPage = requestPage.value
  requestPage.value += 1
  await loadRequests({ append: true })
  if (requestsAppendError.value) {
    requestPage.value = previousPage
  }
}

function openReview(request: WorldJoinRequestResponse, decision: ReviewDecision) {
  reviewTarget.value = request
  reviewDecision.value = decision
  reviewComment.value = ''
  reviewError.value = ''
}

function closeReview() {
  if (reviewSubmitting.value) return
  reviewTarget.value = null
}

async function submitReview() {
  if (!reviewTarget.value) return
  reviewSubmitting.value = true
  reviewError.value = ''

  try {
    const result = await reviewJoinRequest(worldId.value, reviewTarget.value.requestId, {
      decision: reviewDecision.value,
      comment: reviewComment.value.trim() || undefined
    })

    if (requestStatus.value === 'pending') {
      requests.value = requests.value.filter((item) => item.requestId !== result.requestId)
      requestTotal.value = Math.max(0, requestTotal.value - 1)
    } else {
      const index = requests.value.findIndex((item) => item.requestId === result.requestId)
      if (index !== -1) {
        requests.value[index] = result
      }
    }

    if (result.status === 'approved') {
      await loadMembers()
    }

    successMessage.value = result.status === 'approved' ? '已通过加入申请。' : '已拒绝加入申请。'
    reviewTarget.value = null
  } catch (error) {
    reviewError.value = getErrorMessage(error, '审核失败，请稍后重试。')
  } finally {
    reviewSubmitting.value = false
  }
}

async function changeMemberRole(member: WorldMember, role: 'contributor' | 'co_admin') {
  if (!canChangeMemberRole(member) || member.role === role) return

  memberActionKey.value = actionKey(`role-${role}`, member)
  memberActionError.value = ''
  try {
    const updated = await updateWorldMemberRole(worldId.value, member.userId, { role })
    members.value = members.value.map((item) => item.userId === updated.userId ? updated : item)
    successMessage.value = `已将 ${member.nickname || member.username} 调整为${formatRole(role)}。`
  } catch (error) {
    memberActionError.value = getErrorMessage(error, '成员权限修改失败，请稍后重试。')
  } finally {
    memberActionKey.value = ''
  }
}

async function kickMember(member: WorldMember) {
  if (!canKickMember(member)) return
  const confirmed = window.confirm(`确定要将 ${member.nickname || member.username} 移出这个世界吗？`)
  if (!confirmed) return

  memberActionKey.value = actionKey('remove', member)
  memberActionError.value = ''
  try {
    await removeWorldMember(worldId.value, member.userId)
    members.value = members.value.filter((item) => item.userId !== member.userId)
    successMessage.value = `已将 ${member.nickname || member.username} 移出世界。`
  } catch (error) {
    memberActionError.value = getErrorMessage(error, '移出成员失败，请稍后重试。')
  } finally {
    memberActionKey.value = ''
  }
}

async function leaveCurrentWorld() {
  if (!canLeaveWorld.value || leavingWorld.value) return
  const confirmed = window.confirm('确定要退出这个世界吗？退出后将失去该世界的成员权限。')
  if (!confirmed) return

  leavingWorld.value = true
  memberActionError.value = ''
  try {
    await leaveWorld(worldId.value)
    await router.push({ name: 'world-detail', params: { worldId: worldId.value } })
  } catch (error) {
    memberActionError.value = getErrorMessage(error, '退出世界失败，请稍后重试。')
  } finally {
    leavingWorld.value = false
  }
}

onMounted(async () => {
  await loadAll()
})
</script>

<template>
  <main class="members-page">
    <section v-if="loading" class="members-shell page-container">
      <div class="members-state">
        <p>正在读取成员与申请...</p>
      </div>
    </section>

    <section v-else-if="errorMessage || !world" class="members-shell page-container">
      <div class="members-state members-state--error">
        <h1>成员管理暂时不可用</h1>
        <p>{{ errorMessage || '请稍后再试。' }}</p>
        <div class="state-actions">
          <RouterLink class="state-button state-button--primary" :to="{ name: 'world-detail', params: { worldId } }">
            返回世界详情
          </RouterLink>
          <button type="button" class="state-button" @click="loadAll">重新加载</button>
        </div>
      </div>
    </section>

    <section v-else class="members-shell page-container">
      <nav class="members-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          {{ world.name }}
        </RouterLink>
        <span>/</span>
        <strong>成员管理</strong>
      </nav>

      <header class="members-header">
        <div>
          <p class="eyebrow">Members</p>
          <h1>成员与加入申请</h1>
        </div>
        <dl>
          <div>
            <dt>成员</dt>
            <dd>{{ members.length }}</dd>
          </div>
          <div v-if="canManageWorld">
            <dt>当前申请</dt>
            <dd>{{ requestTotal }}</dd>
          </div>
        </dl>
        <button
          v-if="canLeaveWorld"
          type="button"
          class="leave-world-button"
          :disabled="leavingWorld"
          @click="leaveCurrentWorld"
        >
          {{ leavingWorld ? '退出中...' : '退出世界' }}
        </button>
      </header>

      <nav class="section-tabs" aria-label="成员管理视图">
        <button
          type="button"
          class="section-tab"
          :class="{ 'section-tab--active': activeTab === 'members' }"
          @click="switchTab('members')"
        >
          成员名单
        </button>
        <button
          v-if="canManageWorld"
          type="button"
          class="section-tab"
          :class="{ 'section-tab--active': activeTab === 'requests' }"
          @click="switchTab('requests')"
        >
          加入申请
        </button>
      </nav>

      <div v-if="successMessage" class="success-banner" role="status">
        {{ successMessage }}
        <button type="button" @click="successMessage = ''">关闭</button>
      </div>
      <div v-if="memberActionError" class="action-error-banner" role="alert">
        {{ memberActionError }}
        <button type="button" @click="memberActionError = ''">关闭</button>
      </div>

      <section v-if="activeTab === 'members'" class="members-panel">
        <div class="panel-heading">
          <h2>成员名单</h2>
          <button type="button" class="panel-action" :disabled="membersLoading" @click="loadMembers">
            {{ membersLoading ? '刷新中...' : '刷新' }}
          </button>
        </div>

        <div v-if="membersLoading" class="members-state members-state--compact">
          <p>正在加载成员...</p>
        </div>
        <div v-else-if="membersError" class="members-state members-state--compact members-state--error">
          <p>{{ membersError }}</p>
          <button type="button" class="state-button" @click="loadMembers">重试</button>
        </div>
        <div v-else class="member-list">
          <article v-for="member in members" :key="member.userId" class="member-row">
            <span class="member-avatar">
              <img v-if="member.avatarUrl" :src="member.avatarUrl" alt="" />
              <span v-else>{{ (member.nickname || member.username || '?').charAt(0) }}</span>
            </span>
            <div class="member-main">
              <strong>{{ member.nickname || member.username }}</strong>
              <span>{{ member.username }} · {{ member.userId }}</span>
            </div>
            <span class="role-chip">{{ formatRole(member.role) }}</span>
            <time>{{ formatDateTime(member.joinedAt) }}</time>
            <div v-if="canChangeMemberRole(member) || canKickMember(member)" class="member-actions">
              <button
                v-if="canChangeMemberRole(member) && member.role !== 'contributor'"
                type="button"
                class="member-action"
                :disabled="Boolean(memberActionKey)"
                @click="changeMemberRole(member, 'contributor')"
              >
                {{ memberActionKey === actionKey('role-contributor', member) ? '调整中...' : '设为协作者' }}
              </button>
              <button
                v-if="canChangeMemberRole(member) && member.role !== 'co_admin'"
                type="button"
                class="member-action"
                :disabled="Boolean(memberActionKey)"
                @click="changeMemberRole(member, 'co_admin')"
              >
                {{ memberActionKey === actionKey('role-co_admin', member) ? '调整中...' : '设为管理员' }}
              </button>
              <button
                v-if="canKickMember(member)"
                type="button"
                class="member-action member-action--danger"
                :disabled="Boolean(memberActionKey)"
                @click="kickMember(member)"
              >
                {{ memberActionKey === actionKey('remove', member) ? '移出中...' : '踢出' }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="members-panel">
        <div class="panel-heading">
          <h2>加入申请</h2>
          <button type="button" class="panel-action" :disabled="requestsLoading" @click="loadRequests()">
            {{ requestsLoading ? '刷新中...' : '刷新' }}
          </button>
        </div>

        <nav class="request-tabs" aria-label="申请状态筛选">
          <button
            v-for="tab in requestTabs"
            :key="tab.value"
            type="button"
            class="request-tab"
            :class="{ 'request-tab--active': requestStatus === tab.value }"
            @click="switchRequestStatus(tab.value)"
          >
            {{ tab.label }}
          </button>
        </nav>

        <div v-if="requestsLoading" class="members-state members-state--compact">
          <p>正在加载申请...</p>
        </div>
        <div v-else-if="requestsError" class="members-state members-state--compact members-state--error">
          <p>{{ requestsError }}</p>
          <button type="button" class="state-button" @click="loadRequests()">重试</button>
        </div>
        <div v-else-if="requests.length === 0" class="members-state members-state--compact">
          <h2>暂无加入申请</h2>
          <p>{{ requestStatus === 'pending' ? '当前没有待审核的加入申请。' : '没有匹配当前状态的申请。' }}</p>
        </div>
        <div v-else class="request-list">
          <article v-for="request in requests" :key="request.requestId" class="request-card">
            <div class="request-card__top">
              <div>
                <strong>{{ request.requesterId }}</strong>
                <span>{{ formatDateTime(request.requestedAt) }}</span>
              </div>
              <span class="status-chip" :class="`status-chip--${request.status}`">
                {{ statusLabel(request.status) }}
              </span>
            </div>
            <p>{{ request.message || '申请人未填写理由。' }}</p>
            <div v-if="request.reviewedAt" class="review-result">
              <span>审核人：{{ request.reviewedBy || '-' }}</span>
              <span>{{ formatDateTime(request.reviewedAt) }}</span>
              <p v-if="request.reviewComment">{{ request.reviewComment }}</p>
            </div>
            <div v-if="request.status === 'pending'" class="request-card__actions">
              <button type="button" class="review-button review-button--approve" @click="openReview(request, 'approve')">
                通过
              </button>
              <button type="button" class="review-button review-button--reject" @click="openReview(request, 'reject')">
                拒绝
              </button>
            </div>
          </article>
        </div>

        <div v-if="requestsAppendError" class="append-error-row">
          <span>{{ requestsAppendError }}</span>
          <button type="button" @click="loadMoreRequests">再试一次</button>
        </div>

        <div v-if="canLoadMoreRequests" class="load-more-row">
          <button type="button" class="panel-action" :disabled="requestsLoadingMore" @click="loadMoreRequests">
            {{ requestsLoadingMore ? '加载中...' : '加载更多' }}
          </button>
        </div>
      </section>
    </section>

    <Teleport to="body">
      <div v-if="reviewTarget" class="modal-overlay" @click.self="closeReview">
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <header class="modal-header">
            <h2 id="review-title">{{ reviewDecision === 'approve' ? '通过加入申请' : '拒绝加入申请' }}</h2>
            <button type="button" class="modal-close" aria-label="关闭" @click="closeReview">×</button>
          </header>
          <div class="modal-body">
            <div class="review-summary">
              <span>申请人</span>
              <strong>{{ reviewTarget.requesterId }}</strong>
              <p>{{ reviewTarget.message || '申请人未填写理由。' }}</p>
            </div>
            <label class="field">
              <span>审核意见（可选）</span>
              <textarea v-model="reviewComment" maxlength="500" rows="4" placeholder="给申请人留一句说明。"></textarea>
              <small>{{ reviewComment.length }} / 500</small>
            </label>
            <p v-if="reviewError" class="modal-error" role="alert">{{ reviewError }}</p>
          </div>
          <footer class="modal-footer">
            <button type="button" class="modal-button" :disabled="reviewSubmitting" @click="closeReview">取消</button>
            <button
              type="button"
              class="modal-button modal-button--primary"
              :class="{ 'modal-button--danger': reviewDecision === 'reject' }"
              :disabled="reviewSubmitting"
              @click="submitReview"
            >
              {{ reviewSubmitting ? '处理中...' : (reviewDecision === 'approve' ? '确认通过' : '确认拒绝') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.members-page {
  padding-block: 28px 56px;
}

.members-shell {
  display: grid;
  gap: 18px;
}

.members-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.members-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.members-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.members-header,
.members-panel,
.members-state,
.section-tabs,
.success-banner,
.action-error-banner {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.members-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 20px;
  align-items: end;
  padding: 24px;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.members-header h1,
.members-state h1,
.members-state h2,
.panel-heading h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.members-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.2rem);
  line-height: 1.03;
}

.members-header dl {
  display: grid;
  grid-auto-flow: column;
  gap: 10px;
  margin: 0;
}

.members-header dl div {
  min-width: 112px;
  padding: 12px 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 48%);
}

.members-header dt {
  color: var(--color-muted);
  font-size: 0.78rem;
  font-weight: 900;
}

.members-header dd {
  margin: 4px 0 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.8rem;
  font-weight: 900;
  line-height: 1;
}

.section-tabs,
.request-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
}

.section-tab,
.request-tab {
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 7px;
  color: var(--color-muted);
  background: transparent;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}

.section-tab--active,
.request-tab--active {
  color: #fff;
  background: #103b31;
}

.members-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.panel-heading h2 {
  font-size: 1.6rem;
}

.panel-action,
.state-button,
.success-banner button,
.action-error-banner button,
.review-button,
.modal-button,
.member-action,
.leave-world-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 68%);
  font: inherit;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.panel-action:disabled,
.modal-button:disabled,
.member-action:disabled,
.leave-world-button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.leave-world-button {
  border-color: rgb(176 64 64 / 28%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 76%);
}

.members-state {
  display: grid;
  gap: 12px;
  min-height: 220px;
  padding: 28px;
  align-content: center;
}

.members-state--compact {
  min-height: 160px;
  box-shadow: none;
}

.members-state--error {
  background: rgb(108 36 36 / 6%);
}

.members-state p,
.members-state h1,
.members-state h2 {
  margin: 0;
}

.members-state p {
  color: var(--color-muted);
  line-height: 1.7;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.state-button--primary,
.modal-button--primary {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.member-list,
.request-list {
  display: grid;
  gap: 10px;
}

.member-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto minmax(170px, auto) auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 50%);
}

.member-avatar {
  display: inline-grid;
  width: 44px;
  height: 44px;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: #fff;
  background: #103b31;
  font-weight: 900;
}

.member-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.member-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.member-main strong {
  color: var(--color-ink);
  overflow-wrap: anywhere;
}

.member-main span,
.member-row time,
.request-card span,
.review-result {
  color: var(--color-muted);
  font-size: 0.86rem;
  font-weight: 800;
}

.member-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.member-action {
  min-height: 32px;
  padding-inline: 10px;
  font-size: 0.78rem;
}

.member-action--danger {
  border-color: rgb(176 64 64 / 24%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 72%);
}

.role-chip,
.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  color: #305349;
  background: rgb(232 241 237 / 72%);
  font-size: 0.8rem;
  font-weight: 900;
  white-space: nowrap;
}

.request-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 50%);
}

.request-card__top,
.request-card__actions,
.append-error-row,
.load-more-row,
.success-banner {
  display: flex;
  align-items: center;
  gap: 10px;
}

.request-card__top {
  justify-content: space-between;
}

.request-card__top > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.request-card__top strong {
  color: var(--color-ink);
  overflow-wrap: anywhere;
}

.request-card p,
.review-result p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.65;
}

.status-chip--pending {
  color: #6c5b24;
  background: rgb(252 240 192 / 72%);
}

.status-chip--approved {
  color: #14735a;
  background: rgb(232 241 237 / 72%);
}

.status-chip--rejected {
  color: #8f2d2d;
  background: rgb(255 246 242 / 78%);
}

.review-button--approve {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.review-button--reject,
.modal-button--danger {
  border-color: rgb(143 45 45 / 34%);
  color: #8f2d2d;
  background: rgb(255 246 242 / 86%);
}

.review-result {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding-top: 10px;
  border-top: 1px solid var(--color-line);
}

.review-result p {
  flex-basis: 100%;
}

.append-error-row,
.success-banner,
.action-error-banner {
  justify-content: space-between;
  padding: 12px 14px;
  color: #6c2424;
  background: rgb(108 36 36 / 6%);
  font-weight: 800;
}

.success-banner {
  color: #14735a;
  background: rgb(232 241 237 / 82%);
}

.action-error-banner {
  color: #a1322b;
}

.load-more-row {
  justify-content: center;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(24 33 31 / 38%);
}

.modal-card {
  width: min(520px, 100%);
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 86%), rgb(244 240 231 / 92%)),
    rgb(255 255 255 / 64%);
  box-shadow: 0 32px 92px rgb(24 33 31 / 24%);
}

.modal-header,
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
}

.modal-header h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.45rem;
}

.modal-close {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--color-line);
  border-radius: 50%;
  color: var(--color-muted);
  background: rgb(255 255 255 / 62%);
  font-size: 1.25rem;
  cursor: pointer;
}

.modal-body {
  display: grid;
  gap: 16px;
  padding: 0 20px 18px;
}

.review-summary,
.field {
  display: grid;
  gap: 8px;
}

.review-summary {
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 48%);
}

.review-summary span,
.field span,
.field small {
  color: var(--color-muted);
  font-size: 0.84rem;
  font-weight: 900;
}

.review-summary strong {
  color: var(--color-ink);
}

.field textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 82%);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
}

.field small {
  text-align: right;
}

.modal-error {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid rgb(143 45 45 / 24%);
  border-radius: 8px;
  color: #8f2d2d;
  background: rgb(255 246 242 / 92%);
  font-weight: 800;
}

.modal-footer {
  justify-content: flex-end;
  padding-top: 0;
}

@media (max-width: 760px) {
  .members-page {
    padding-block: 20px 42px;
  }

  .members-header,
  .member-row {
    grid-template-columns: 1fr;
  }

  .members-header dl {
    grid-auto-flow: row;
  }

  .member-row {
    align-items: start;
  }

  .request-card__top,
  .append-error-row,
  .success-banner,
  .action-error-banner {
    align-items: stretch;
    flex-direction: column;
  }

  .section-tab,
  .request-tab,
  .panel-action,
  .state-button {
    flex: 1;
  }
}
</style>
