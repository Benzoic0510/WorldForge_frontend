import { defineStore } from 'pinia'
import type { RouteLocationRaw } from 'vue-router'

export interface BreadcrumbTrailItem {
  key: string
  label: string
  to: RouteLocationRaw
  scope: 'global' | 'world'
  worldId?: string
}

interface TrackableRoute {
  key: string
  label: string
  to: RouteLocationRaw
  scope: 'global' | 'world'
  worldId?: string
}

const trackableRouteNames = new Set([
  'world-detail',
  'world-edit',
  'world-studio',
  'submit-push',
  'review-submissions',
  'line-content',
  'push-detail',
  'world-changelog',
  'world-members',
  'entry-create',
  'entry-edit',
  'entry-detail'
])

const rootRouteNames = new Set([
  'discover',
  'my-worlds',
  'create-world'
])

export const useBreadcrumbTrailStore = defineStore('breadcrumbTrail', {
  state: () => ({
    trail: [] as BreadcrumbTrailItem[]
  }),
  actions: {
    clearTrail() {
      this.trail = []
    },
    recordRoute(route: {
      name?: string | symbol | null
      path: string
      fullPath: string
      meta: { title?: unknown; breadcrumbLabel?: unknown }
      params: Record<string, unknown>
      query: Record<string, unknown>
    }) {
      const routeName = typeof route.name === 'string' ? route.name : ''
      if (rootRouteNames.has(routeName)) {
        this.clearTrail()
        return
      }

      if (!trackableRouteNames.has(routeName)) {
        this.clearTrail()
        return
      }

      const worldId = String(route.params.worldId ?? '')
      const entryId = String(route.params.entryId ?? '')
      const lineId = String(route.params.lineId ?? '')
      const submissionId = String(route.params.submissionId ?? '')
      const keySuffix = [worldId, entryId, lineId, submissionId].filter(Boolean).join(':')
      const key = keySuffix ? `${routeName}|${keySuffix}` : routeName || route.path
      const label =
        typeof route.meta.breadcrumbLabel === 'string'
          ? route.meta.breadcrumbLabel
          : typeof route.meta.title === 'string'
            ? route.meta.title
            : routeName || '页面'
      const scope: TrackableRoute['scope'] = worldId ? 'world' : 'global'
      const item: BreadcrumbTrailItem = {
        key,
        label,
        to: routeName ? { name: routeName, params: route.params, query: route.query } : { path: route.path },
        scope,
        ...(worldId ? { worldId } : {})
      }

      const last = this.trail[this.trail.length - 1]

      if (scope === 'global' && last?.scope === 'world') {
        this.trail = [item]
        return
      }

      if (scope === 'world' && last?.scope === 'world' && last.worldId && last.worldId !== worldId) {
        this.trail = [item]
        return
      }

      if (!last) {
        this.trail = [item]
        return
      }

      if (last.key === item.key) {
        this.trail.splice(this.trail.length - 1, 1, item)
        return
      }

      const existingIndex = this.trail.findIndex(entry => entry.key === item.key)
      if (existingIndex >= 0) {
        this.trail = this.trail.slice(0, existingIndex + 1)
        this.trail[existingIndex] = item
        return
      }

      this.trail.push(item)
    }
  }
})
