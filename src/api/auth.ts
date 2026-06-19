import { request } from './http'
import type {
  EmailCodeRequest,
  EmailCodeResponse,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse
} from '@/types/auth'

export function sendEmailCode(payload: EmailCodeRequest): Promise<EmailCodeResponse> {
  return request<EmailCodeResponse>('/api/auth/email-code', {
    method: 'POST',
    body: payload
  })
}

export function register(payload: RegisterRequest): Promise<RegisterResponse> {
  return request<RegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: payload
  })
}

export function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: payload
  })
}

export function refresh(): Promise<RefreshResponse> {
  return request<RefreshResponse>('/api/auth/refresh', {
    method: 'POST',
    skipAuthRefresh: true
  })
}

export function logout(): Promise<null> {
  return request<null>('/api/auth/logout', {
    method: 'POST'
  })
}
