<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ApiError } from '@/api/http'
import { listNotifications } from '@/api/notification'
import UserDropdown from '@/components/layout/UserDropdown.vue'

const route = useRoute()
const isMenuOpen = ref(false)
const navLinksRef = ref<HTMLElement | null>(null)
const navIndicatorStyle = ref({ opacity: '0', width: '0px', transform: 'translateX(0)' })
const hasUnreadNotifications = ref(false)

async function refreshUnreadNotifications() {
  try {
    const data = await listNotifications({
      status: 'unread',
      page: 1,
      pageSize: 1
    })
    hasUnreadNotifications.value = data.unreadCount > 0
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      hasUnreadNotifications.value = false
      return
    }
    hasUnreadNotifications.value = false
  }
}

function updateNavIndicator() {
  const activeKey = route.name === 'discover'
    ? 'discover'
    : route.name === 'my-worlds'
      ? 'my-worlds'
      : null
  const navEl = navLinksRef.value
  const activeEl = activeKey
    ? navEl?.querySelector<HTMLElement>(`[data-nav-key="${activeKey}"]`)
    : null

  if (!navEl || !activeEl) {
    navIndicatorStyle.value = { opacity: '0', width: '0px', transform: 'translateX(0)' }
    return
  }

  const width = Math.max(activeEl.offsetWidth - 28, 0)
  const x = activeEl.offsetLeft + 14
  navIndicatorStyle.value = {
    opacity: '1',
    width: `${width}px`,
    transform: `translateX(${x}px)`
  }
}

watch(
  () => route.fullPath,
  async () => {
    isMenuOpen.value = false
    await nextTick()
    updateNavIndicator()
    await refreshUnreadNotifications()
  }
)

watch(isMenuOpen, async () => {
  await nextTick()
  updateNavIndicator()
})

onMounted(async () => {
  await nextTick()
  updateNavIndicator()
  await refreshUnreadNotifications()
  window.addEventListener('resize', updateNavIndicator)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateNavIndicator)
})
</script>

<template>
  <header class="site-nav">
    <RouterLink class="brand" :to="{ name: 'home' }" aria-label="回到 WorldForge 首页">
      <span class="brand-mark" aria-hidden="true">W</span>
      <span class="brand-copy">
        <strong>WorldForge</strong>
        <small>世界观协作创作平台</small>
      </span>
    </RouterLink>

    <button
      class="menu-button"
      type="button"
      :aria-expanded="isMenuOpen"
      aria-label="打开主导航"
      @click="isMenuOpen = !isMenuOpen"
    >
      <span></span>
      <span></span>
      <span></span>
    </button>

    <div class="nav-content" :class="{ 'nav-content--open': isMenuOpen }">
      <nav ref="navLinksRef" class="nav-links" aria-label="主导航">
        <span class="nav-indicator" :style="navIndicatorStyle" aria-hidden="true"></span>
        <RouterLink
          class="nav-link"
          data-nav-key="discover"
          :to="{ name: 'discover' }"
        >
          <svg class="nav-link__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.2" />
            <path d="M4 12h16" />
            <path d="M12 4c2.2 2.1 3.4 4.8 3.4 8s-1.2 5.9-3.4 8" />
            <path d="M12 4c-2.2 2.1-3.4 4.8-3.4 8s1.2 5.9 3.4 8" />
          </svg>
          <span>发现世界</span>
        </RouterLink>
        <RouterLink
          class="nav-link"
          data-nav-key="my-worlds"
          :to="{ name: 'my-worlds' }"
        >
          <svg class="nav-link__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.5 7.5 12 4l7.5 3.5v9L12 20l-7.5-3.5z" />
            <path d="M12 4v16" />
            <path d="m4.5 7.5 7.5 3.6 7.5-3.6" />
            <path d="M8.2 9.3v5.5l3.8 1.8 3.8-1.8V9.3" />
          </svg>
          <span>我的世界观</span>
        </RouterLink>
      </nav>

      <div class="nav-actions">
        <RouterLink
          class="nav-message-link"
          :to="{ name: 'messages' }"
          aria-label="消息"
          title="消息"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 8.2a6.5 6.5 0 0 1 13 0v3.1l1.7 3.2H4.3L6 11.3z" />
            <path d="M9.4 17.4a2.8 2.8 0 0 0 5.2 0" />
            <path d="M9.5 4.6a3 3 0 0 1 5 0" />
          </svg>
          <span
            v-if="hasUnreadNotifications"
            class="nav-message-link__dot"
            aria-hidden="true"
          ></span>
        </RouterLink>
        <UserDropdown />
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 36px;
  align-items: center;
  min-height: var(--nav-height);
  padding: 12px max(24px, calc((100vw - var(--page-max-width)) / 2));
  border-bottom: 1px solid rgb(217 226 220 / 82%);
  background: rgb(246 242 232 / 86%);
  backdrop-filter: blur(18px);
}

