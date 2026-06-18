import { request } from './http'
import type { SaveDraftRequest, SaveDraftResponse } from '@/types/draft'

export function saveDraft(
  worldId: string,
  draftId: string,
  payload: SaveDraftRequest
): Promise<SaveDraftResponse> {
  return request<SaveDraftResponse>(
    `/api/worlds/${encodeURIComponent(worldId)}/drafts/${encodeURIComponent(draftId)}`,
    { method: 'PUT', body: payload }
  )
}
