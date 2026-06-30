export type WorldSortBy = '' | 'createdAt' | 'hot'
export type WorldVisibility = 'public' | 'private' | 'protected'

export interface PageResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface WorldCreator {
  userId: string
  nickname: string
  avatarUrl?: string
}

export interface WorldStats {
  entryCount: number
  memberCount: number
  forkCount: number
}

export interface WorldViewer {
  role: 'creator' | 'co_admin' | 'contributor' | null
  canEdit: boolean
  canReview: boolean
}

export interface WorldListItem {
  worldId: string
  name: string
  description: string
  tags: string[]
  coverImageUrl: string
  visibility: WorldVisibility
  creator: WorldCreator
  entryCount: number
  updatedAt: string
  role?: 'creator' | 'co_admin' | 'contributor'
}

export interface WorldDetail {
  worldId: string
  name: string
  description: string
  tags: string[]
  coverImageUrl: string
  visibility: WorldVisibility
  allowFork: boolean
  allowMerge: boolean
  creator: WorldCreator
  stats: WorldStats
  viewer: WorldViewer
  createdAt: string
  updatedAt: string
}

export interface WorldMember {
  userId: string
  username: string
  nickname: string
  avatarUrl: string
  role: 'creator' | 'co_admin' | 'contributor'
  joinedAt: string
}

export interface CreateWorldRequest {
  name: string
  description: string
  tags: string[]
  coverImageUrl: string
  visibility: WorldVisibility
  allowFork: boolean
  allowMerge: boolean
}

export interface UpdateWorldRequest {
  name: string
  description: string
  tags: string[]
  coverImageUrl: string
  visibility: WorldVisibility
  allowFork: boolean
  allowMerge: boolean
}

export interface CreateWorldResponse {
  worldId: string
  name: string
  creatorId: string
  visibility: WorldVisibility
  allowFork: boolean
  allowMerge: boolean
  createdAt: string
}

export interface ForkWorldRequest {
  name?: string
  description?: string
  tags?: string[]
  coverImageUrl?: string
  visibility?: WorldVisibility
  allowFork?: boolean
  allowMerge?: boolean
}

export interface ForkWorldResponse {
  worldId: string
  sourceWorldId: string
  name: string
  creatorId: string
  visibility: string
  allowFork: boolean
  allowMerge: boolean
  createdAt: string
}

export interface ListWorldsParams {
  keyword?: string
  sortBy?: WorldSortBy
  tags?: string
  page?: number
  pageSize?: number
}

// --- Join / Invitation ---

export interface JoinWorldResponse {
  worldId: string
  userId: string
  role: string
  joinedAt: string
}

export interface ApplyJoinWorldRequest {
  message?: string
}

export interface WorldJoinRequestResponse {
  requestId: string
  worldId: string
  requesterId: string
  requesterUsername?: string | null
  requesterNickname?: string | null
  message: string
  status: string
  reviewedBy: string | null
  reviewComment: string
  requestedAt: string
  reviewedAt: string | null
}

export interface ListJoinWorldRequestsParams {
  status?: 'pending' | 'approved' | 'rejected' | 'all'
  page?: number
  pageSize?: number
}

export interface ReviewJoinWorldRequest {
  decision: 'approve' | 'reject'
  comment?: string
}

export interface UpdateWorldMemberRoleRequest {
  role: 'contributor' | 'co_admin'
}

export interface CreateWorldInvitationRequest {
  inviteeUserId: string
  role: 'contributor' | 'co_admin'
  expiresInHours?: number
}

export interface WorldInvitationResponse {
  invitationId: string
  worldId: string
  inviteCode: string | null
  inviteeUserId: string | null
  role: string
  createdBy: string
  expiresAt: string
  createdAt: string
}

export interface AcceptWorldInvitationRequest {
  inviteCode: string
}

export interface UploadImageResponse {
  fileName: string
  url: string
}
