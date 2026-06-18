<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError } from '@/api/http'
import { getEntryDetail } from '@/api/entry'
import { getWorldDetail } from '@/api/world'
import type { EntryDetail } from '@/types/entry'
import type { WorldDetail } from '@/types/world'

const route = useRoute()
const router = useRouter()
const entry = ref<EntryDetail | null>(null)
const loading = ref(true)
const errorCode = ref('')
const errorMessage = ref('')
const world = ref<WorldDetail | null>(null)

const worldId = computed(() => String(route.params.worldId || ''))
const entryId = computed(() => String(route.params.entryId || ''))
const canEditEntry = computed(() => world.value?.viewer.canEdit === true)

// ── navigation stack ──
const navigationStack = ref<string[]>([])
const canGoBack = computed(() => navigationStack.value.length > 0)

let internalNavigation = false

function navigateToEntry(targetEntryId: string) {
  internalNavigation = true
  navigationStack.value = [...navigationStack.value, entryId.value]
  router.push({ name: 'entry-detail', params: { worldId: worldId.value, entryId: targetEntryId } })
}

function navigateBack() {
  if (!canGoBack.value) return
  internalNavigation = true
  const prevEntryId = navigationStack.value[navigationStack.value.length - 1]
  navigationStack.value = navigationStack.value.slice(0, -1)
  router.push({ name: 'entry-detail', params: { worldId: worldId.value, entryId: prevEntryId } })
}

// ── [[词条名]] content parsing ──
interface ContentSegment {
  type: 'text' | 'link'
  text: string
  entryId?: string
}

const contentSegments = computed((): ContentSegment[] => {
  if (!entry.value) return []

  const segments: ContentSegment[] = []
  const content = entry.value.content || ''
  const linkedMap = new Map(entry.value.linkedEntries.map(le => [le.title, le.entryId]))
  const regex = /\[\[([^\]]+)\]\]/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    segments.push({
      type: 'link',
      text: match[1],
      entryId: linkedMap.get(match[1])
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }

  return segments
})

const statusTitle = computed(() => {
  if (errorCode.value === 'NOT_FOUND') {
    return '这个词条没有被找到'
  }
  if (errorCode.value === 'FORBIDDEN') {
    return '你当前无法访问这个词条'
  }
  if (errorCode.value === 'UNAUTHORIZED') {
    return '登录后可访问更多内容'
  }
  return '词条暂时无法加载'
})

async function loadEntry() {
  loading.value = true
  errorCode.value = ''
  errorMessage.value = ''

  try {
    entry.value = await getEntryDetail(worldId.value, entryId.value)
    try {
      world.value = await getWorldDetail(worldId.value)
    } catch {
      world.value = null
    }
  } catch (error) {
    entry.value = null
    world.value = null

    if (error instanceof ApiError) {
      errorCode.value = error.code
      errorMessage.value = error.message
    } else {
      errorMessage.value = '请稍后再试。'
    }
  } finally {
    loading.value = false
    if (!internalNavigation) {
      navigationStack.value = []
    }
    internalNavigation = false
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

onMounted(async () => {
  await loadEntry()
})

watch(
  () => [route.params.worldId, route.params.entryId],
  async () => {
    await loadEntry()
  }
)
</script>

<template>
  <main class="entry-detail-page">
    <section v-if="loading" class="entry-shell page-container">
      <div class="entry-state">
        <p>正在翻阅词条档案...</p>
      </div>
    </section>

    <section v-else-if="!entry" class="entry-shell page-container">
      <div class="entry-state entry-state--error">
        <h1>{{ statusTitle }}</h1>
        <p>{{ errorMessage || '请稍后再试。' }}</p>
        <div class="state-actions">
          <button type="button" class="state-button state-button--primary" @click="loadEntry">
            重新加载
          </button>
          <RouterLink
            class="state-button"
            :to="{ name: 'world-detail', params: { worldId } }"
          >
            返回世界详情
          </RouterLink>
        </div>
      </div>
    </section>

    <section v-else class="entry-shell page-container">
      <nav class="entry-breadcrumb" aria-label="页面路径">
        <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
        <span>/</span>
        <RouterLink :to="{ name: 'world-detail', params: { worldId } }">世界详情</RouterLink>
        <span>/</span>
        <strong>{{ entry.title }}</strong>
      </nav>

      <header class="entry-header">
        <div>
          <p class="eyebrow">Entry Record</p>
          <h1>{{ entry.title }}</h1>
          <p class="entry-meta">
            由 {{ entry.author.nickname }} 记录，最近更新于 {{ formatDate(entry.updatedAt) }}
          </p>
        </div>

        <div class="entry-header__actions">
          <div v-if="canGoBack" class="entry-back-row">
            <button type="button" class="back-button" @click="navigateBack">
              &larr; 返回上一个词条
            </button>
          </div>
          <RouterLink
            v-if="canEditEntry"
            class="entry-edit-link"
            :to="{ name: 'entry-edit', params: { worldId, entryId } }"
          >
            编辑词条
          </RouterLink>
          <div class="tag-list" aria-label="标签">
            <span v-for="tag in entry.tags" :key="tag">{{ tag }}</span>
          </div>
        </div>
      </header>

      <section class="entry-layout">
        <article class="entry-content">
          <p v-if="!entry.content || contentSegments.length === 0">这个词条还没有正文内容。</p>
          <p v-else class="entry-content-text">
            <template v-for="(seg, idx) in contentSegments" :key="idx">
              <a
                v-if="seg.type === 'link' && seg.entryId"
                class="content-link"
                href="#"
                @click.prevent="navigateToEntry(seg.entryId!)"
              >[[{{ seg.text }}]]</a>
              <span v-else>{{ seg.text }}</span>
            </template>
          </p>
        </article>

        <aside class="entry-side">
          <section class="side-panel">
            <p class="eyebrow">Timeline</p>
            <dl class="meta-list">
              <div>
                <dt>创建时间</dt>
                <dd>{{ formatDate(entry.createdAt) }}</dd>
              </div>
              <div>
                <dt>最近更新</dt>
                <dd>{{ formatDate(entry.updatedAt) }}</dd>
              </div>
              <div>
                <dt>当前版本</dt>
                <dd>{{ entry.currentRevisionId }}</dd>
              </div>
            </dl>
          </section>

          <section class="side-panel">
            <p class="eyebrow">Linked Entries</p>
            <div v-if="entry.linkedEntries.length > 0" class="linked-list">
              <a
                v-for="linkedEntry in entry.linkedEntries"
                :key="linkedEntry.entryId"
                class="linked-entry"
                href="#"
                @click.prevent="navigateToEntry(linkedEntry.entryId)"
              >{{ linkedEntry.title }}</a>
            </div>
            <p v-else class="muted-copy">暂无关联词条。</p>
          </section>
        </aside>
      </section>

      <section class="revision-panel">
        <div class="panel-heading">
          <p class="eyebrow">Revisions</p>
          <h2>版本记录</h2>
        </div>

        <div v-if="entry.revisions.length > 0" class="revision-list">
          <article
            v-for="revision in entry.revisions"
            :key="revision.revisionId"
            class="revision-card"
            :class="{ 'revision-card--current': revision.current }"
          >
            <div>
              <strong>{{ revision.current ? '当前版本' : '历史版本' }}</strong>
              <span>{{ formatDate(revision.createdAt) }}</span>
            </div>
            <p>{{ revision.author.nickname }}</p>
          </article>
        </div>
        <p v-else class="muted-copy">暂无版本记录。</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.entry-detail-page {
  padding-block: 28px 56px;
}

.entry-shell {
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
.entry-header,
.entry-content,
.side-panel,
.revision-panel {
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 66%), rgb(244 240 231 / 86%)),
    rgb(255 255 255 / 56%);
  box-shadow: var(--shadow-panel);
}

.entry-state {
  display: grid;
  gap: 16px;
  min-height: 320px;
  padding: 32px;
  align-content: center;
}

.entry-state--error {
  background: rgb(108 36 36 / 6%);
}

.entry-state h1,
.entry-state p,
.entry-header h1,
.entry-header p,
.entry-content p,
.entry-content-text,
.muted-copy,
.revision-card p {
  margin: 0;
}

.entry-state h1,
.entry-header h1,
.panel-heading h2 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

.entry-state h1 {
  font-size: clamp(2rem, 3vw, 3rem);
}

.entry-state p,
.entry-meta,
.muted-copy {
  color: var(--color-muted);
  line-height: 1.75;
}

.state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.state-button {
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
}

.state-button--primary {
  color: #fff;
  background: #103b31;
  cursor: pointer;
}

.entry-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: end;
  padding: 28px;
}

