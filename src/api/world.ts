import { request } from './http'
import type {
  AcceptWorldInvitationRequest,
  ApplyJoinWorldRequest,
  CreateWorldInvitationRequest,
  CreateWorldRequest,
  CreateWorldResponse,
  ForkWorldRequest,
  ForkWorldResponse,
  JoinWorldResponse,
  ListJoinWorldRequestsParams,
  ListWorldsParams,
  PageResponse,
  ReviewJoinWorldRequest,
  UpdateWorldMemberRoleRequest,
  UpdateWorldRequest,
  UploadImageResponse,
  WorldDetail,
  WorldInvitationResponse,
  WorldJoinRequestResponse,
  WorldMember,
  WorldListItem
} from '@/types/world'

function buildWorldListQuery(basePath: string, params: ListWorldsParams): string {
  const searchParams = new URLSearchParams()

  if (params.keyword) {
    searchParams.set('keyword', params.keyword)
  }

  if (params.sortBy) {
    searchParams.set('sortBy', params.sortBy)
  }

  if (params.tags) {
    searchParams.set('tags', params.tags)
  }

  if (params.page != null) {
    searchParams.set('page', String(params.page))
  }

  if (params.pageSize != null) {
    searchParams.set('pageSize', String(params.pageSize))
  }

  const query = searchParams.toString()
  return query ? `${basePath}?${query}` : basePath
}

export function listWorlds(
  params: ListWorldsParams = {}
): Promise<PageResponse<WorldListItem>> {
  return request<PageResponse<WorldListItem>>(buildWorldListQuery('/api/worlds', params))
}

export function listMyWorlds(
  params: ListWorldsParams = {}
): Promise<PageResponse<WorldListItem>> {
  return request<PageResponse<WorldListItem>>(buildWorldListQuery('/api/worlds/mine', params))
}

export function getWorldDetail(worldId: string): Promise<WorldDetail> {
  return request<WorldDetail>(`/api/worlds/${encodeURIComponent(worldId)}`)
}

export function listWorldMembers(worldId: string): Promise<WorldMember[]> {
  return request<WorldMember[]>(`/api/worlds/${encodeURIComponent(worldId)}/members`)
}

export function updateWorldMemberRole(
  worldId: string,
  memberUserId: string,
  payload: UpdateWorldMemberRoleRequest
): Promise<WorldMember> {
  return request<WorldMember>(
    `/api/worlds/${encodeURIComponent(worldId)}/members/${encodeURIComponent(memberUserId)}`,
    { method: 'PATCH', body: payload }
  )
}

export function removeWorldMember(worldId: string, memberUserId: string): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/members/${encodeURIComponent(memberUserId)}`,
    { method: 'DELETE' }
  )
}

export function leaveWorld(worldId: string): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/leave`,
    { method: 'POST' }
  )
}

export function createWorld(payload: CreateWorldRequest): Promise<CreateWorldResponse> {
  return request<CreateWorldResponse>('/api/worlds', {
    method: 'POST',
    body: payload
  })
}

export function uploadWorldImage(worldId: string, file: File): Promise<UploadImageResponse> {
  const formData = new FormData()
  formData.set('file', file)
  return request<UploadImageResponse>(`/api/worlds/${encodeURIComponent(worldId)}/image`, {
    method: 'POST',
    body: formData
  })
}

export function updateWorld(worldId: string, payload: UpdateWorldRequest): Promise<WorldDetail> {
  return request<WorldDetail>(`/api/worlds/${encodeURIComponent(worldId)}`, {
    method: 'PUT',
    body: payload
  })
}

export function deleteWorld(worldId: string): Promise<void> {
  return request<void>(`/api/worlds/${encodeURIComponent(worldId)}`, {
    method: 'DELETE'
  })
}

export function forkWorld(
  worldId: string,
  payload?: ForkWorldRequest
): Promise<ForkWorldResponse> {
  return request<ForkWorldResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/fork`,
    { method: 'POST', body: payload || {} }
  )
}

export function joinWorld(worldId: string): Promise<JoinWorldResponse> {
  return request<JoinWorldResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/join`,
    { method: 'POST' }
  )
}

export function applyJoinWorld(
  worldId: string,
  payload?: ApplyJoinWorldRequest
): Promise<WorldJoinRequestResponse> {
  return request<WorldJoinRequestResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/join-requests`,
    { method: 'POST', body: payload || {} }
  )
}

export function listJoinWorldRequests(
  worldId: string,
  params: ListJoinWorldRequestsParams = {}
): Promise<PageResponse<WorldJoinRequestResponse>> {
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
  const path = `/api/worlds/${encodeURIComponent(worldId)}/join-requests`
  return request<PageResponse<WorldJoinRequestResponse>>(query ? `${path}?${query}` : path)
}

export function reviewJoinRequest(
  worldId: string,
  requestId: string,
  payload: ReviewJoinWorldRequest
): Promise<WorldJoinRequestResponse> {
  return request<WorldJoinRequestResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/join-requests/${encodeURIComponent(requestId)}/review`,
    { method: 'PATCH', body: payload }
  )
}

export function createWorldInvitation(
  worldId: string,
  payload?: CreateWorldInvitationRequest
): Promise<WorldInvitationResponse> {
  return request<WorldInvitationResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/invitations`,
    { method: 'POST', body: payload || {} }
  )
}

export function acceptWorldInvitation(
  worldId: string,
  payload: AcceptWorldInvitationRequest
): Promise<JoinWorldResponse> {
  return request<JoinWorldResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/invitations/accept`,
    { method: 'POST', body: payload }
  )
}

export function acceptWorldInvitationById(
  worldId: string,
  invitationId: string
): Promise<JoinWorldResponse> {
  return request<JoinWorldResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/invitations/${encodeURIComponent(invitationId)}/accept`,
    { method: 'POST' }
  )
}

export function rejectWorldInvitation(
  worldId: string,
  invitationId: string
): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/invitations/${encodeURIComponent(invitationId)}/reject`,
    { method: 'POST' }
  )
}
