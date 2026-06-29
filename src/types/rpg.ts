// OC 角色相关类型
export interface OcResponse {
  ocId: string
  worldId: string
  ownerId: string
  name: string
  avatarUrl: string
  bio: string
  attributes: Record<string, unknown>
  createdAt: string
}

// 创建 OC 请求
export interface CreateOcRequest {
  name: string
  avatarUrl?: string
  bio?: string
  attributes?: Record<string, unknown>
}

// 更新 OC 请求（与创建请求同构，独立保留方便未来分叉）
export type UpdateOcRequest = CreateOcRequest

// RPG 频道响应
export interface RpgChannelResponse {
  channelId: string
  worldId: string
  name: string
  channelType: string
  memberUserIds: string[]
  creatorId?: string
  createdBy?: string
  ownerId?: string
  createdAt: string
}

// 创建 RPG 频道请求
export interface CreateRpgChannelRequest {
  name: string
  channelType: string
  memberUserIds?: string[]
}

export interface AddRpgChannelMembersRequest {
  userId?: string
  memberUserIds?: string[]
}

export interface ChatMessageSender {
  userId: string
  ocId: string | null
  displayName: string
  avatarUrl: string
  mode: 'ic' | 'ooc'
}

export interface ChatMessageResponse {
  messageId: string
  channelId: string
  content: string
  sender: ChatMessageSender
  sentAt: string
  isRecalled: boolean
  recalledAt: string | null
}

export interface ChatMessageHistoryResponse {
  messages: ChatMessageResponse[]
  nextBeforeSentAt: string | null
  nextBeforeMessageId: string | null
  hasMore: boolean
}

export interface UploadImageResponse {
  fileName: string
  url: string
}
