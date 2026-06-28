<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { getWorldDetail, listWorlds } from '@/api/world'
import { ApiError } from '@/api/http'
import hotIconUrl from '@/svgs/hot_fill.svg'
import filterIconUrl from '@/svgs/search_list.svg'
import timeIconUrl from '@/svgs/time_fill.svg'
import type { PageResponse, WorldListItem, WorldSortBy } from '@/types/world'

const route = useRoute()
const router = useRouter()
const worlds = ref<WorldListItem[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const keywordInput = ref('')
const keyword = ref('')
const sortBy = ref<WorldSortBy>('')
const filterPanelOpen = ref(false)
const selectedTag = ref('')
const updatedWithin = ref<'all' | '7d' | '30d'>('all')

const isEmpty = computed(() => !loading.value && !errorMessage.value && worlds.value.length === 0)
const canLoadMore = computed(() => page.value < totalPages.value)
const availableTags = computed(() => {
  const tags = new Set<string>()

  for (const world of worlds.value) {
    for (const tag of world.tags) {
      if (tag) {
        tags.add(tag)
      }
    }
  }

  return Array.from(tags).sort((left, right) => left.localeCompare(right, 'zh-CN'))
})
const filteredWorlds = computed(() => {
  return worlds.value.filter((world) => {
    const matchesTag = !selectedTag.value || world.tags.includes(selectedTag.value)
    const matchesTime = matchesUpdatedWindow(world.updatedAt, updatedWithin.value)
    return matchesTag && matchesTime
  })
})
const resultSummary = computed(() => {
  if (keyword.value) {
    return `“${keyword.value}” 共匹配到 ${total.value} 个世界`
  }

  return `共收录 ${total.value} 个世界`
})
const hasActiveFilters = computed(() => Boolean(selectedTag.value) || updatedWithin.value !== 'all')
const visibleSummary = computed(() => {
  if (filteredWorlds.value.length === total.value) {
    return `${total.value} 个可见世界`
  }
  return `当前显示 ${filteredWorlds.value.length} / ${total.value}`
})

function matchesUpdatedWindow(updatedAt: string, windowType: 'all' | '7d' | '30d') {
  if (windowType === 'all') {
    return true
  }

  const updatedTime = new Date(updatedAt).getTime()
  const now = Date.now()
  const days = windowType === '7d' ? 7 : 30
  return Number.isFinite(updatedTime) && updatedTime >= now - days * 24 * 60 * 60 * 1000
}

async function fetchWorlds(options: { append?: boolean } = {}) {
  const append = options.append === true

  if (append) {
    loadingMore.value = true
  } else {
    loading.value = true
    errorMessage.value = ''
  }

  try {
    const data: PageResponse<WorldListItem> = await listWorlds({
      keyword: keyword.value || undefined,
      sortBy: sortBy.value || undefined,
      page: page.value,
      pageSize: 12
    })

    const hydratedItems = await hydrateWorldListItems(data.items)
    worlds.value = append ? worlds.value.concat(hydratedItems) : hydratedItems
    total.value = data.total
    totalPages.value = data.totalPages
  } catch (error) {
    if (error instanceof ApiError) {
      errorMessage.value = error.message
    } else {
      errorMessage.value = '世界列表暂时无法加载，请稍后重试。'
    }
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
    name: 'discover',
    query: keyword.value ? { q: keyword.value } : {}
  })
  await fetchWorlds()
}

async function handleSortChange(nextSort: WorldSortBy) {
  if (sortBy.value === nextSort) {
    return
  }

  sortBy.value = nextSort
  page.value = 1
  await fetchWorlds()
}

async function handleLoadMore() {
  if (!canLoadMore.value || loadingMore.value) {
    return
  }

  page.value += 1
  await fetchWorlds({ append: true })
}

async function retry() {
  page.value = 1
  await fetchWorlds()
}

function clearAdvancedFilters() {
  selectedTag.value = ''
  updatedWithin.value = 'all'
}

