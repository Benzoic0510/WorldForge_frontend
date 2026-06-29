<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listWorlds } from '@/api/world'
import { ApiError } from '@/api/http'
import type { WorldListItem } from '@/types/world'

interface DiscoverWorld {
  id: string
  title: string
  summary: string
  tags: string[]
  creator: string
  coverImageUrl: string
  updatedAt: string
  entryCount: number
  visibilityLabel: string
}

const discoverWorlds = ref<DiscoverWorld[]>([])
const discoverLoading = ref(true)
const discoverError = ref('')

function toDiscoverWorld(item: WorldListItem): DiscoverWorld {
  return {
    id: item.worldId,
    title: item.name,
    summary: item.description,
    tags: item.tags,
    creator: item.creator.nickname,
    coverImageUrl: item.coverImageUrl,
    updatedAt: formatRelativeTime(item.updatedAt),
    entryCount: item.entryCount,
    visibilityLabel:
      item.visibility === 'public' ? '公开' : item.visibility === 'protected' ? '保护' : '私有'
  }
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 30) return `${days} 天前`
  return new Date(isoString).toLocaleDateString('zh-CN')
}

onMounted(async () => {
  try {
    const result = await listWorlds({ sortBy: 'hot', pageSize: 3 })
    discoverWorlds.value = result.items.map(toDiscoverWorld)
  } catch (e) {
    discoverError.value = e instanceof ApiError ? e.message : '加载推荐失败，请稍后重试'
  } finally {
    discoverLoading.value = false
  }
})
</script>

