<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/http'
import { getWorldDetail, listMyWorlds } from '@/api/world'
import type { PageResponse, WorldListItem, WorldVisibility } from '@/types/world'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const worlds = ref<WorldListItem[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const appendError = ref('')
const keywordInput = ref('')
const keyword = ref('')
const activeTab = ref<'all' | 'managed' | 'created'>('all')

const currentUser = computed(() => authStore.currentUser)

const filteredWorlds = computed(() => {
  if (activeTab.value === 'all') return worlds.value
  if (activeTab.value === 'managed') {
    return worlds.value.filter((w) => w.role === 'creator' || w.role === 'co_admin')
  }
  if (activeTab.value === 'created') {
    if (!currentUser.value) return []
    return worlds.value.filter((w) => w.creator.userId === currentUser.value!.userId)
  }
  return worlds.value
})

const managedCount = computed(() => {
  return worlds.value.filter((w) => w.role === 'creator' || w.role === 'co_admin').length
})

const createdCount = computed(() => {
  if (!currentUser.value) return 0
  return worlds.value.filter((w) => w.creator.userId === currentUser.value!.userId).length
})

const isEmpty = computed(() => !loading.value && !errorMessage.value && filteredWorlds.value.length === 0)
const isGlobalEmpty = computed(() => !loading.value && !errorMessage.value && worlds.value.length === 0)
const canLoadMore = computed(() => page.value < totalPages.value)

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  return '世界观列表暂时无法加载，请稍后重试。'
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

function formatVisibility(value: WorldVisibility) {
  if (value === 'public') return '公开'
  if (value === 'protected') return '仅邀请'
  return '私有'
}

function formatRole(role?: string): string {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共同管理员'
  if (role === 'contributor') return '协作者'
  return ''
}

function tabLabel(key: 'all' | 'managed' | 'created'): string {
  if (key === 'all') return '全部世界观'
  if (key === 'managed') return '我管理的'
  return '我创建的'
}

async function fetchWorlds(options: { append?: boolean } = {}) {
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
    const data: PageResponse<WorldListItem> = await listMyWorlds({
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: 9
    })

    const hydratedItems = await hydrateWorldListItems(data.items)

    worlds.value = append ? worlds.value.concat(hydratedItems) : hydratedItems
    total.value = data.total
    totalPages.value = data.totalPages
    errorMessage.value = ''
    appendError.value = ''

    if (!append && !keyword.value && data.total === 0) {
      await router.replace({ name: 'create-world' })
    }
    return true
  } catch (error) {
    const message = getErrorMessage(error)
    if (append && worlds.value.length > 0) {
      appendError.value = message
    } else {
      errorMessage.value = message
    }
    return false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function hydrateWorldListItems(items: WorldListItem[]) {
  return Promise.all(
    items.map(async (item) => {
      try {
        const detail = await getWorldDetail(item.worldId)
        return {
          ...item,
          description: detail.description,
          coverImageUrl: detail.coverImageUrl || item.coverImageUrl,
          tags: detail.tags.length > 0 ? detail.tags : item.tags
        }
      } catch {
        return item
      }
    })
  )
}

async function handleSearchSubmit() {
  page.value = 1
  keyword.value = keywordInput.value.trim()
  await router.replace({
    name: 'my-worlds',
    query: keyword.value ? { q: keyword.value } : {}
  })
  await fetchWorlds()
}

async function handleLoadMore() {
  if (!canLoadMore.value || loadingMore.value) {
    return
  }

  const previousPage = page.value
  page.value += 1
  const loaded = await fetchWorlds({ append: true })
  if (!loaded) {
    page.value = previousPage
  }
}

async function retry() {
  page.value = 1
  await fetchWorlds()
}

function switchTab(tab: 'all' | 'managed' | 'created') {
  activeTab.value = tab
}

watch(keywordInput, async (value, oldValue) => {
  if (value === '' && oldValue !== '' && keyword.value !== '') {
    keyword.value = ''
    page.value = 1
    await router.replace({ name: 'my-worlds' })
    await fetchWorlds()
  }
})

onMounted(async () => {
  const queryKeyword = typeof route.query.q === 'string' ? route.query.q.trim() : ''
  keyword.value = queryKeyword
  keywordInput.value = queryKeyword
  await fetchWorlds()
})

watch(
  () => route.query.q,
  async (value) => {
    const nextKeyword = typeof value === 'string' ? value.trim() : ''
    if (nextKeyword === keyword.value && nextKeyword === keywordInput.value) {
      return
    }

    keyword.value = nextKeyword
    keywordInput.value = nextKeyword
    page.value = 1
    await fetchWorlds()
  }
)
</script>

<template>
  <main class="my-worlds-page">
    <section class="my-worlds-shell page-container">
      <header class="my-worlds-command">
        <div class="command-title">
          <h1>我的世界观</h1>
          <span>{{ tabLabel(activeTab) }} · {{ filteredWorlds.length }} / {{ total }}</span>
        </div>

        <form class="command-toolbar" @submit.prevent="handleSearchSubmit">
          <label class="search-field">
            <input
              v-model="keywordInput"
              name="keyword"
              placeholder="搜索世界名称"
              type="search"
              aria-label="搜索世界名称"
            >
            <button class="search-icon-button" type="submit" aria-label="搜索">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.2 4.2" />
              </svg>
            </button>
          </label>

          <div class="stat-strip" aria-label="世界观概况">
            <span><strong>{{ total }}</strong>全部</span>
            <span><strong>{{ managedCount }}</strong>管理</span>
            <span><strong>{{ createdCount }}</strong>创建</span>
          </div>

          <div
            class="view-group"
            :class="`view-group--${activeTab}`"
            role="group"
            aria-label="视图切换"
          >
            <button
              v-for="tab in (['all', 'managed', 'created'] as const)"
              :key="tab"
              type="button"
              class="view-chip"
              :class="{ 'view-chip--active': activeTab === tab }"
              @click="switchTab(tab)"
            >
              {{ tabLabel(tab) }}
            </button>
          </div>

          <RouterLink class="create-world-button" :to="{ name: 'create-world' }">
            <svg
              class="forge-icon"
              viewBox="0 0 92 86"
              aria-hidden="true"
              focusable="false"
            >
              <g class="forge-hammer-position">
                <g class="forge-hammer">
                  <path
                    class="forge-hammer__body"
                    d="M52 4c1.4-1.4 3.6-1.4 5 0l17 17c1.4 1.4 1.4 3.6 0 5L58.5 41.5c-1.4 1.4-3.6 1.4-5 0l-4.1-4.1-22.4 22.4c-1.2 1.2-3.1 1.2-4.2 0l-3.1-3.1c-1.2-1.2-1.2-3.1 0-4.2l22.4-22.4-4.2-4.2c-1.4-1.4-1.4-3.6 0-5z"
                  />
                </g>
              </g>
              <path class="forge-anvil" d="M14 47h18l6-6h43v11H65l-11 8H17z" />
              <path class="forge-waist" d="M31 60h24l-7 13H36z" />
              <path class="forge-base" d="M21 73h44l8 8H12z" />
              <path class="forge-spark" d="M63 39h6M60.5 36.5l4-4M61 42.5l4.2 3.8" />
            </svg>
            <span>新建世界</span>
          </RouterLink>
        </form>
      </header>

      <section v-if="loading" class="desk-state" aria-live="polite">
        <p>正在读取你的世界观档案...</p>
      </section>

      <section v-else-if="errorMessage" class="desk-state desk-state--error">
        <h2>世界观列表暂时不可用</h2>
        <p>{{ errorMessage }}</p>
        <button type="button" class="desk-action" @click="retry">重新加载</button>
      </section>

      <section v-else-if="isGlobalEmpty" class="desk-state">
        <h2>还没有加入任何世界观</h2>
        <p>从第一份世界档案开始，把设定、词条和协作入口慢慢搭起来。</p>
        <RouterLink class="desk-action" :to="{ name: 'create-world' }">新建世界</RouterLink>
      </section>

      <section v-else-if="isEmpty && !isGlobalEmpty" class="desk-state">
        <h2 v-if="activeTab === 'managed'">你目前没有管理的世界观</h2>
        <h2 v-else-if="activeTab === 'created'">你还没有创建过世界观</h2>
        <p v-if="activeTab === 'managed'">你参与的世界观中没有以创建者或共同管理员身份管理的项目。</p>
        <p v-else-if="activeTab === 'created'">去创建一个属于你自己的世界观吧。</p>
        <RouterLink
          v-if="activeTab === 'created'"
          class="desk-action"
          :to="{ name: 'create-world' }"
        >
          去创建第一个
        </RouterLink>
      </section>

      <section v-else class="world-desk" aria-live="polite">
        <div class="world-desk__meta">
          <p>
            <template v-if="keyword">
              "{{ keyword }}" 匹配到 {{ filteredWorlds.length }} 个世界观
            </template>
            <template v-else>
              {{ tabLabel(activeTab) }} &middot; {{ filteredWorlds.length }} 个
            </template>
          </p>
          <span>从这里进入世界档案，继续补全设定、故事线和协作内容。</span>
        </div>

        <div class="work-world-grid">
          <RouterLink
            v-for="world in filteredWorlds"
            :key="world.worldId"
            class="work-world-card"
            :to="{
              name: 'world-detail',
              params: { worldId: world.worldId },
              query: { mode: 'create' }
            }"
          >
            <div class="work-world-reveal">
              <div class="work-world-cover" aria-hidden="true">
                <img v-if="world.coverImageUrl" :src="world.coverImageUrl" alt="">
                <span v-else>{{ world.name.charAt(0) }}</span>
              </div>

              <div class="work-world-main">
                <div class="work-world-title-line">
                  <h2>{{ world.name }}</h2>
                  <span class="visibility-chip">{{ formatVisibility(world.visibility) }}</span>
                  <span v-if="world.role" class="role-chip">{{ formatRole(world.role) }}</span>
                </div>
                <p>{{ world.description || '这个世界还没有填写简介。' }}</p>
                <div class="tag-list" aria-label="标签">
                  <span v-for="tag in world.tags.slice(0, 4)" :key="tag">{{ tag }}</span>
                  <span v-if="world.tags.length > 4">+{{ world.tags.length - 4 }}</span>
                </div>
              </div>
            </div>

            <div class="work-world-side">
              <div class="creator-line">
                <span class="creator-avatar" aria-hidden="true">
                  <img v-if="world.creator.avatarUrl" :src="world.creator.avatarUrl" alt="">
                  <span v-else>{{ world.creator.nickname.charAt(0) }}</span>
                </span>
                <strong>{{ world.creator.nickname }}</strong>
              </div>

              <div class="world-metrics">
                <span>{{ world.entryCount }} 词条</span>
                <small>{{ formatDate(world.updatedAt) }}</small>
              </div>

              <span class="detail-button">
                <svg
                  class="detail-button__icon"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M6 3.5 10.5 8 6 12.5" />
                </svg>
                <span class="detail-button__text">查看详情</span>
              </span>
            </div>
          </RouterLink>
        </div>

        <div v-if="appendError" class="append-error-row" role="status">
          <span>{{ appendError }}</span>
          <button type="button" @click="handleLoadMore">再试一次</button>
        </div>

        <div v-if="canLoadMore" class="load-more-row">
          <button type="button" class="desk-action" :disabled="loadingMore" @click="handleLoadMore">
            {{ loadingMore ? '读取中...' : '加载更多' }}
          </button>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.my-worlds-page {
  padding-block: 22px 54px;
}

.my-worlds-shell {
  display: grid;
  gap: 14px;
}

.desk-state,
.world-desk {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 66%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.my-worlds-command {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 8px;
  background: rgb(255 255 255 / 54%);
}

.command-title {
  display: grid;
  flex: 0 0 auto;
  gap: 6px;
}

.command-title h1,
.desk-state h2,
.work-world-card h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.command-title h1 {
  font-size: 1.55rem;
  line-height: 1;
}

.command-title span,
.desk-state p,
.world-desk__meta span,
.work-world-card p {
  color: var(--color-muted);
  line-height: 1.75;
}

.work-world-card p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

.search-field {
  position: relative;
  display: block;
  flex: 1 1 320px;
  min-width: 240px;
  max-width: 420px;
}

.search-field input {
  width: 100%;
  min-height: 42px;
  padding: 0 48px 0 18px;
  border: 1px solid rgb(16 59 49 / 18%);
  border-radius: 999px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 78%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 70%);
  font: inherit;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.search-field input:focus {
  outline: none;
  border-color: rgb(16 59 49 / 42%);
  background: #fff;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 80%),
    0 0 0 3px rgb(20 115 90 / 10%);
}

.search-icon-button {
  position: absolute;
  top: 50%;
  right: 8px;
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: #103b31;
  background: transparent;
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    color 160ms ease,
    background 160ms ease;
}

.search-icon-button:hover {
  color: #fff;
  background: #14735a;
}

.search-icon-button svg {
  width: 17px;
  height: 17px;
  stroke: currentcolor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.stat-strip,
.view-group {
  display: inline-flex;
  gap: 1px;
  padding: 2px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 999px;
  background: rgb(255 255 255 / 50%);
}

.view-group {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(72px, 1fr));
  overflow: hidden;
}

.view-group::before {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  z-index: 0;
  width: calc((100% - 6px) / 3);
  border-radius: 999px;
  background: #103b31;
  box-shadow: 0 4px 10px rgb(16 59 49 / 8%);
  content: "";
  transition: transform 220ms cubic-bezier(0.34, 1, 0.64, 1);
}

.view-group--managed::before {
  transform: translateX(calc(100% + 1px));
}

.view-group--created::before {
  transform: translateX(calc(200% + 2px));
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

.view-chip,
.create-world-button,
.desk-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: #24483e;
  background: transparent;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 900;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.view-chip {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.view-chip:not(.view-chip--active):hover {
  color: #103b31;
  border-color: rgb(20 115 90 / 34%);
  background: #f7fbf8;
}

.create-world-button,
.desk-action {
  color: #fff;
  background: #103b31;
}

.view-chip--active {
  color: #fff;
}

.create-world-button,
.desk-action {
  min-height: 38px;
  padding-inline: 14px;
  border-radius: 8px;
}

.create-world-button {
  position: relative;
  gap: 8px;
  min-height: 46px;
  margin-left: 10px;
  padding-inline: 13px 18px;
  border-color: rgb(20 115 90 / 54%);
  background: #14735a;
  box-shadow:
    0 8px 18px rgb(16 59 49 / 14%),
    inset 0 0 0 1px rgb(255 255 255 / 12%);
}

.create-world-button::before {
  position: absolute;
  top: 7px;
  bottom: 7px;
  left: -11px;
  width: 1px;
  background: rgb(16 59 49 / 18%);
  content: "";
}

.forge-icon {
  width: 34px;
  height: 32px;
  overflow: visible;
  color: currentcolor;
}

.forge-hammer-position {
  transform: translate(-23px, -8px);
}

.forge-hammer {
  transform-box: view-box;
  transform-origin: 18px 28px;
}

.forge-hammer__body {
  fill: currentcolor;
}

.forge-anvil,
.forge-waist,
.forge-base {
  fill: currentcolor;
}

.forge-spark {
  stroke: currentcolor;
  stroke-width: 3;
  stroke-linecap: round;
  fill: none;
  opacity: 0;
  transform-origin: 63px 40px;
}

.create-world-button:hover,
.desk-action:hover {
  background: #14735a;
}

.create-world-button:hover {
  border-color: rgb(16 59 49 / 62%);
  background: #103b31;
  box-shadow:
    0 10px 22px rgb(16 59 49 / 20%),
    inset 0 0 0 1px rgb(255 255 255 / 14%);
}

.create-world-button:hover .forge-hammer {
  animation: forgeHammerStrike 560ms cubic-bezier(0.38, 0, 0.2, 1) infinite;
}

.create-world-button:hover .forge-spark {
  animation: forgeSpark 560ms ease-out infinite;
}

@keyframes forgeHammerStrike {
  0%,
  100% {
    transform: translate(0, -2px) rotate(-3deg);
  }

  42%,
  56% {
    transform: translate(7px, 8px) rotate(8deg);
  }

  72% {
    transform: translate(-1px, -4px) rotate(-8deg);
  }
}

@keyframes forgeSpark {
  0%,
  35%,
  100% {
    opacity: 0;
    transform: scale(0.8);
  }

  48% {
    opacity: 1;
    transform: scale(1.08);
  }

  68% {
    opacity: 0;
    transform: scale(1.18);
  }
}

.desk-state {
  display: grid;
  gap: 14px;
  min-height: 280px;
  padding: 28px;
  align-content: center;
}

.desk-state h2,
.desk-state p {
  margin: 0;
}

.desk-state h2 {
  font-size: clamp(2rem, 3vw, 3.2rem);
}

.desk-state--error {
  background: rgb(108 36 36 / 6%);
}

.world-desk {
  display: grid;
  gap: 18px;
  padding: 18px;
}

.world-desk__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.world-desk__meta p,
.world-desk__meta span {
  margin: 0;
}

.world-desk__meta p {
  color: var(--color-ink);
  font-weight: 900;
}

.work-world-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  align-items: stretch;
}

.work-world-card {
  --work-world-cover-height: 280px;
  --work-world-reveal-offset: calc((var(--work-world-cover-height) + 18px) * -1);
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  height: 450px;
  padding: 14px;
  border: 1px solid #dde5df;
  border-radius: 8px;
  color: inherit;
  background: #fffdfa;
  overflow: hidden;
  text-decoration: none;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.work-world-card:hover {
  transform: translateY(-2px);
  border-color: #b8ccc2;
  box-shadow: 0 12px 24px rgb(24 33 31 / 8%);
}

.work-world-reveal {
  display: grid;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  transition: transform 230ms ease;
  will-change: transform;
}

.work-world-card:hover .work-world-reveal {
  transform: translateY(var(--work-world-reveal-offset));
}

.work-world-cover {
  position: relative;
  z-index: 3;
  display: grid;
  width: 100%;
  height: var(--work-world-cover-height);
  place-items: center;
  overflow: hidden;
  border: 1px solid #e2e7e3;
  border-radius: 8px;
  color: #103b31;
  background: #edf4f0;
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 900;
}

.work-world-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.work-world-main {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 0;
  min-width: 0;
  min-height: 28px;
  align-content: start;
  overflow: visible;
}

.work-world-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.work-world-title-line h2 {
  overflow: hidden;
  font-size: 1.2rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visibility-chip,
.role-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #305349;
  background: #f5faf7;
  font-size: 0.76rem;
  font-weight: 800;
}

.role-chip {
  color: #504020;
  background: rgb(245 235 200 / 78%);
}

.work-world-main p {
  position: absolute;
  top: 34px;
  left: 0;
  right: 0;
  display: -webkit-box;
  overflow: hidden;
  height: calc(0.9rem * 1.5 * 10);
  margin-top: 0;
  color: var(--color-muted);
  font-size: 0.9rem;
  line-height: 1.5;
  opacity: 0;
  transform: translateY(28px);
  transition:
    opacity 180ms ease 60ms,
    transform 210ms ease 40ms;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 10;
}

.work-world-card:hover .work-world-main p {
  opacity: 1;
  transform: translateY(0);
}

.tag-list {
  position: absolute;
  top: calc(34px + (0.9rem * 1.5 * 10) + 16px);
  left: 0;
  right: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  height: 56px;
  overflow: hidden;
  opacity: 0;
  transform: translateY(34px);
  transition:
    opacity 180ms ease 80ms,
    transform 210ms ease 60ms;
}

.work-world-card:hover .tag-list {
  opacity: 1;
  transform: translateY(0);
}

.tag-list span {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid #dfe7e2;
  border-radius: 999px;
  color: #305349;
  background: #f7faf8;
  font-size: 0.76rem;
  font-weight: 700;
}

.work-world-side {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: end;
  align-self: end;
}

.creator-line {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.creator-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  place-items: center;
  overflow: hidden;
  border: 1px solid #dbe5df;
  border-radius: 50%;
  color: #103b31;
  background: #edf4f0;
  font-size: 0.84rem;
  font-weight: 900;
}

.creator-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.creator-line strong {
  overflow: hidden;
  color: var(--color-ink);
  font-size: 0.88rem;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-metrics {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  grid-column: 1;
  color: var(--color-muted);
  font-size: 0.82rem;
}

.world-metrics span {
  color: var(--color-ink);
  font-weight: 800;
}

.world-metrics small {
  color: #61706b;
  font-size: 0.78rem;
}

.detail-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  grid-column: 2;
  grid-row: 1 / span 2;
  width: 92px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 6px;
  color: #fff;
  background: #14735a;
  font-size: 0.78rem;
  font-weight: 900;
}

.detail-button__icon {
  position: absolute;
  left: 10px;
  width: 16px;
  height: 16px;
  overflow: visible;
  stroke: currentcolor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  opacity: 0;
  transform: translateX(-10px);
  transition:
    opacity 160ms ease,
    transform 180ms ease;
}

.detail-button__text {
  transition: transform 180ms ease;
}

.work-world-card:hover .detail-button {
  background: #103b31;
}

.work-world-card:hover .detail-button__icon {
  opacity: 1;
  transform: translateX(0);
}

.work-world-card:hover .detail-button__text {
  transform: translateX(7px);
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

.desk-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

@media (max-width: 1060px) {
  .my-worlds-command {
    align-items: stretch;
    flex-direction: column;
  }

  .command-toolbar {
    justify-content: start;
    flex-wrap: wrap;
  }

  .search-field {
    flex-basis: min(100%, 520px);
  }

  .work-world-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .work-world-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .my-worlds-page {
    padding-block: 20px 42px;
  }

  .my-worlds-command,
  .desk-state,
  .world-desk {
    padding: 12px;
  }

  .command-toolbar,
  .search-field,
  .search-field input,
  .stat-strip,
  .view-group,
  .create-world-button,
  .work-world-grid {
    width: 100%;
  }

  .stat-strip span,
  .view-chip {
    flex: 1 1 0;
    justify-content: center;
  }

  .create-world-button {
    margin-left: 0;
  }

  .create-world-button::before {
    display: none;
  }

  .work-world-card {
    --work-world-cover-height: 280px;
    height: 450px;
  }

  .work-world-grid {
    grid-template-columns: 1fr;
  }

  .desk-action {
    width: 100%;
  }

  .world-desk__meta {
    display: grid;
  }

  .append-error-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
