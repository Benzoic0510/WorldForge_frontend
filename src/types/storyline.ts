export interface StoryGraphNode {
  nodeId: string
  lineId: string
  label: string
  name: string
  description: string
  type: 'main' | 'fork' | 'merge'
  createdBy: string
  createdAt: string
}

export interface StoryGraphEdge {
  from: string
  to: string
  parentLineId: string
  childLineId: string
  basedOnPushId: string | null
  basedOnPushTitle: string | null
  label: string
  createdAt: string
}

export interface StoryGraphData {
  nodes: StoryGraphNode[]
  edges: StoryGraphEdge[]
}

export interface PushGraphNode {
  nodeId: string
  pushId: string
  lineId: string
  title: string
  content?: string
  lineType: 'main' | 'fork' | 'merge'
  lineName: string
  authorId: string
  authorNickname: string
  submittedAt: string
  sequenceIndex: number
  isPlaceholder?: boolean
  isHead?: boolean
}

export interface PushGraphEdge {
  edgeId: string
  from: string
  to: string
  edgeType: 'sequential' | 'fork' | 'merge'
  label: string
  fromLineId: string
  toLineId: string
  basedOnPushTitle: string | null
}

export interface PushGraphData {
  nodes: PushGraphNode[]
  edges: PushGraphEdge[]
}

export interface CreateForkLineRequest {
  name: string
  description: string
  basedOnLineId: string
  basedOnPushId: string
}

export interface CreateForkLineResponse {
  lineId: string
  worldId: string
  name: string
  description: string
  type: string
  basedOnLineId: string
  basedOnPushId: string | null
  createdBy: string
  createdAt: string
}

export interface MergeParentRequest {
  lineId: string
}

export interface MergeParentResponse {
  parentLineId: string
  basedOnPushId: string | null
}

export interface CreateMergeLineRequest {
  name: string
  description: string
  parents: MergeParentRequest[]
}

export interface CreateMergeLineResponse {
  lineId: string
  worldId: string
  name: string
  description: string
  type: string
  parents: MergeParentResponse[]
  createdBy: string
  createdAt: string
}

export interface StoryLineParent {
  parentLineId: string
  parentLineName: string
  basedOnPushId: string | null
  basedOnPushTitle: string | null
}

export interface StoryLineDetail {
  lineId: string
  worldId: string
  name: string
  description: string
  type: string
  createdBy: string
  createdAt: string
  latestVisiblePushId: string | null
  latestVisiblePushTitle: string | null
  parents: StoryLineParent[]
}

export interface SubmitStoryPushRequest {
  draftId: string
  targetLineId: string
  summary: string
  basedOnPushId?: string | null
  isNewBranch?: boolean
  newBranchName?: string
}

export interface SubmitStoryPushResponse {
  submissionId: string
  worldId: string
  targetLineId: string
  status: string
  title?: string
  summary: string
  submittedAt: string
}

export interface PageResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface SubmissionSubmitter {
  userId: string
  nickname: string
}

export interface SubmissionListItem {
  submissionId: string
  title?: string
  summary: string
  content?: string
  submitter: SubmissionSubmitter
  targetLineId: string
  basedOnPushId: string | null
  basedOnPushTitle: string | null
  latestPushId: string | null
  latestPushTitle: string | null
  status: 'pending_review' | 'approved' | 'rejected'
  submittedAt: string
}

export interface StoryPushDetail {
  submissionId: string
  worldId: string
  targetLineId: string
  basedOnPushId: string | null
  basedOnPushTitle: string | null
  latestPushId: string | null
  latestPushTitle: string | null
  title?: string
  summary: string
  content: string
  submitter: SubmissionSubmitter
  status: 'pending_review' | 'approved' | 'rejected'
  reviewComment: string
  submittedAt: string
  updatedAt: string
}

export interface ReviewSubmissionRequest {
  decision: 'approve' | 'reject'
  comment?: string
}

export interface ReviewSubmissionResponse {
  submissionId: string
  status: string
  reviewedBy: string
  comment: string
  reviewedAt: string
  snapshotId: string | null
}
