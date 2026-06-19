import { defineStore } from 'pinia'
import {
  login as loginApi,
  logout as logoutApi,
  refresh as refreshApi,
  register as registerApi,
  sendEmailCode as sendEmailCodeApi
} from '@/api/auth'
import { setRefreshTokenCallback } from '@/api/http'
import { getCurrentUser } from '@/api/user'
import type { AuthState, LoginRequest, RegisterRequest } from '@/types/auth'

// Register the global 401 interceptor callback for automatic token refresh
setRefreshTokenCallback(() => refreshApi())

let restoreSessionPromise: Promise<void> | null = null

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    currentUser: null,
    initialized: false,
    refreshing: false
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.currentUser)
  },
  actions: {
    async login(payload: LoginRequest) {
      await loginApi(payload)
      await this.fetchCurrentUser()
    },
    async register(payload: RegisterRequest) {
      return registerApi(payload)
    },
    async sendEmailCode(email: string) {
      return sendEmailCodeApi({ email })
    },
    async logout() {
      try {
        await logoutApi()
      } finally {
        this.clearSession()
      }
    },
    async fetchCurrentUser() {
      const user = await getCurrentUser()
      this.currentUser = user
      this.initialized = true
      return user
    },
    async restoreSession() {
      if (this.initialized) {
        return
      }

      if (restoreSessionPromise) {
        return restoreSessionPromise
      }

      restoreSessionPromise = (async () => {
        this.refreshing = true
        try {
          try {
            await this.fetchCurrentUser()
          } catch {
            await refreshApi()
            await this.fetchCurrentUser()
          }
        } catch {
          this.currentUser = null
          this.initialized = true
        } finally {
          this.refreshing = false
          restoreSessionPromise = null
        }
      })()

      return restoreSessionPromise
    },
    clearSession() {
      this.currentUser = null
      this.initialized = true
      this.refreshing = false
      restoreSessionPromise = null
    }
  }
})
