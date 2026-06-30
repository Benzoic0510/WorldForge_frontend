<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

type EntryColumnItem = {
  entryId: string
  worldId: string
  title: string
  summary?: string
  contentPreview?: string
  tags: string[]
  updatedAt: string
}

const props = withDefaults(defineProps<{
  entries: EntryColumnItem[]
  singleExpanded?: boolean
  collapseOnOutsideClick?: boolean
  scrollOnExpand?: boolean
}>(), {
  singleExpanded: false,
  collapseOnOutsideClick: false,
  scrollOnExpand: false
})

const router = useRouter()
const listRef = ref<HTMLElement | null>(null)
const expandedEntryIds = ref<Set<string>>(new Set())
const entryElements = new Map<string, HTMLElement>()
let scrollFrame = 0

function getEntryBody(entry: EntryColumnItem): string {
  return entry.contentPreview || entry.summary || '暂无摘要。'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function isExpanded(entryId: string): boolean {
  return expandedEntryIds.value.has(entryId)
}

async function openEntry(entry: EntryColumnItem) {
  await router.push({
    name: 'entry-detail',
    params: { worldId: entry.worldId, entryId: entry.entryId }
  })
}

function setExpandedEntry(entryId: string) {
  expandedEntryIds.value = props.singleExpanded
    ? new Set([entryId])
    : new Set(expandedEntryIds.value).add(entryId)
}

async function scrollEntryIntoView(entryId: string) {
  if (!props.scrollOnExpand) return
  await nextTick()
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
  }
  scrollFrame = requestAnimationFrame(() => {
    const element = entryElements.get(entryId)
    if (!element) return
    const rect = element.getBoundingClientRect()
    const targetTop = window.scrollY + rect.top - Math.max(72, window.innerHeight * 0.16)
    window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    scrollFrame = 0
  })
}

async function handleEntryClick(entry: EntryColumnItem) {
  if (isExpanded(entry.entryId)) {
    await openEntry(entry)
    return
  }

  setExpandedEntry(entry.entryId)
  await scrollEntryIntoView(entry.entryId)
}

async function handleEntryKeydown(event: KeyboardEvent, entry: EntryColumnItem) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  await handleEntryClick(entry)
}

function setEntryElement(entryId: string, element: Element | null) {
  if (element instanceof HTMLElement) {
    entryElements.set(entryId, element)
  } else {
    entryElements.delete(entryId)
  }
}

function handleDocumentClick(event: MouseEvent) {
  if (!props.collapseOnOutsideClick || expandedEntryIds.value.size === 0) return
  const target = event.target
  if (!(target instanceof Node) || listRef.value?.contains(target)) return
  expandedEntryIds.value = new Set()
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
  }
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <div ref="listRef" class="entry-column-list" aria-label="词条列表">
    <article
      v-for="entry in entries"
      :key="entry.entryId"
      :ref="(element) => setEntryElement(entry.entryId, element)"
      class="entry-column-card"
      :class="{ 'entry-column-card--expanded': isExpanded(entry.entryId) }"
      role="button"
      tabindex="0"
      :aria-expanded="isExpanded(entry.entryId)"
      @click="handleEntryClick(entry)"
      @keydown="handleEntryKeydown($event, entry)"
    >
      <div class="entry-column-card__main">
        <header class="entry-column-card__header">
          <h3>{{ entry.title }}</h3>
          <time :datetime="entry.updatedAt">{{ formatDate(entry.updatedAt) }}</time>
        </header>

        <div v-if="entry.tags.length > 0" class="entry-column-card__tags" aria-label="标签">
          <span v-for="tag in entry.tags" :key="tag">{{ tag }}</span>
        </div>

        <div class="entry-column-card__body-wrap" :aria-hidden="!isExpanded(entry.entryId)">
          <p class="entry-column-card__body">{{ getEntryBody(entry) }}</p>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.entry-column-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}

.entry-column-card {
  position: relative;
  display: grid;
  min-height: 82px;
  padding: 16px 20px 14px 26px;
  border: 1px solid rgb(111 142 131 / 24%);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgb(255 255 251 / 94%), rgb(250 248 241 / 88%)),
    rgb(255 255 255 / 82%);
  box-shadow: 0 10px 30px rgb(24 33 31 / 5%);
  color: var(--color-ink);
  cursor: pointer;
  outline: none;
  overflow: hidden;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.entry-column-card::before {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 8px;
  width: 3px;
  border-radius: 999px;
  background: rgb(69 148 122 / 84%);
  content: '';
}

.entry-column-card:hover,
.entry-column-card:focus-visible {
  border-color: rgb(69 148 122 / 44%);
  box-shadow: 0 18px 38px rgb(24 33 31 / 10%);
  transform: translateX(8px);
}

.entry-column-card__main {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.entry-column-card__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: start;
  gap: 20px;
}

.entry-column-card h3 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(1.15rem, 1rem + 0.38vw, 1.48rem);
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.entry-column-card time {
  color: rgb(89 108 101);
  font-size: 0.92rem;
  font-weight: 900;
  line-height: 1.2;
  white-space: nowrap;
}

.entry-column-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.entry-column-card__tags span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgb(79 151 128 / 22%);
  border-radius: 7px;
  background: rgb(255 255 255 / 68%);
  color: rgb(42 83 75);
  font-size: 0.84rem;
  font-weight: 900;
}

.entry-column-card__body-wrap {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateY(-4px);
  transition:
    max-height 280ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 160ms ease,
    transform 220ms ease;
  will-change: max-height, opacity, transform;
}

.entry-column-card__body {
  min-height: 0;
  max-width: 100%;
  margin: 0;
  color: rgb(73 86 82);
  line-height: 1.8;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.entry-column-card--expanded {
  box-shadow: 0 18px 40px rgb(24 33 31 / 9%);
}

.entry-column-card--expanded .entry-column-card__body-wrap {
  max-height: min(46vh, 520px);
  opacity: 1;
  overflow: auto;
  transform: translateY(0);
  scrollbar-gutter: stable;
}

@media (max-width: 720px) {
  .entry-column-card {
    padding: 14px 16px 14px 24px;
  }

  .entry-column-card__header {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .entry-column-card time {
    font-size: 0.9rem;
  }
}
</style>
