export interface SaveDraftRequest {
  title: string
  contentType: 'entry' | 'storyline'
  content: string
  targetEntryId?: string | null
  targetLineId?: string | null
  tags?: string[]
  linkedEntryIds?: string[]
}

export interface SaveDraftResponse {
  draftId: string
  worldId: string
  title: string
  contentType: string
  targetEntryId: string | null
  targetLineId: string | null
  status: string
  savedAt: string
  version: number
}
