<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useClickOutside } from '@/composables/useClickOutside'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const panelOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)
const avatarError = ref(false)

const displayName = computed(() => {
  const user = authStore.currentUser
  return user?.nickname || user?.username || '用户'
})

const username = computed(() => {
  return authStore.currentUser?.username || ''
})

const bio = computed(() => {
  return authStore.currentUser?.bio || null
})

const avatarSrc = computed(() => {
  const url = authStore.currentUser?.avatarUrl
  if (!url || avatarError.value) return null
  return url
})

const initialLetter = computed(() => {
  return displayName.value.charAt(0)
})

useClickOutside(dropdownRef, () => {
  if (panelOpen.value) {
    panelOpen.value = false
  }
})

function togglePanel() {
  panelOpen.value = !panelOpen.value
  avatarError.value = false
}

function closePanel() {
  panelOpen.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && panelOpen.value) {
    panelOpen.value = false
  }
}

async function handleLogout() {
  closePanel()
  await authStore.logout()
  if (route.name !== 'home') {
    await router.push({ name: 'home' })
  }
}

function onAvatarError() {
  avatarError.value = true
}

watch(
  () => route.fullPath,
  () => {
    panelOpen.value = false
  }
)

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <template v-if="!authStore.isAuthenticated">
    <RouterLink class="login-link" :to="{ name: 'login' }">登录</RouterLink>
    <RouterLink class="register-link" :to="{ name: 'register' }">注册</RouterLink>
  </template>

  <div v-else ref="dropdownRef" class="user-dropdown">
    <button
      class="avatar-btn"
      type="button"
      :aria-expanded="panelOpen"
      aria-label="打开用户菜单"
      @click="togglePanel"
    >
      <img v-if="avatarSrc" :src="avatarSrc" alt="" @error="onAvatarError" />
      <span v-else class="avatar-fallback">{{ initialLetter }}</span>
    </button>

    <Transition name="dropdown">
      <div v-if="panelOpen" class="dropdown-panel">
        <div class="panel-header">
          <div class="panel-avatar">
            <img v-if="avatarSrc" :src="avatarSrc" alt="" />
            <span v-else class="avatar-fallback">{{ initialLetter }}</span>
          </div>
          <strong class="panel-name">{{ displayName }}</strong>
          <span class="panel-username">@{{ username }}</span>
          <p v-if="bio" class="panel-bio">{{ bio }}</p>
        </div>

        <div class="panel-actions">
          <RouterLink class="panel-action" :to="{ name: 'profile' }" @click="closePanel">
            进入主页
          </RouterLink>
          <RouterLink class="panel-action" :to="{ name: 'settings' }" @click="closePanel">
            设置
          </RouterLink>
          <button class="panel-action panel-action--logout" type="button" @click="handleLogout">
            退出登录
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user-dropdown {
  position: relative;
}

.avatar-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 2px solid rgb(20 115 90 / 18%);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 150ms ease;
}

.avatar-btn:hover {
  border-color: var(--color-accent);
}

.avatar-btn:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}

.avatar-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  color: #fff;
  background: #103b31;
  font-size: 0.92rem;
  font-weight: 900;
}

.dropdown-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  min-width: 280px;
  border-radius: 12px;
  background: #fff;
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}

.panel-header {
  display: grid;
  gap: 4px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-line);
}

.panel-avatar {
  width: 48px;
  height: 48px;
  margin-bottom: 8px;
  border-radius: 50%;
  overflow: hidden;
}

.panel-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.panel-avatar .avatar-fallback {
  font-size: 1.2rem;
}

.panel-name {
  color: var(--color-ink);
  font-size: 0.98rem;
  font-weight: 900;
}

.panel-username {
  color: var(--color-muted);
  font-size: 0.82rem;
}

.panel-bio {
  margin: 6px 0 0;
  color: var(--color-muted);
  font-size: 0.85rem;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.panel-actions {
  display: grid;
  gap: 2px;
  padding: 8px;
}

.panel-action {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  color: var(--color-ink);
  background: transparent;
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms ease;
}

.panel-action:hover {
  background: rgb(20 115 90 / 7%);
}

.panel-action--logout {
  color: var(--color-muted);
}

.panel-action--logout:hover {
  background: rgb(180 40 40 / 7%);
}

.login-link,
.register-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}

.register-link {
  color: #fff;
  background: #103b31;
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 840px) {
  .login-link,
  .register-link {
    width: 100%;
  }
}

@media (max-width: 460px) {
  .login-link,
  .register-link {
    width: 100%;
  }
}
</style>
