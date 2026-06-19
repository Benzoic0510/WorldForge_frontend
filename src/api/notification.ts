import { request } from './http'
import type {
  ListNotificationsParams,
  NotificationListResponse
} from '@/types/notification'

function buildNotificationQuery(params: ListNotificationsParams = {}): string {
  const searchParams = new URLSearchParams()

  if (params.status) {
    searchParams.set('status', params.status)
  }
  if (params.page != null) {
    searchParams.set('page', String(params.page))
  }
  if (params.pageSize != null) {
    searchParams.set('pageSize', String(params.pageSize))
  }

  const query = searchParams.toString()
  return query ? `/api/notifications?${query}` : '/api/notifications'
}

export function listNotifications(
  params: ListNotificationsParams = {}
): Promise<NotificationListResponse> {
  return request<NotificationListResponse>(buildNotificationQuery(params))
}

export function markNotificationRead(notificationId: string): Promise<void> {
  return request<void>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'PATCH'
  })
}

export function markAllNotificationsRead(): Promise<void> {
  return request<void>('/api/notifications/read-all', {
    method: 'PATCH'
  })
}

export function deleteReadNotifications(): Promise<void> {
  return request<void>('/api/notifications/read', {
    method: 'DELETE'
  })
}
