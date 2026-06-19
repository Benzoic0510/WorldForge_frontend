export type NotificationStatus = 'all' | 'unread' | 'read'

export interface NotificationItem {
  notificationId: string
  content: string
  linkUrl: string
  isRead: boolean
  createdAt: string
}

export interface NotificationListResponse {
  items: NotificationItem[]
  total: number
  allCount: number
  unreadCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ListNotificationsParams {
  status?: NotificationStatus
  page?: number
  pageSize?: number
}