.brand {
  display: inline-flex;
  gap: 14px;
  align-items: center;
  min-width: 0;
  color: var(--color-ink);
  text-decoration: none;
}

.brand-mark {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgb(14 67 53 / 24%);
  border-radius: 8px;
  color: #fff;
  background: #103b31;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%);
  font-family: var(--font-display);
  font-weight: 900;
}

.brand-copy {
  display: grid;
  gap: 2px;
}

.brand-copy strong {
  color: #103b31;
  font-size: 0.92rem;
  letter-spacing: 0;
  text-transform: uppercase;
}

.brand-copy small {
  color: #687772;
  font-size: 0.72rem;
  white-space: nowrap;
}

.nav-content {
  display: flex;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.nav-links,
.nav-actions {
  display: inline-flex;
  gap: 10px;
  align-items: center;
}

.nav-links {
  position: relative;
  display: grid;
  grid-template-columns: 132px 148px;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  color: var(--color-muted);
  font-size: 0.9rem;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
  transition: color 150ms ease;
}

.nav-indicator {
  position: absolute;
  bottom: -5px;
  left: 0;
  height: 3px;
  border-radius: 999px;
  background: var(--color-accent);
  transition:
    opacity 140ms ease,
    transform 190ms ease,
    width 190ms ease;
}

.nav-link__icon,
.nav-message-link svg {
  width: 21px;
  height: 21px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: color 150ms ease;
}

.nav-message-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  color: var(--color-ink);
  background: transparent;
  text-decoration: none;
  outline: 0;
  transition:
    color 150ms ease,
    background 150ms ease,
    box-shadow 150ms ease;
}

.nav-message-link svg {
  width: 21px;
  height: 21px;
}

.nav-message-link__dot {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 7px;
  height: 7px;
  border: 1.5px solid rgb(246 242 232 / 96%);
  border-radius: 999px;
  background: #d63b35;
  box-shadow: 0 0 0 2px rgb(214 59 53 / 10%);
}

.nav-message-link:hover,
.nav-message-link.router-link-active {
  color: var(--color-accent);
  background: rgb(232 241 237 / 58%);
}

.nav-message-link:focus-visible {
  color: var(--color-accent);
  background: rgb(232 241 237 / 58%);
  box-shadow: var(--focus-ring);
}

.nav-link:hover,
.nav-link.router-link-active {
  color: var(--color-accent);
}

.menu-button {
  display: none;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  background: rgb(255 255 255 / 62%);
  cursor: pointer;
}

.menu-button span {
  display: block;
  width: 18px;
  height: 2px;
  margin: 4px auto;
  border-radius: 999px;
  background: var(--color-ink);
}

@media (max-width: 840px) {
  .site-nav {
    grid-template-columns: 1fr auto;
    padding: 12px 16px;
  }

  .menu-button {
    display: block;
  }

  .nav-content {
    display: none;
    grid-column: 1 / -1;
    padding: 12px 0 4px;
    border-top: 1px solid var(--color-line);
  }

  .nav-content--open {
    display: grid;
    gap: 14px;
  }

  .nav-links,
  .nav-actions {
    display: grid;
    gap: 8px;
  }

  .nav-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nav-actions {
    display: inline-flex;
    justify-content: start;
  }

  .nav-link {
    width: 100%;
  }
}

@media (max-width: 460px) {
  .brand-copy small {
    display: none;
  }

  .nav-actions {
    grid-template-columns: 1fr;
  }
}
</style>
