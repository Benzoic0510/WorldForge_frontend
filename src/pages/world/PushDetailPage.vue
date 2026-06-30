<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getStoryPushDetail } from '@/api/storyline'
import { ApiError } from '@/api/http'
import type { StoryPushDetail } from '@/types/storyline'

const route = useRoute()
const worldId = String(route.params.worldId)
const submissionId = String(route.params.submissionId)

const detail = ref<StoryPushDetail | null>(null)
const loading = ref(true)
const error = ref('')

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    pending_review: '待审核',
    approved: '已批准',
    rejected: '已拒绝',
  }
  return map[status] ?? status
}

function storyPushTitle(push: StoryPushDetail): string {
  return push.title || push.summary
}

onMounted(async () => {
  try {
    detail.value = await getStoryPushDetail(worldId, submissionId)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '无法加载推送详情'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="push-detail-page">
    <nav class="push-detail-breadcrumb">
      <RouterLink :to="{ name: 'discover' }">发现世界</RouterLink>
      <span>&rsaquo;</span>
      <RouterLink :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }">
        世界线树图
      </RouterLink>
      <span>&rsaquo;</span>
      <strong>推送详情</strong>
    </nav>

    <div v-if="loading" class="page-state">
      <p>正在加载...</p>
    </div>

    <div v-else-if="error" class="page-state page-state--error">
      <h1>无法加载</h1>
      <p>{{ error }}</p>
      <RouterLink
        class="detail-action detail-action--primary"
        :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }"
      >
        返回世界线树图
      </RouterLink>
    </div>

    <article v-else-if="detail" class="push-detail-card">
      <header class="push-detail-header">
        <h1>{{ storyPushTitle(detail) }}</h1>
        <div class="push-detail-meta">
          <span class="push-detail-badge" :class="`push-detail-badge--${detail.status}`">
            {{ formatStatus(detail.status) }}
          </span>
          <span class="push-detail-author">作者：{{ detail.submitter.nickname }}</span>
          <span class="push-detail-time">{{ detail.submittedAt }}</span>
        </div>
      </header>

      <section class="push-detail-body">
        <h2>推送内容</h2>
        <div class="push-detail-content" v-text="detail.content"></div>
      </section>

      <section v-if="detail.reviewComment" class="push-detail-review">
        <h2>审核意见</h2>
        <p>{{ detail.reviewComment }}</p>
      </section>

      <footer class="push-detail-actions">
        <RouterLink
          class="detail-action detail-action--primary"
          :to="{ name: 'line-content', params: { worldId, lineId: detail.targetLineId } }"
        >
          查看该线内容
        </RouterLink>
        <RouterLink
          class="detail-action detail-action--secondary"
          :to="{ name: 'world-studio', params: { worldId }, query: { view: 'graph' } }"
        >
          返回树图
        </RouterLink>
      </footer>
    </article>
    <div v-else class="page-state">
      <p>无法加载推送详情。</p>
    </div>
  </main>
</template>

<style scoped>
.push-detail-page {
  max-width: 780px;
  margin: 0 auto;
  padding: 24px 16px 60px;
}

.push-detail-breadcrumb {
  margin-bottom: 24px;
  font-size: 0.85rem;
  color: var(--color-muted);
}
.push-detail-breadcrumb a {
  color: var(--color-accent);
  text-decoration: none;
}
.push-detail-breadcrumb a:hover {
  text-decoration: underline;
}

.page-state {
  text-align: center;
  padding: 60px 16px;
  color: var(--color-muted);
}
.page-state--error h1 {
  color: var(--color-error, #c0392b);
}

.push-detail-card {
  background: white;
  border: 1px solid rgb(16 59 49 / 10%);
  border-radius: 10px;
  box-shadow: var(--shadow-panel);
  padding: 32px;
}

.push-detail-header h1 {
  margin: 0 0 12px;
  font-family: var(--font-display);
  font-size: 1.6rem;
  color: var(--color-ink);
}

.push-detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 0.88rem;
  color: var(--color-muted);
  margin-bottom: 28px;
}

.push-detail-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: 700;
}
.push-detail-badge--approved {
  background: rgb(20 115 90 / 12%);
  color: #14735a;
}
.push-detail-badge--pending_review {
  background: rgb(212 148 58 / 12%);
  color: #d4943a;
}
.push-detail-badge--rejected {
  background: rgb(192 57 43 / 10%);
  color: #c0392b;
}
.push-detail-body h2,
.push-detail-review h2 {
  font-size: 1rem;
  color: var(--color-ink);
  margin: 24px 0 10px;
  border-bottom: 1px solid var(--color-line);
  padding-bottom: 6px;
}

.push-detail-content {
  white-space: pre-wrap;
  line-height: 1.7;
  color: var(--color-ink);
}

.push-detail-review p {
  background: rgb(245 243 240);
  border-radius: 6px;
  padding: 12px 16px;
  color: var(--color-muted);
  font-size: 0.92rem;
}

.push-detail-actions {
  margin-top: 32px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 20px;
  border-top: 1px solid var(--color-line);
}

.detail-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  font-size: 0.92rem;
  font-weight: 800;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.detail-action::after {
  margin-left: 8px;
  font-size: 1.05rem;
  line-height: 1;
  transition: transform 160ms ease;
}

.detail-action--primary {
  color: #fff;
  background: #103b31;
  border-color: #103b31;
  box-shadow: 0 10px 24px rgb(16 59 49 / 18%);
}

.detail-action--primary::after {
  content: ">";
}

.detail-action--secondary {
  color: var(--color-ink);
  background: rgb(255 255 255 / 68%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 82%);
}

.detail-action--secondary::after {
  content: "";
  width: 7px;
  height: 7px;
  margin-left: 10px;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(-135deg);
}

.detail-action:hover {
  transform: translateY(-1px);
  text-decoration: none;
}

.detail-action--primary:hover {
  background: var(--color-accent);
  border-color: var(--color-accent);
  box-shadow: 0 14px 30px rgb(20 115 90 / 22%);
}

.detail-action--secondary:hover {
  color: var(--color-accent);
  background: rgb(232 241 237 / 82%);
  border-color: rgb(20 115 90 / 38%);
}

.detail-action--primary:hover::after {
  transform: translateX(2px);
}

.detail-action--secondary:hover::after {
  transform: translateX(-2px) rotate(-135deg);
}

@media (max-width: 560px) {
  .push-detail-card {
    padding: 24px 20px;
  }

  .push-detail-actions {
    flex-direction: column;
  }

  .detail-action {
    width: 100%;
  }
}
</style>