function formatDate(value: string) {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

function visibilityLabel(visibility: WorldListItem['visibility']) {
  if (visibility === 'public') return '公开'
  if (visibility === 'protected') return '保护'
  return '私有'
}

watch(keywordInput, async (value, oldValue) => {
  if (value === '' && oldValue !== '' && keyword.value !== '') {
    keyword.value = ''
    page.value = 1
    await router.replace({ name: 'discover' })
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
  <main class="discover-page">
    <section class="discover-shell page-container">
      <header class="discover-command">
        <div class="command-title">
          <h1>发现世界</h1>
          <span>{{ visibleSummary }}</span>
        </div>

        <form class="command-toolbar" @submit.prevent="handleSearchSubmit">
          <label class="search-field">
            <input
              v-model="keywordInput"
              type="search"
              name="keyword"
              placeholder="搜索世界名称"
              aria-label="搜索世界名称"
            />
            <button class="search-icon-button" type="submit" aria-label="搜索">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4.2 4.2" />
              </svg>
            </button>
          </label>

          <div
            class="sort-group"
            :class="{ 'sort-group--hot': sortBy === 'hot' }"
            role="group"
            aria-label="排序方式"
          >
            <button
              type="button"
              class="sort-chip"
              :class="{ 'sort-chip--active': sortBy === '' }"
              @click="handleSortChange('')"
            >
              <img
                class="toolbar-button-icon"
                :src="timeIconUrl"
                alt=""
                aria-hidden="true"
              />
              <span class="toolbar-button-label">最新</span>
            </button>
            <button
              type="button"
              class="sort-chip"
              :class="{ 'sort-chip--active': sortBy === 'hot' }"
              @click="handleSortChange('hot')"
            >
              <img
                class="toolbar-button-icon"
                :src="hotIconUrl"
                alt=""
                aria-hidden="true"
              />
              <span class="toolbar-button-label">最热</span>
            </button>
          </div>

          <div class="advanced-filter">
            <button
              type="button"
              class="filter-trigger"
              :class="{ 'filter-trigger--active': filterPanelOpen || hasActiveFilters }"
              @click="filterPanelOpen = !filterPanelOpen"
            >
              <img
                class="toolbar-button-icon"
                :src="filterIconUrl"
                alt=""
                aria-hidden="true"
              />
              <span class="toolbar-button-label">筛选</span>
            </button>

            <div v-if="filterPanelOpen" class="filter-panel">
              <div class="filter-panel__header">
                <strong>高级筛选</strong>
                <button type="button" class="filter-close" @click="filterPanelOpen = false">
                  收起
                </button>
              </div>

              <div class="filter-block">
                <span>更新时间</span>
                <div class="filter-options">
                  <button
                    type="button"
                    class="filter-option"
                    :class="{ 'filter-option--active': updatedWithin === 'all' }"
                    @click="updatedWithin = 'all'"
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    class="filter-option"
                    :class="{ 'filter-option--active': updatedWithin === '7d' }"
                    @click="updatedWithin = '7d'"
                  >
                    近 7 天
                  </button>
                  <button
                    type="button"
                    class="filter-option"
                    :class="{ 'filter-option--active': updatedWithin === '30d' }"
                    @click="updatedWithin = '30d'"
                  >
                    近 30 天
                  </button>
                </div>
              </div>

              <div class="filter-block">
                <span>标签</span>
                <div class="filter-options">
                  <button
                    type="button"
                    class="filter-option"
                    :class="{ 'filter-option--active': selectedTag === '' }"
                    @click="selectedTag = ''"
                  >
                    全部
                  </button>
                  <button
                    v-for="tag in availableTags"
                    :key="tag"
                    type="button"
                    class="filter-option"
                    :class="{ 'filter-option--active': selectedTag === tag }"
                    @click="selectedTag = tag"
                  >
                    {{ tag }}
                  </button>
                </div>
              </div>

              <button type="button" class="filter-reset" @click="clearAdvancedFilters">
                清空筛选
              </button>
            </div>
          </div>
        </form>
      </header>

      <section v-if="loading" class="state-panel" aria-live="polite">
        <p>正在加载世界列表...</p>
      </section>

      <section v-else-if="errorMessage" class="state-panel state-panel--error">
        <h2>列表暂时不可用</h2>
        <p>{{ errorMessage }}</p>
        <button type="button" class="panel-action" @click="retry">重新加载</button>
      </section>

      <section v-else-if="isEmpty" class="state-panel">
        <h2>还没有可展示的世界</h2>
        <p>当前公开世界列表为空。</p>
      </section>

      <section v-else class="discover-results" aria-live="polite">
        <div class="results-meta">
          <span>{{ resultSummary }}</span>
          <span v-if="hasActiveFilters">已启用本地筛选</span>
        </div>

        <div class="world-list">
          <RouterLink
            v-for="world in filteredWorlds"
            :key="world.worldId"
            class="world-card"
            :to="{ name: 'world-detail', params: { worldId: world.worldId } }"
          >
            <div class="world-reveal">
              <div class="world-cover" aria-hidden="true">
                <img v-if="world.coverImageUrl" :src="world.coverImageUrl" alt="" />
                <span v-else>{{ world.name.charAt(0) }}</span>
              </div>

              <div class="world-main">
                <div class="world-title-line">
                  <h2>{{ world.name }}</h2>
                  <span class="visibility-chip">{{ visibilityLabel(world.visibility) }}</span>
                </div>
                <p>{{ world.description || '暂无简介。' }}</p>
                <div class="tag-list" aria-label="标签">
                  <span v-for="tag in world.tags.slice(0, 4)" :key="tag">{{ tag }}</span>
                  <span v-if="world.tags.length > 4">+{{ world.tags.length - 4 }}</span>
                </div>
              </div>
            </div>

            <div class="world-side">
              <div class="creator-line">
                <span class="creator-avatar" aria-hidden="true">
                  <img v-if="world.creator.avatarUrl" :src="world.creator.avatarUrl" alt="" />
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

        <div v-if="filteredWorlds.length === 0" class="inline-empty">
          <h2>当前筛选下没有匹配结果</h2>
          <p>换个标签或时间范围，或者清空筛选后再看看。</p>
        </div>

        <div v-if="canLoadMore" class="load-more-row">
          <button
            type="button"
            class="panel-action"
            :disabled="loadingMore"
            @click="handleLoadMore"
          >
            {{ loadingMore ? '继续整理中…' : '加载更多' }}
          </button>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.discover-page {
  padding-block: 18px 48px;
}

.discover-shell {
  display: grid;
  gap: 14px;
}

.discover-command {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 8px;
  background: rgb(255 255 255 / 54%);
}

h1,
h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

h1 {
  font-size: 1.55rem;
  line-height: 1;
}

.command-title {
  display: grid;
  gap: 6px;
}

.command-title span,
.results-meta {
  color: var(--color-muted);
  font-size: 0.86rem;
}

.command-toolbar {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  align-items: center;
  justify-content: end;
}

.search-field {
  position: relative;
  display: block;
  flex: 1 1 430px;
  min-width: 280px;
  max-width: 560px;
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

.sort-group {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 184px;
  padding: 2px;
  overflow: hidden;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 999px;
  background: rgb(255 255 255 / 50%);
}

.sort-group::before {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  z-index: 0;
  width: calc(50% - 2px);
  border-radius: 999px;
  background: #103b31;
  box-shadow: 0 4px 10px rgb(16 59 49 / 8%);
  content: "";
  transition: transform 220ms cubic-bezier(0.34, 1, 0.64, 1);
}

.sort-group--hot::before {
  transform: translateX(100%);
}

.advanced-filter {
  position: relative;
}

.sort-chip,
.filter-trigger,
.filter-option,
.filter-close,
.filter-reset,
.panel-action {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: rgb(255 255 255 / 62%);
  color: var(--color-ink);
  font-size: 0.9rem;
  font-weight: 800;
  cursor: pointer;
}

.sort-chip,
.filter-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 34px;
  padding: 0 18px;
  border-color: transparent;
  border-radius: 999px;
  color: #24483e;
  background: transparent;
  box-shadow: none;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.sort-chip {
  position: relative;
  z-index: 1;
  min-width: 0;
  width: 100%;
}

.sort-chip + .sort-chip::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: -1px;
  width: 1px;
  background: rgb(16 59 49 / 10%);
  content: "";
}

.sort-chip--active + .sort-chip::before,
.sort-chip:has(+ .sort-chip--active)::before,
.sort-chip--active::before {
  opacity: 0;
}

.filter-trigger {
  min-width: 68px;
  border-color: rgb(16 59 49 / 12%);
  background: rgb(255 255 255 / 56%);
}

.sort-chip:not(.sort-chip--active):hover,
.filter-trigger:not(.filter-trigger--active):hover {
  color: #103b31;
  border-color: rgb(20 115 90 / 34%);
  background: #f7fbf8;
}

.toolbar-button-icon {
  display: block;
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  opacity: 0.78;
  object-fit: contain;
  transition:
    filter 160ms ease,
    opacity 160ms ease;
}

.toolbar-button-label {
  font-size: 0.72rem;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

.filter-trigger--active,
.filter-option--active,
.panel-action {
  color: #fff;
  background: #103b31;
}

.filter-close,
.filter-reset {
  color: var(--color-ink);
  background: rgb(255 255 255 / 66%);
}

.filter-trigger--active {
  border-color: #103b31;
  box-shadow: 0 4px 10px rgb(16 59 49 / 8%);
}

.sort-chip--active {
  color: #fff;
}

.sort-chip--active .toolbar-button-icon,
.filter-trigger--active .toolbar-button-icon {
  filter: brightness(0) invert(1);
  opacity: 1;
}

.filter-panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 6;
  display: grid;
  gap: 12px;
  width: min(380px, calc(100vw - 48px));
  padding: 14px;
  border: 1px solid rgb(16 59 49 / 14%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 92%), rgb(245 240 229 / 96%)),
    #f6f2e8;
  box-shadow: 0 22px 50px rgb(24 33 31 / 14%);
}

.filter-panel__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.filter-panel__header strong {
  color: var(--color-ink);
  font-size: 0.96rem;
  font-weight: 900;
}

.filter-block {
  display: grid;
  gap: 8px;
}

.filter-block > span {
  color: var(--color-muted);
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
}

.filter-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.state-panel {
  display: grid;
  gap: 12px;
  min-height: 180px;
  padding: 22px;
  align-content: center;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 44%);
}

.state-panel--error {
  background: rgb(108 36 36 / 6%);
}

.state-panel h2,
.state-panel p,
.world-card p {
  margin: 0;
}

.discover-results {
  display: grid;
  gap: 10px;
}

.results-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding-inline: 2px;
}

.inline-empty {
  display: grid;
  gap: 8px;
  padding: 22px;
  border: 1px dashed var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-muted);
  background: rgb(255 255 255 / 36%);
}

