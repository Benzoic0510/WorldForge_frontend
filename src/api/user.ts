import { request } from './http'
import type { CurrentUser, UploadImageResponse, UserSummary } from '@/types/user'

export function getCurrentUser(): Promise<CurrentUser> {
  return request<CurrentUser>('/api/users/me')
}

export function uploadCurrentUserAvatar(file: File): Promise<UploadImageResponse> {
  const formData = new FormData()
  formData.set('file', file)
  return request<UploadImageResponse>('/api/users/me/avatar', {
    method: 'POST',
    body: formData
  })
}

export function searchUsers(keyword: string, limit = 10): Promise<UserSummary[]> {
  const searchParams = new URLSearchParams()
  searchParams.set('keyword', keyword)
  searchParams.set('limit', String(limit))
  return request<UserSummary[]>(`/api/users/search?${searchParams.toString()}`)
}

export function deleteCurrentUser(): Promise<void> {
  return request<void>('/api/users/me', {
    method: 'DELETE'
  })
}
