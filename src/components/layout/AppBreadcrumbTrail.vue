<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useBreadcrumbTrailStore } from '@/stores/breadcrumbTrail'

const breadcrumbTrailStore = useBreadcrumbTrailStore()
const visibleTrail = computed(() => breadcrumbTrailStore.trail)
</script>

<template>
  <nav v-if="visibleTrail.length > 1" class="app-breadcrumb-trail" aria-label="页面路径">
    <RouterLink
      v-for="item in visibleTrail.slice(0, -1)"
      :key="item.key"
      :to="item.to"
      class="app-breadcrumb-trail__item"
    >
      {{ item.label }}
    </RouterLink>
    <strong class="app-breadcrumb-trail__item app-breadcrumb-trail__item--current">
      {{ visibleTrail[visibleTrail.length - 1].label }}
    </strong>
  </nav>
</template>

<style scoped>
.app-breadcrumb-trail {
  display: none;
}

@media (min-width: 1280px) {
  .app-breadcrumb-trail {
    position: fixed;
    top: calc(var(--nav-height) + 28px);
    left: max(24px, calc((100vw - var(--page-max-width)) / 2 - 112px));
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 92px;
    gap: 4px;
    padding: 2px 0 2px 16px;
    color: rgb(97 112 107 / 78%);
  }

  .app-breadcrumb-trail::before {
    position: absolute;
    top: 12px;
    bottom: 12px;
    left: 4px;
    width: 1px;
    content: "";
    background: linear-gradient(
      to bottom,
      transparent,
      rgb(20 115 90 / 22%) 16%,
      rgb(20 115 90 / 18%) 84%,
      transparent
    );
  }

  .app-breadcrumb-trail__item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    max-width: 100%;
    min-height: 28px;
    padding: 0 8px;
    border-radius: 999px;
    overflow: hidden;
    color: rgb(48 83 73 / 76%);
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.25;
    text-align: left;
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-breadcrumb-trail__item::before {
    position: absolute;
    left: -15px;
    width: 7px;
    height: 7px;
    border: 1px solid rgb(20 115 90 / 28%);
    border-radius: 999px;
    content: "";
    background: rgb(246 242 232 / 94%);
  }

  .app-breadcrumb-trail__item--current {
    color: #163d33;
    background: rgb(232 241 237 / 72%);
    box-shadow: inset 0 0 0 1px rgb(20 115 90 / 10%);
    font-size: 0.82rem;
    font-weight: 800;
  }

  .app-breadcrumb-trail__item--current::before {
    left: -16px;
    width: 9px;
    height: 9px;
    border-color: rgb(20 115 90 / 40%);
    background: #14735a;
    box-shadow: 0 0 0 3px rgb(20 115 90 / 10%);
  }
}
</style>
