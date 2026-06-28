<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { listEntries } from '@/api/entry'
import { ApiError } from '@/api/http'
import { getWorldDetail } from '@/api/world'
import type { EntryListItem } from '@/types/entry'
import type { PageResponse, WorldDetail } from '@/types/world'

const route = useRoute()
const world = ref<WorldDetail | null>(null)
const entries = ref<EntryListItem[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const errorCode = ref('')
const errorMessage = ref('')
const page = ref(1)
const totalPages = ref(0)
const appendError = ref('')
const keywordInput = ref('')
const keyword = ref('')

const worldId = computed(() => String(route.params.worldId || ''))
const canEditWorld = computed(() => world.value?.viewer.canEdit === true)
const canLoadMore = computed(() => page.value < totalPages.value)
const hasSearchKeyword = computed(() => keyword.value.length > 0)

function formatRole(role: string | null | undefined): string {
  if (role === 'creator') return '创建者'
  if (role === 'co_admin') return '共同管理员'
  if (role === 'contributor') return '协作者'
  return ''
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
  return '词条列表暂时无法加载'
})

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

async function fetchEntries(options: { append?: boolean } = {}) {
  const append = options.append === true

  if (append) {
    loadingMore.value = true
    appendError.value = ''
  } else {
    loading.value = true
    errorCode.value = ''
    errorMessage.value = ''
    appendError.value = ''
  }

  try {
    if (!append) {
      world.value = await getWorldDetail(worldId.value)
    }

    const data: PageResponse<EntryListItem> = await listEntries(worldId.value, {
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: 12
    })

    entries.value = append ? entries.value.concat(data.items) : data.items
    totalPages.value = data.totalPages
    return true
  } catch (error) {
    const message = getErrorMessage(error, '词条列表暂时无法加载，请稍后重试。')

    if (append && entries.value.length > 0) {
      appendError.value = message
    } else {
      entries.value = []
      world.value = null
      if (error instanceof ApiError) {
        errorCode.value = error.code
      }
      errorMessage.value = message
    }
    return false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function reloadEntries() {
  page.value = 1
  await fetchEntries()
}

async function submitSearch() {
  keyword.value = keywordInput.value.trim()
  await reloadEntries()
}

async function clearSearch() {
  keywordInput.value = ''
  keyword.value = ''
  await reloadEntries()
}

async function loadMoreEntries() {
  if (!canLoadMore.value || loadingMore.value) {
    return
  }

  const previousPage = page.value
  page.value += 1
  const loaded = await fetchEntries({ append: true })
  if (!loaded) {
    page.value = previousPage
  }
}

onMounted(async () => {
  await reloadEntries()
})

watch(
  () => route.params.worldId,
  async () => {
    keywordInput.value = ''
    keyword.value = ''
    await reloadEntries()
  }
)
</script>

<template>
  <main class="entry-list-page">
    <section v-if="loading" class="entry-list-shell page-container">
      <div class="entry-state">
        <p>正在整理词条目录...</p>
      </div>
    </section>

    <section v-else-if="!world" class="entry-list-shell page-container">
      <div class="entry-state entry-state--error">
        <h1>{{ statusTitle }}</h1>
        <p>{{ errorMessage || '请稍后再试。' }}</p>
        <div class="state-actions">
          <button type="button" class="state-button state-button--primary" @click="reloadEntries">
            重新加载
          </button>
          <RouterLink class="state-button" :to="{ name: 'discover' }">返回发现页</RouterLink>
        </div>
      </div>
    </section>

    <section v-else class="entry-list-shell page-container">
      <nav class="entry-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">{{ world.name }}</RouterLink>
        <span>/</span>
        <strong>词条列表</strong>
      </nav>

      <header class="entry-list-header">
        <div>
          <p class="eyebrow">{{ canEditWorld ? 'Entry Management' : 'Entry Index' }}</p>
          <h1>{{ canEditWorld ? '管理世界词条' : '浏览世界词条' }}</h1>
          <span v-if="world?.viewer.role" class="role-badge">你的权限：{{ formatRole(world.viewer.role) }}</span>
        </div>
        <div class="header-actions">
          <span>{{ hasSearchKeyword ? `匹配 ${entries.length} 条` : `${entries.length} 条已加载` }}</span>
          <RouterLink
            v-if="canEditWorld"
            class="header-button"
            :to="{ name: 'world-studio', params: { worldId }, query: { view: 'entries' } }"
          >
            新建词条
          </RouterLink>
        </div>
      </header>

      <form class="entry-search" role="search" @submit.prevent="submitSearch">
        <label class="search-field">
          <span>搜索词条</span>
          <input
            v-model="keywordInput"
            maxlength="100"
            name="keyword"
            placeholder="输入标题、正文或标签"
            type="search"
          >
        </label>
        <div class="search-actions">
          <button class="search-button search-button--primary" type="submit">搜索</button>
          <button
            class="search-button"
            type="button"
            :disabled="!hasSearchKeyword && !keywordInput"
            @click="clearSearch"
          >
            清空
          </button>
        </div>
      </form>

      <section v-if="entries.length === 0" class="entry-state entry-state--empty">
        <h2>{{ hasSearchKeyword ? '没有匹配词条' : '还没有词条' }}</h2>
        <p>
          {{
            hasSearchKeyword
              ? `没有找到包含“${keyword}”的词条，可以换一个关键词再试。`
              : canEditWorld
              ? '这个世界还没有设定词条，可以先创建第一条核心档案。'
              : '这个世界还没有公开可阅读的设定词条。'
          }}
        </p>
        <RouterLink
          v-if="canEditWorld && !hasSearchKeyword"
          class="state-button state-button--primary"
          :to="{ name: 'world-studio', params: { worldId }, query: { view: 'entries' } }"
        >
          新建词条
        </RouterLink>
      </section>

      <section v-else class="entry-grid" aria-label="词条列表">
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
            <strong>{{ canEditWorld ? '打开档案' : '查看词条' }}</strong>
          </div>
          <h2>{{ entry.title }}</h2>
          <p>{{ entry.summary || '暂无摘要。' }}</p>
          <div class="tag-list tag-list--compact" aria-label="标签">
            <span v-for="tag in entry.tags" :key="tag">{{ tag }}</span>
          </div>
        </RouterLink>
      </section>

      <div v-if="appendError" class="append-error-row" role="status">
        <span>{{ appendError }}</span>
        <button type="button" @click="loadMoreEntries">再试一次</button>
      </div>

      <div v-if="canLoadMore" class="load-more-row">
        <button
          type="button"
          class="state-button state-button--primary"
          :disabled="loadingMore"
          @click="loadMoreEntries"
        >
          {{ loadingMore ? '继续整理中...' : '加载更多词条' }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.entry-list-page {
  padding-block: 28px 56px;
}

.entry-list-shell {
  display: grid;
  gap: 18px;
}

.entry-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.entry-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.entry-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.entry-state,
.entry-list-header,
.entry-search,
.entry-card {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 68%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.entry-state {
  display: grid;
  gap: 16px;
  min-height: 280px;
  padding: 32px;
  align-content: center;
}

.entry-state--error {
  background: rgb(108 36 36 / 6%);
}

.entry-state--empty {
  min-height: 240px;
  border-style: dashed;
  box-shadow: none;
}

.entry-state h1,
.entry-state h2,
.entry-state p,
.entry-list-header h1,
.entry-card h2,
.entry-card p {
  margin: 0;
}

.entry-state h1,
.entry-state h2,
.entry-list-header h1,
.entry-card h2 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.entry-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.entry-state h2 {
  font-size: clamp(1.8rem, 2.5vw, 2.6rem);
}

.entry-state p,
.entry-card p {
  color: var(--color-muted);
  line-height: 1.75;
}

.entry-card p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.state-actions,
.load-more-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.load-more-row {
  justify-content: center;
}

.state-button,
.header-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  color: var(--color-ink);
  background: rgb(255 255 255 / 65%);
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.state-button--primary,
.header-button {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.state-button:disabled {
  cursor: wait;
  opacity: 0.68;
}

.entry-list-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
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

.entry-list-header h1 {
  font-size: clamp(2.2rem, 4vw, 4.2rem);
  line-height: 1.03;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
}

.header-actions span {
  color: var(--color-muted);
  font-size: 0.88rem;
  font-weight: 800;
}

.entry-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
  padding: 16px;
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

.search-button {
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

.search-button--primary {
  border-color: #103b31;
  color: #fff;
  background: #103b31;
}

.search-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

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
  font-size: 1.45rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
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

@media (max-width: 1040px) {
  .entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .entry-list-page {
    padding-block: 18px 40px;
  }

  .entry-state,
  .entry-list-header,
  .entry-search,
  .entry-card {
    padding: 18px;
  }

  .entry-list-header,
  .entry-search,
  .entry-grid {
    grid-template-columns: 1fr;
  }

  .header-actions {
    justify-content: stretch;
  }

  .header-button,
  .state-button,
  .search-button {
    width: 100%;
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
</style>
