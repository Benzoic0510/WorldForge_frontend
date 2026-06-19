<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { listChangeLog } from '@/api/changelog'
import { ApiError } from '@/api/http'
import type { ChangeLogItem } from '@/types/changelog'
import type { PageResponse } from '@/types/world'

const route = useRoute()
const worldId = computed(() => String(route.params.worldId || ''))

const items = ref<ChangeLogItem[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const appendError = ref('')
const page = ref(1)
const totalPages = ref(0)

const canLoadMore = computed(() => page.value < totalPages.value)

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
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

async function fetchChangelog(options: { append?: boolean } = {}) {
  const append = options.append === true

  if (append) {
    loadingMore.value = true
    appendError.value = ''
  } else {
    loading.value = true
    error.value = ''
    appendError.value = ''
  }

  try {
    const data: PageResponse<ChangeLogItem> = await listChangeLog(worldId.value, {
      page: page.value,
      pageSize: 12
    })

    items.value = append ? items.value.concat(data.items) : data.items
    totalPages.value = data.totalPages
    error.value = ''
    appendError.value = ''
    return true
  } catch (e) {
    const message = e instanceof ApiError ? e.message : '更新日志暂时无法加载，请稍后重试。'
    if (append && items.value.length > 0) {
      appendError.value = message
    } else {
      items.value = []
      error.value = message
    }
    return false
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function retry() {
  page.value = 1
  await fetchChangelog()
}

async function loadMore() {
  if (!canLoadMore.value || loadingMore.value) return

  const previousPage = page.value
  page.value += 1
  const loaded = await fetchChangelog({ append: true })
  if (!loaded) {
    page.value = previousPage
  }
}

onMounted(async () => {
  await fetchChangelog()
})
</script>

<template>
  <main class="changelog-page">
    <section v-if="loading" class="changelog-shell page-container">
      <div class="changelog-state">
        <p>正在读取世界更新记录...</p>
      </div>
    </section>

    <section v-else-if="error" class="changelog-shell page-container">
      <div class="changelog-state changelog-state--error">
        <h1>更新记录暂时不可用</h1>
        <p>{{ error }}</p>
        <div class="changelog-state__actions">
          <button type="button" class="changelog-action changelog-action--primary" @click="retry">
            重新加载
          </button>
          <RouterLink class="changelog-action" :to="{ name: 'world-detail', params: { worldId } }">
            返回世界详情
          </RouterLink>
        </div>
      </div>
    </section>

    <section v-else class="changelog-shell page-container">
      <nav class="changelog-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">
          世界详情
        </RouterLink>
        <span>/</span>
        <strong>更新日志</strong>
      </nav>

      <header class="changelog-header">
        <div>
          <p class="eyebrow">Change Log</p>
          <h1>世界更新日志</h1>
        </div>
        <span>{{ items.length }} 条已加载</span>
      </header>

      <div v-if="items.length === 0" class="changelog-state">
        <h2>还没有更新记录</h2>
        <p>当词条或剧情提案发生变化时，这里会留下可阅读的时间线。</p>
      </div>

      <div v-else class="timeline-list">
        <article v-for="item in items" :key="item.changelogId" class="timeline-item">
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

      <div v-if="appendError" class="append-error-row" role="status">
        <span>{{ appendError }}</span>
        <button type="button" @click="loadMore">再试一次</button>
      </div>

      <div v-if="canLoadMore" class="load-more-row">
        <button
          type="button"
          class="changelog-action changelog-action--primary"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? '继续读取中...' : '加载更多更新' }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.changelog-page {
  padding-block: 28px 56px;
}

.changelog-shell {
  display: grid;
  gap: 18px;
}

.changelog-breadcrumb {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
}

.changelog-breadcrumb a {
  color: #305349;
  text-decoration: none;
}

.changelog-breadcrumb strong {
  color: var(--color-ink);
  font-weight: 800;
}

.changelog-state {
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

.changelog-state--error {
  background: rgb(108 36 36 / 6%);
}

.changelog-state h1,
.changelog-state h2 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
}

.changelog-state h1 {
  font-size: clamp(1.8rem, 3vw, 2.6rem);
}

.changelog-state h2 {
  font-size: 1.6rem;
}

.changelog-state p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
}

.changelog-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.changelog-action {
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

.changelog-action--primary {
  color: #fff;
  background: #103b31;
}

.changelog-action:disabled {
  cursor: wait;
  opacity: 0.68;
}

.changelog-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
}

.changelog-header > div {
  flex: 1;
  min-width: 0;
}

.changelog-header h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(1.8rem, 3vw, 2.8rem);
  line-height: 1.12;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.changelog-header > span {
  color: var(--color-muted);
  font-size: 0.88rem;
  font-weight: 800;
  white-space: nowrap;
}

.timeline-list {
  display: grid;
  gap: 0;
  padding: 24px;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 64%), rgb(244 240 231 / 84%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
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

.timeline-item h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 1.45rem;
  line-height: 1.2;
}

.timeline-item p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.75;
}

.timeline-item small {
  color: #446257;
  font-weight: 800;
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
</style>
