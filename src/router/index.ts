import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useBreadcrumbTrailStore } from '@/stores/breadcrumbTrail'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/HomePage.vue'),
      meta: {
        title: 'WorldForge'
      }
    },
    {
      path: '/discover',
      name: 'discover',
      component: () => import('@/pages/world/DiscoverWorldPage.vue'),
      meta: {
        title: '发现世界'
      }
    },
    {
      path: '/worlds/:worldId',
      name: 'world-detail',
      component: () => import('@/pages/world/WorldDetailPage.vue'),
      meta: {
        title: '世界详情'
      }
    },
    {
      path: '/worlds/:worldId/edit',
      name: 'world-edit',
      component: () => import('@/pages/world/EditWorldPage.vue'),
      meta: {
        title: '编辑世界',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/story-graph',
      redirect: (to) => ({
        name: 'world-studio',
        params: { worldId: to.params.worldId },
        query: { view: 'graph' }
      })
    },
    {
      path: '/worlds/:worldId/create',
      name: 'world-studio',
      component: () => import('@/pages/world/WorldStudioPage.vue'),
      meta: {
        title: '创作工作台'
      }
    },
    {
      path: '/worlds/:worldId/submit-push',
      name: 'submit-push',
      component: () => import('@/pages/world/SubmitPushPage.vue'),
      meta: {
        title: '提交内容',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/review-submissions',
      name: 'review-submissions',
      component: () => import('@/pages/world/ReviewSubmissionsPage.vue'),
      meta: {
        title: '审核提交',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/lines/:lineId',
      name: 'line-content',
      component: () => import('@/pages/world/LineContentPage.vue'),
      meta: {
        title: '故事线内容'
      }
    },
    {
      path: '/worlds/:worldId/submissions/:submissionId',
      name: 'push-detail',
      component: () => import('@/pages/world/PushDetailPage.vue'),
      meta: {
        title: '推送详情'
      }
    },
    {
      path: '/worlds/:worldId/entries',
      redirect: (to) => ({
        name: 'world-studio',
        params: { worldId: to.params.worldId },
        query: { view: 'entries' }
      })
    },
    {
      path: '/worlds/:worldId/changelog',
      name: 'world-changelog',
      component: () => import('@/pages/world/ChangelogPage.vue'),
      meta: {
        title: '更新日志'
      }
    },
    {
      path: '/worlds/:worldId/members',
      name: 'world-members',
      component: () => import('@/pages/world/WorldMembersPage.vue'),
      meta: {
        title: '成员管理',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/entries/new',
      name: 'entry-create',
      component: () => import('@/pages/world/CreateEntryPage.vue'),
      meta: {
        title: '新建词条',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/entries/:entryId/edit',
      name: 'entry-edit',
      component: () => import('@/pages/world/EditEntryPage.vue'),
      meta: {
        title: '编辑词条',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/entries/:entryId',
      name: 'entry-detail',
      component: () => import('@/pages/world/EntryDetailPage.vue'),
      meta: {
        title: '词条详情'
      }
    },
    {
      path: '/worlds/:worldId/rpg/ocs',
      name: 'rpg-ocs',
      component: () => import('@/pages/world/rpg/OcListPage.vue'),
      meta: {
        title: '角色管理',
        requiresAuth: true
      }
    },
    {
      path: '/worlds/:worldId/rpg/chat',
      name: 'rpg-chat',
      component: () => import('@/pages/world/rpg/ChatPage.vue'),
      meta: {
        title: 'RPG 聊天',
        requiresAuth: true
      }
    },
    {
      path: '/my-worlds',
      name: 'my-worlds',
      component: () => import('@/pages/world/MyWorldsPage.vue'),
      meta: {
        title: '我的世界观',
        requiresAuth: true
      }
    },
    {
      path: '/create',
      redirect: '/my-worlds'
    },
    {
      path: '/create/new',
      name: 'create-world',
      component: () => import('@/pages/world/CreateWorldPage.vue'),
      meta: {
        title: '新建世界',
        requiresAuth: true
      }
    },
    {
      path: '/messages',
      name: 'messages',
      component: () => import('@/pages/user/MessagesPage.vue'),
      meta: {
        title: '消息',
        requiresAuth: true
      }
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/pages/user/ProfilePage.vue'),
      meta: {
        title: '个人主页'
      }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/pages/user/SettingsPage.vue'),
      meta: {
        title: '设置'
      }
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/auth/LoginPage.vue'),
      meta: {
        title: '登录',
        hideFooter: true
      }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/auth/RegisterPage.vue'),
      meta: {
        title: '注册',
        hideFooter: true
      }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ],
  scrollBehavior() {
    return { top: 0 }
  }
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  const needsAuth = to.meta.requiresAuth === true
  const isAuthPage = to.name === 'login' || to.name === 'register'

  if (needsAuth && !authStore.initialized) {
    await authStore.restoreSession()
  }

  if (isAuthPage && authStore.isAuthenticated) {
    return { name: 'home' }
  }

  if (needsAuth && !authStore.isAuthenticated) {
    return {
      name: 'login',
      query: { redirect: to.fullPath }
    }
  }
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : 'WorldForge'
  document.title = title === 'WorldForge' ? title : `${title} | WorldForge`
  useBreadcrumbTrailStore().recordRoute(to)
})

export default router
