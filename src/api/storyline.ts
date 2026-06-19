import { request } from './http'
import type {
  CreateForkLineRequest,
  CreateForkLineResponse,
  CreateMergeLineRequest,
  CreateMergeLineResponse,
  PageResponse,
  ReviewSubmissionRequest,
  ReviewSubmissionResponse,
  StoryGraphData,
  StoryLineDetail,
  StoryPushDetail,
  SubmissionListItem,
  SubmitStoryPushRequest,
  SubmitStoryPushResponse
} from '@/types/storyline'

export function getStoryGraph(worldId: string): Promise<StoryGraphData> {
  return request<StoryGraphData>(
    `/api/worlds/${encodeURIComponent(worldId)}/read/story-graph`
  )
}

export function createForkLine(
  worldId: string,
  payload: CreateForkLineRequest
): Promise<CreateForkLineResponse> {
  return request<CreateForkLineResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/lines`,
    { method: 'POST', body: payload }
  )
}

export function createMergeLine(
  worldId: string,
  payload: CreateMergeLineRequest
): Promise<CreateMergeLineResponse> {
  return request<CreateMergeLineResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/lines/merge`,
    { method: 'POST', body: payload }
  )
}

export function getStoryLineDetail(lineId: string): Promise<StoryLineDetail> {
  return request<StoryLineDetail>(
    `/api/collaboration/lines/${encodeURIComponent(lineId)}`
  )
}

export function submitStoryPush(
  worldId: string,
  payload: SubmitStoryPushRequest
): Promise<SubmitStoryPushResponse> {
  return request<SubmitStoryPushResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/submissions`,
    { method: 'POST', body: payload }
  )
}

interface ListSubmissionsParams {
  status?: string
  lineId?: string
  page?: number
  pageSize?: number
}

export function listSubmissions(
  worldId: string,
  params: ListSubmissionsParams = {}
): Promise<PageResponse<SubmissionListItem>> {
  const url = new URL(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/submissions`,
    window.location.origin
  )
  if (params.status) url.searchParams.set('status', params.status)
  if (params.lineId) url.searchParams.set('lineId', params.lineId)
  if (params.page != null) url.searchParams.set('page', String(params.page))
  if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))

  return request<PageResponse<SubmissionListItem>>(
    url.pathname + url.search
  )
}

export function listApprovedStoryPushes(worldId: string): Promise<SubmissionListItem[]> {
  return request<SubmissionListItem[]>(
    `/api/worlds/${encodeURIComponent(worldId)}/read/approved-pushes`
  )
}

export function reviewSubmission(
  worldId: string,
  submissionId: string,
  payload: ReviewSubmissionRequest
): Promise<ReviewSubmissionResponse> {
  return request<ReviewSubmissionResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/submissions/${encodeURIComponent(submissionId)}/review`,
    { method: 'PATCH', body: payload }
  )
}

export function getStoryPushDetail(
  worldId: string,
  submissionId: string
): Promise<StoryPushDetail> {
  return request<StoryPushDetail>(
    `/api/worlds/${encodeURIComponent(worldId)}/collaboration/submissions/${encodeURIComponent(submissionId)}`
  )
}