.inline-empty h2,
.inline-empty p {
  margin: 0;
}

.world-list {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  padding-top: 0;
}

.world-card {
  --world-cover-height: 300px;
  --world-reveal-offset: calc((var(--world-cover-height) + 18px) * -1);
  position: relative;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  height: 460px;
  padding: 14px;
  border: 1px solid #dde5df;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  background: #fffdfa;
  overflow: hidden;
  transition:
    transform 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.world-card:hover {
  transform: translateY(-2px);
  border-color: #b8ccc2;
  box-shadow: 0 12px 24px rgb(24 33 31 / 8%);
}

.world-reveal {
  display: grid;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  transition: transform 230ms ease;
  will-change: transform;
}

.world-card:hover .world-reveal {
  transform: translateY(var(--world-reveal-offset));
}

.world-cover {
  position: relative;
  z-index: 3;
  display: grid;
  width: 100%;
  height: var(--world-cover-height);
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

.world-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.world-main {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 0;
  min-width: 0;
  min-height: 28px;
  align-content: start;
  overflow: visible;
}

.world-title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.world-title-line h2 {
  overflow: hidden;
  font-size: 1.2rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-main p {
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 10;
}

.world-card:hover .world-main p {
  opacity: 1;
  transform: translateY(0);
}

.visibility-chip {
  flex: 0 0 auto;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  color: #305349;
  background: #f5faf7;
  font-size: 0.76rem;
  font-weight: 800;
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

.world-card:hover .tag-list {
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

.world-side {
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
  font-size: 0.86rem;
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

.world-card:hover .detail-button {
  background: #103b31;
}

.world-card:hover .detail-button__icon {
  opacity: 1;
  transform: translateX(0);
}

.world-card:hover .detail-button__text {
  transform: translateX(7px);
}

.load-more-row {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

@media (max-width: 1080px) {
  .discover-command {
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

  .world-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .search-field {
    max-width: none;
  }

  .world-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .discover-page {
    padding-block: 14px 36px;
  }

  .discover-command,
  .state-panel {
    padding: 12px;
  }

  .command-toolbar,
  .sort-group {
    width: 100%;
  }

  .sort-chip {
    width: 100%;
  }

  .sort-group {
    width: min(100%, 184px);
  }

  .search-field,
  .search-field input,
  .advanced-filter,
  .filter-trigger {
    width: 100%;
  }

  .search-field {
    min-width: 0;
  }

  .world-list {
    grid-template-columns: 1fr;
  }

  .world-card {
    --world-cover-height: 260px;
    height: 420px;
  }

  .world-card:hover .world-reveal {
    transform: translateY(var(--world-reveal-offset));
  }

  .filter-panel {
    left: 0;
    right: auto;
    width: min(100%, calc(100vw - 40px));
  }
}
</style>