<template>
  <main class="home-page">
    <section class="hero page-container" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">WorldForge</p>
        <h1 id="home-title">发现新的世界线，共建你的创作宇宙</h1>
        <p class="lead">
          在同一个世界观里整理设定、发起支线、评审提议，并让 RPG 角色与读者互动自然生长。
        </p>
      </div>
    </section>

    <section class="entry-section page-container" aria-labelledby="platform-overview-title">
      <div class="entry-heading section-heading">
        <p class="eyebrow">Platform Overview</p>
        <h2 id="platform-overview-title">平台能力摘要</h2>
      </div>

      <div class="entry-band">
        <div class="entry-grid" aria-label="平台能力摘要">
          <article class="entry-item">
            <span>01</span>
            <strong>世界设定组织</strong>
            <small>通过标签、词条与关系链接组织世界骨架，保持设定结构清晰可扩展。</small>
          </article>
          <article class="entry-item">
            <span>02</span>
            <strong>多人协作创作</strong>
            <small>围绕支线、提议采纳与任务招募推进共创，让内容流转保持顺畅。</small>
          </article>
          <article class="entry-item">
            <span>03</span>
            <strong>角色互动延展</strong>
            <small>让 OC、剧情互动与阅读反馈在同一套世界观语境中持续延展。</small>
          </article>
          <article class="entry-item">
            <span>04</span>
            <strong>动态与阅读入口</strong>
            <small>从推荐世界、关注更新到通知回流，承接创作者与读者的持续参与。</small>
          </article>
        </div>
      </div>
    </section>

    <section class="feed-layout page-container" aria-label="首页推荐世界观">
      <div class="feed-section">
        <div class="section-heading">
          <p class="eyebrow">Discover</p>
          <h2>平台推荐的世界观</h2>
        </div>

        <div v-if="discoverLoading" class="inline-state">
          <p>正在加载推荐世界观...</p>
        </div>
        <div v-else-if="discoverError" class="inline-state inline-state--error">
          <p>{{ discoverError }}</p>
        </div>
        <div v-else-if="discoverWorlds.length === 0" class="inline-state">
          <p>暂无推荐的世界观</p>
        </div>
        <div v-else class="world-grid">
          <RouterLink
            v-for="world in discoverWorlds"
            :key="world.id"
            :to="{ name: 'world-detail', params: { worldId: world.id } }"
            class="world-card"
          >
            <div class="world-card-cover">
              <img v-if="world.coverImageUrl" :src="world.coverImageUrl" alt="">
              <span v-else>{{ world.title.charAt(0) }}</span>
            </div>
            <div class="world-card-body">
              <h3>{{ world.title }}</h3>
              <p>{{ world.summary || '暂无简介。' }}</p>
              <div v-if="world.tags.length > 0" class="tag-list" aria-label="标签">
                <span v-for="tag in world.tags" :key="tag">{{ tag }}</span>
              </div>
              <div class="world-card-footer">
                <span class="world-card-meta">{{ world.entryCount }} 词条</span>
                <span class="world-card-meta">{{ world.updatedAt }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

  </main>
</template>

<style scoped>
.home-page {
  padding-bottom: 0;
}

.hero {
  display: block;
  min-height: auto;
  padding-block: clamp(24px, 4vw, 44px) 28px;
}

.hero-copy {
  max-width: 1120px;
}

.eyebrow {
  margin: 0;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  color: var(--color-ink);
  font-family: var(--font-display);
}

h1 {
  max-width: 11ch;
  margin: 12px 0 0;
  font-size: clamp(2.75rem, 4.8vw, 5rem);
  line-height: 1.08;
  word-break: keep-all;
  text-wrap: balance;
}

.lead {
  max-width: 980px;
  margin: 18px 0 0;
  color: var(--color-muted);
  font-size: clamp(1rem, 1.5vw, 1.12rem);
  line-height: 1.85;
}

.entry-section {
  padding-top: 28px;
}

.entry-heading {
  max-width: 420px;
  margin-bottom: 20px;
}

.entry-band {
  border-block: 1px solid rgb(217 226 220 / 88%);
  background: linear-gradient(180deg, rgb(255 255 255 / 36%), rgb(255 255 255 / 18%));
}

.entry-heading h2 {
  margin: 0;
  font-size: clamp(1.65rem, 2.4vw, 2.3rem);
  line-height: 1.15;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-left: 1px solid var(--color-line);
}

.entry-item {
  display: grid;
  min-height: 146px;
  align-content: start;
  gap: 14px;
  padding: 22px 22px 24px;
  border-right: 1px solid var(--color-line);
  color: var(--color-ink);
  text-align: left;
}

.entry-item span {
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 900;
}

.entry-item strong {
  font-size: 1.02rem;
  line-height: 1.35;
}

.entry-item small {
  color: var(--color-muted);
  font-size: 0.9rem;
  line-height: 1.65;
}

.feed-layout {
  padding-top: 48px;
}

.section-heading {
  display: grid;
  gap: 10px;
  margin-bottom: 22px;
}

.section-heading h2 {
  margin: 0;
  font-size: clamp(1.65rem, 3vw, 2.45rem);
  line-height: 1.12;
}

.world-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.world-card {
  border: 1px solid var(--color-line);
  border-radius: 8px;
  color: inherit;
  background: rgb(255 255 255 / 58%);
  overflow: hidden;
  text-decoration: none;
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
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--color-muted);
  font-size: 0.88rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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

@media (max-width: 1040px) {
  .feed-layout {
    grid-template-columns: 1fr;
  }

  .world-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .entry-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .home-page {
    padding-bottom: 0;
  }

  .hero {
    padding-block: 20px 24px;
  }

  h1 {
    max-width: 8ch;
    font-size: clamp(2.35rem, 12vw, 3.6rem);
  }

  .world-grid,
  .entry-grid {
    grid-template-columns: 1fr;
  }

  .entry-grid,
  .world-grid {
    display: grid;
  }

  .entry-item,
  .entry-item {
    min-height: 142px;
    border-left: 1px solid var(--color-line);
    border-right: 1px solid var(--color-line);
    border-bottom: 1px solid var(--color-line);
  }

  .world-grid {
    grid-template-columns: 1fr;
  }
}

.inline-state {
  display: grid;
  gap: 12px;
  padding: 24px;
  min-height: 120px;
  align-content: center;
  border: 1px solid rgb(16 59 49 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 48%);
  box-shadow: var(--shadow-panel);
}

.inline-state p {
  margin: 0;
  color: var(--color-muted);
}

.inline-state--error {
  background: rgb(108 36 36 / 6%);
}

</style>
