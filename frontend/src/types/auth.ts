import type { CurrentUser, UserSummary } from './user'

export interface LoginRequest {
  credential: string
  password: string
}

export interface LoginResponse {
  user: UserSummary
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  nickname: string
  verificationCode: string
}

export interface RegisterResponse {
  userId: string
  username: string
  nickname: string
  email: string
  createdAt: string
}

export interface EmailCodeRequest {
  email: string
}

export interface EmailCodeResponse {
  email: string
  expiresIn: number
}

export interface RefreshResponse {
  expiresIn: number
}

export interface AuthState {
  currentUser: CurrentUser | null
  initialized: boolean
  refreshing: boolean
}
