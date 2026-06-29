import { request } from './http'
import type {
  AddRpgChannelMembersRequest,
  ChatMessageHistoryResponse,
  CreateOcRequest,
  CreateRpgChannelRequest,
  OcResponse,
  RpgChannelResponse,
  UploadImageResponse,
  UpdateOcRequest
} from '@/types/rpg'

// ─── OC 角色 API ───────────────────────────────────────────────

/** 在指定世界观下创建 OC */
export function createOc(worldId: string, payload: CreateOcRequest): Promise<OcResponse> {
  return request<OcResponse>(`/api/worlds/${encodeURIComponent(worldId)}/rpg/ocs`, {
    method: 'POST',
    body: payload
  })
}

/** 获取当前用户在某世界观下的所有 OC */
export function listMyOcs(worldId: string): Promise<OcResponse[]> {
  return request<OcResponse[]>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/ocs/mine`
  )
}

/** 更新指定 OC */
export function updateOc(
  worldId: string,
  ocId: string,
  payload: UpdateOcRequest
): Promise<OcResponse> {
  return request<OcResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/ocs/${encodeURIComponent(ocId)}`,
    {
      method: 'PUT',
      body: payload
    }
  )
}

// ─── RPG 频道 API ──────────────────────────────────────────────

/** 获取世界观下的 RPG 频道列表 */
export function listChannels(worldId: string): Promise<RpgChannelResponse[]> {
  return request<RpgChannelResponse[]>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels`
  )
}

/** 在指定世界观下创建 RPG 频道 */
export function createChannel(
  worldId: string,
  payload: CreateRpgChannelRequest
): Promise<RpgChannelResponse> {
  return request<RpgChannelResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels`,
    {
      method: 'POST',
      body: payload
    }
  )
}

/** 邀请成员进入私密 RPG 频道 */
export function addChannelMembers(
  worldId: string,
  channelId: string,
  payload: AddRpgChannelMembersRequest
): Promise<RpgChannelResponse> {
  return request<RpgChannelResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels/${encodeURIComponent(channelId)}/members`,
    {
      method: 'POST',
      body: payload
    }
  )
}

/** 将成员移出 RPG 频道 */
export function removeChannelMember(
  worldId: string,
  channelId: string,
  memberUserId: string
): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(memberUserId)}`,
    { method: 'DELETE' }
  )
}

/** 当前成员退出 RPG 频道 */
export function leaveChannel(worldId: string, channelId: string): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels/${encodeURIComponent(channelId)}/leave`,
    { method: 'POST' }
  )
}

/** 上传 OC 头像图片，返回存储文件名和完整访问 URL */
export function uploadOcAvatar(worldId: string, file: File): Promise<UploadImageResponse> {
  const formData = new FormData()
  formData.set('file', file)
  return request<UploadImageResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/ocs/avatar`,
    {
      method: 'POST',
      body: formData
    }
  )
}

export interface ListChannelMessagesParams {
  beforeSentAt?: string | null
  beforeMessageId?: string | null
  limit?: number
}

/** 获取 RPG 频道历史消息 */
export function listChannelMessages(
  worldId: string,
  channelId: string,
  params: ListChannelMessagesParams = {}
): Promise<ChatMessageHistoryResponse> {
  const searchParams = new URLSearchParams()
  if (params.beforeSentAt) {
    searchParams.set('beforeSentAt', params.beforeSentAt)
  }
  if (params.beforeMessageId) {
    searchParams.set('beforeMessageId', params.beforeMessageId)
  }
  if (params.limit != null) {
    searchParams.set('limit', String(params.limit))
  }

  const query = searchParams.toString()
  const path = `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels/${encodeURIComponent(channelId)}/messages`
  return request<ChatMessageHistoryResponse>(query ? `${path}?${query}` : path)
}

/** 撤回 3 分钟内由自己发送的频道消息 */
export function recallChannelMessage(
  worldId: string,
  channelId: string,
  messageId: string
): Promise<ChatMessageResponse> {
  return request<ChatMessageResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/rpg/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/recall`,
    {
      method: 'PATCH'
    }
  )
}
