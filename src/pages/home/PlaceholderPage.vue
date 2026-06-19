<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const title = computed(() => {
  return typeof route.meta.title === 'string' ? route.meta.title : '功能建设中'
})
</script>

<template>
  <main class="placeholder-page page-container">
    <section class="placeholder-copy" aria-labelledby="placeholder-title">
      <p class="eyebrow">WorldForge</p>
      <h1 id="placeholder-title">{{ title }}</h1>
      <p>
        这里会承接后续的世界观浏览、创作、协作、消息和个人主页流程。当前先保留稳定入口，方便导航与路由验收。
      </p>
      <RouterLink class="home-link" :to="{ name: 'home' }">返回首页</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.placeholder-page {
  min-height: calc(100vh - var(--nav-height));
  display: grid;
  align-items: center;
  padding-block: clamp(48px, 9vw, 108px);
}

.placeholder-copy {
  max-width: 720px;
}

.eyebrow {
  margin: 0 0 18px;
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 5vw, 4.4rem);
  line-height: 1.04;
  word-break: keep-all;
  text-wrap: balance;
}

p {
  max-width: 620px;
  margin: 22px 0 0;
  color: var(--color-muted);
  font-size: 1.05rem;
  line-height: 1.85;
}

.home-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  margin-top: 30px;
  padding: 0 18px;
  border-radius: 8px;
  color: #fff;
  background: var(--color-ink);
  font-weight: 900;
  text-decoration: none;
}
</style>
