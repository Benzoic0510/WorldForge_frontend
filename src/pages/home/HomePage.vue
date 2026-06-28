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
      item.visibility === 'public' ? '公开' : item.visibility === 'protected' ? '受限' : '私有'
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
            <div class="world-reveal">
              <div class="world-cover" aria-hidden="true">
                <img v-if="world.coverImageUrl" :src="world.coverImageUrl" alt="">
                <span v-else>{{ world.title.charAt(0) }}</span>
              </div>

              <div class="world-main">
                <div class="world-title-line">
                  <h3>{{ world.title }}</h3>
                  <span class="visibility-chip">{{ world.visibilityLabel }}</span>
                </div>
                <p>{{ world.summary || '暂无简介。' }}</p>
                <div class="tag-list" aria-label="标签">
                  <span v-for="tag in world.tags.slice(0, 4)" :key="tag">{{ tag }}</span>
                  <span v-if="world.tags.length > 4">+{{ world.tags.length - 4 }}</span>
                </div>
              </div>
            </div>

            <div class="world-side">
              <div class="creator-line">
                <span class="creator-avatar" aria-hidden="true">{{ world.creator.charAt(0) }}</span>
                <strong>{{ world.creator }}</strong>
              </div>

              <div class="world-metrics">
                <span>{{ world.entryCount }} 词条</span>
                <small>{{ world.updatedAt }}</small>
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
  gap: 18px;
}

.world-card {
  --world-cover-height: 280px;
  --world-reveal-offset: calc((var(--world-cover-height) + 18px) * -1);
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
  object-fit: contain;
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

.world-title-line h3 {
  overflow: hidden;
  margin: 0;
  font-size: 1.2rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.world-card p {
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

.world-card:hover p {
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
  gap: 6px;
  height: 48px;
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
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid #dfe7e2;
  border-radius: 7px;
  color: #305349;
  background: #f7faf8;
  font-size: 0.72rem;
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