.entry-header__actions {
  display: grid;
  gap: 12px;
  justify-items: end;
}

.entry-edit-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  font-weight: 900;
  text-decoration: none;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.entry-header h1 {
  font-size: clamp(2.35rem, 4vw, 4.6rem);
  line-height: 1.02;
}

.entry-meta {
  margin-top: 14px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
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

.entry-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.38fr);
  gap: 18px;
  align-items: start;
}

.entry-content {
  min-height: 420px;
  padding: 30px;
}

.entry-content-text {
  color: var(--color-ink);
  font-size: 1.04rem;
  line-height: 2;
  white-space: pre-wrap;
}

.entry-back-row {
  margin-bottom: 4px;
}

.back-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: #305349;
  background: rgb(232 241 237 / 62%);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.back-button:hover {
  border-color: var(--color-accent);
  background: rgb(232 241 237 / 88%);
}

.content-link {
  color: #14735a;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.content-link:hover {
  color: #0f5c48;
}

.entry-side {
  display: grid;
  gap: 18px;
}

.side-panel,
.revision-panel {
  padding: 22px;
}

.meta-list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.meta-list div {
  display: grid;
  gap: 6px;
}

.meta-list dt {
  color: var(--color-muted);
  font-size: 0.82rem;
  font-weight: 800;
  text-transform: uppercase;
}

.meta-list dd {
  min-width: 0;
  margin: 0;
  color: var(--color-ink);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.linked-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.linked-entry {
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
  text-decoration: none;
}

.linked-entry:hover {
  border-color: var(--color-accent);
  background: rgb(232 241 237 / 88%);
}

.revision-list {
  display: grid;
  gap: 10px;
}

.revision-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: rgb(255 255 255 / 52%);
  text-decoration: none;
}

.revision-card strong {
  color: var(--color-ink);
}

.revision-card span,
.revision-card p {
  color: var(--color-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.panel-heading {
  margin-bottom: 18px;
}

.panel-heading h2,
.panel-heading p {
  margin: 0;
}

.revision-card--current {
  border-color: rgb(20 115 90 / 38%);
  background: rgb(232 241 237 / 72%);
}

@media (max-width: 900px) {
  .entry-header,
  .entry-layout {
    grid-template-columns: 1fr;
  }

  .tag-list {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .entry-detail-page {
    padding-block: 18px 40px;
  }

  .entry-state,
  .entry-header,
  .entry-content,
  .side-panel,
  .revision-panel {
    padding: 18px;
  }
}
</style>
