<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { listMyWorlds } from '@/api/world'
import type { WorldListItem } from '@/types/world'

interface ProfileTab {
  key: 'created' | 'contributed'
  label: string
  count: number
}

const router = useRouter()
const authStore = useAuthStore()

const currentUser = computed(() => authStore.currentUser)

const allWorlds = ref<WorldListItem[]>([])
const worldsLoading = ref(false)
const worldsError = ref('')
const activeTabKey = ref<ProfileTab['key']>('created')
const avatarImageFailed = ref(false)

const displayName = computed(() => {
  const user = currentUser.value
  return user?.nickname || user?.username || '用户'
})

const avatarSrc = computed(() => {
  if (avatarImageFailed.value) {
    return null
  }
  const url = currentUser.value?.avatarUrl
  return url && url.length > 0 ? url : null
})

const formattedJoinDate = computed(() => {
  const raw = currentUser.value?.createdAt
  if (!raw) return ''
  const date = new Date(raw)
  if (isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月加入`
})

const createdWorlds = computed(() => {
  if (!currentUser.value) return []
  return allWorlds.value.filter((w) => w.creator.userId === currentUser.value!.userId)
})

const contributedWorlds = computed(() => {
  if (!currentUser.value) return []
  return allWorlds.value.filter((w) => w.creator.userId !== currentUser.value!.userId)
})

const tabs = computed<ProfileTab[]>(() => [
  {
    key: 'created',
    label: '创建的世界',
    count: createdWorlds.value.length
  },
  {
    key: 'contributed',
    label: '有贡献的世界',
    count: contributedWorlds.value.length
  }
])

const currentWorlds = computed(() => {
  if (activeTabKey.value === 'created') return createdWorlds.value
  return contributedWorlds.value
})

const initialLetter = computed(() => displayName.value.charAt(0))

async function loadWorlds() {
  if (!currentUser.value) return
  worldsLoading.value = true
  worldsError.value = ''
  try {
    const response = await listMyWorlds({ pageSize: 100 })
    allWorlds.value = response.items
  } catch (err: any) {
    worldsError.value = err?.message || '加载失败，请稍后重试'
  } finally {
    worldsLoading.value = false
  }
}

function goToWorld(worldId: string) {
  router.push({ name: 'world-detail', params: { worldId } })
}

function formatTime(raw: string): string {
  if (!raw) return ''
  const date = new Date(raw)
  if (isNaN(date.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`
  if (diffDays < 365) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

onMounted(() => {
  loadWorlds()
})
</script>

<template>
  <main class="profile-page">
    <!-- 未登录 -->
    <section v-if="!currentUser" class="profile-empty page-container">
      <p class="eyebrow">Profile</p>
      <h2>请先登录</h2>
      <p>登录后即可查看您的个人主页、创建的世界与创作活动。</p>
      <RouterLink class="login-btn" :to="{ name: 'login' }">前往登录</RouterLink>
    </section>

    <template v-else>
      <!-- ① 用户信息头部 -->
      <section class="profile-header page-container">
        <div class="profile-avatar-wrap">
          <img
            v-if="avatarSrc"
            :src="avatarSrc"
            alt=""
            class="profile-avatar-img"
            @error="avatarImageFailed = true"
          />
          <span
            v-else
            class="profile-avatar-initial"
          >{{ initialLetter }}</span>
        </div>

        <div class="profile-info">
          <h1 class="profile-name">{{ displayName }}</h1>
          <p class="profile-username">@{{ currentUser.username }}</p>
          <p v-if="currentUser.bio" class="profile-bio">{{ currentUser.bio }}</p>
          <p v-if="formattedJoinDate" class="profile-join-date">于 {{ formattedJoinDate }}</p>
        </div>
      </section>

      <!-- ② 标签页导航 -->
      <nav class="profile-tabs page-container" aria-label="个人主页栏目">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="profile-tab"
          :class="{ 'profile-tab--active': activeTabKey === tab.key }"
          type="button"
          @click="activeTabKey = tab.key"
        >
          {{ tab.label }}
          <span class="tab-count">{{ tab.count }}</span>
        </button>
      </nav>

      <!-- ③ 内容区 -->
      <section class="profile-content page-container">
        <!-- 加载中 -->
        <div v-if="worldsLoading" class="content-state">
          <p>加载中...</p>
        </div>

        <!-- 错误 -->
        <div v-else-if="worldsError" class="content-state">
          <p>{{ worldsError }}</p>
          <button class="retry-btn" type="button" @click="loadWorlds">重试</button>
        </div>

        <!-- 空状态 -->
        <div v-else-if="currentWorlds.length === 0" class="content-state">
          <p class="eyebrow">Empty</p>
          <h3>暂无内容</h3>
          <p v-if="activeTabKey === 'created'">你还没有创建世界观，快去创作第一个吧。</p>
          <p v-else>你还没有为其他世界观贡献过内容。</p>
          <button
            v-if="activeTabKey === 'created'"
            class="retry-btn"
            type="button"
            @click="router.push({ name: 'my-worlds' })"
          >
            创建世界观
          </button>
        </div>

        <!-- 世界卡片网格 -->
        <div v-else class="world-grid">
          <article
            v-for="world in currentWorlds"
            :key="world.worldId"
            class="world-card"
            @click="goToWorld(world.worldId)"
          >
            <div class="world-card-cover">
              <img v-if="world.coverImageUrl" :src="world.coverImageUrl" :alt="`${world.name} 封面`">
              <span v-else>{{ world.name.charAt(0) }}</span>
            </div>
            <div class="world-card-body">
              <h3>{{ world.name }}</h3>
              <p>{{ world.description }}</p>
              <div v-if="world.tags && world.tags.length > 0" class="tag-list">
                <span v-for="tag in world.tags" :key="tag">{{ tag }}</span>
              </div>
              <div class="world-card-footer">
                <span class="world-card-meta">{{ world.entryCount }} 词条</span>
                <span class="world-card-meta">{{ formatTime(world.updatedAt) }}</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.profile-page {
  padding-bottom: 64px;
}

/* --- 未登录 --- */
.profile-empty {
  min-height: calc(100vh - var(--nav-height) - 200px);
  display: grid;
  align-content: center;
  max-width: 620px;
  padding-block: clamp(48px, 9vw, 108px);
}

.eyebrow {
  margin: 0 0 14px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.profile-empty h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 1.12;
}

.profile-empty p {
  max-width: 520px;
  margin: 16px 0 0;
  color: var(--color-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.login-btn,
.retry-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: var(--color-ink);
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.login-btn {
  margin-top: 24px;
}

/* --- 用户信息头部 --- */
.profile-header {
  display: flex;
  gap: 28px;
  align-items: flex-start;
  padding-top: clamp(32px, 5vw, 56px);
  padding-bottom: 28px;
}

.profile-avatar-wrap {
  flex: 0 0 auto;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-cool);
}

.profile-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-avatar-initial {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #fff;
  background: #103b31;
  font-family: var(--font-display);
  font-size: 2.4rem;
  font-weight: 900;
}

.profile-info {
  min-width: 0;
  padding-top: 4px;
}

.profile-name {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(1.65rem, 3vw, 2.4rem);
  line-height: 1.15;
  word-break: keep-all;
}

.profile-username {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 1rem;
}

.profile-bio {
  margin: 10px 0 0;
  max-width: 520px;
  color: var(--color-muted);
  font-size: 0.93rem;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.profile-join-date {
  margin: 6px 0 0;
  color: var(--color-muted);
  font-size: 0.84rem;
}

/* --- 标签页导航 --- */
.profile-tabs {
  display: flex;
  gap: 4px;
  padding-top: 20px;
  border-bottom: 1px solid var(--color-line);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.profile-tabs::-webkit-scrollbar {
  display: none;
}

.profile-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--color-muted);
  background: transparent;
  font-size: 0.9rem;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  transition: color 150ms ease, border-color 150ms ease;
  margin-bottom: -1px;
}

.profile-tab:hover {
  color: var(--color-ink);
}

.profile-tab--active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgb(20 115 90 / 9%);
  color: var(--color-accent);
  font-size: 0.72rem;
  font-weight: 800;
}

/* --- 栏目内容区 --- */
.profile-content {
  padding-top: 24px;
}

.content-state {
  display: grid;
  place-items: center;
  gap: 10px;
  padding-block: 64px 48px;
  text-align: center;
}

.content-state h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.5rem;
}

.content-state p {
  max-width: 420px;
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 0.95rem;
  line-height: 1.65;
}

.content-state .eyebrow {
  margin-bottom: 0;
}

.retry-btn {
  margin-top: 12px;
}

/* --- 世界卡片网格 --- */
.world-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.world-card {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 58%);
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 150ms ease;
}

.world-card:hover {
  box-shadow: 0 4px 20px rgb(24 33 31 / 8%);
}

.world-card-cover {
  display: grid;
  height: 260px;
  place-items: center;
  overflow: hidden;
  border-bottom: 1px solid var(--color-line);
  color: #103b31;
  background: #edf4f0;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 900;
}

.world-card-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.world-card-body {
  display: grid;
  gap: 10px;
  padding: 16px;
}

.world-card-body h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.18rem;
  line-height: 1.3;
}

.world-card-body p {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.88rem;
  line-height: 1.6;
  display: -webkit-box;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-list span {
  padding: 3px 7px;
  border: 1px solid rgb(20 115 90 / 18%);
  border-radius: 6px;
  color: var(--color-accent);
  background: rgb(20 115 90 / 7%);
  font-size: 0.72rem;
  font-weight: 800;
}

.world-card-footer {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line);
}

.world-card-meta {
  color: var(--color-muted);
  font-size: 0.78rem;
}

/* --- 响应式 --- */
@media (max-width: 1040px) {
  .world-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .profile-avatar-wrap {
    width: 72px;
    height: 72px;
  }

  .profile-avatar-initial {
    font-size: 1.8rem;
  }

  .profile-bio {
    margin-left: auto;
    margin-right: auto;
  }

  .world-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 460px) {
  .profile-avatar-wrap {
    width: 56px;
    height: 56px;
  }

  .profile-avatar-initial {
    font-size: 1.4rem;
  }

  .profile-tab {
    padding-inline: 12px;
    font-size: 0.84rem;
  }
}
</style>
