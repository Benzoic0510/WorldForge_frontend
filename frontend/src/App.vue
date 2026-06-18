<template>
  <div class="app-shell">
    <AppNavbar />
    <AppBreadcrumbTrail />
    <main class="app-stage">
      <RouterView />
    </main>
    <AppFooter v-if="showFooter" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppBreadcrumbTrail from '@/components/layout/AppBreadcrumbTrail.vue'
import AppNavbar from '@/components/layout/AppNavbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const authStore = useAuthStore()
const showFooter = computed(() => route.meta.hideFooter !== true)

onMounted(() => {
  void authStore.restoreSession()
})
</script>

<style scoped>
.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.app-stage {
  flex: 1 0 auto;
}
</style>
