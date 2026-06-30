import { request } from './http'
import type {
  CreateEntryRequest,
  EntryDetail,
  EntryListItem,
  ListEntriesParams,
  PublishEntryRevisionRequest
} from '@/types/entry'
import type { PageResponse } from '@/types/world'

function buildEntryListQuery(worldId: string, params: ListEntriesParams): string {
  const searchParams = new URLSearchParams()

  if (params.keyword) {
    searchParams.set('keyword', params.keyword)
  }

  if (params.page != null) {
    searchParams.set('page', String(params.page))
  }

  if (params.pageSize != null) {
    searchParams.set('pageSize', String(params.pageSize))
  }

  const query = searchParams.toString()
  const basePath = `/api/worlds/${encodeURIComponent(worldId)}/entries`
  return query ? `${basePath}?${query}` : basePath
}

export function listEntries(
  worldId: string,
  params: ListEntriesParams = {}
): Promise<PageResponse<EntryListItem>> {
  return request<PageResponse<EntryListItem>>(buildEntryListQuery(worldId, params))
}

export function createEntry(worldId: string, payload: CreateEntryRequest): Promise<EntryDetail> {
  return request<EntryDetail>(`/api/worlds/${encodeURIComponent(worldId)}/entries`, {
    method: 'POST',
    body: payload
  })
}

export function getEntryDetail(worldId: string, entryId: string): Promise<EntryDetail> {
  return request<EntryDetail>(
    `/api/worlds/${encodeURIComponent(worldId)}/entries/${encodeURIComponent(entryId)}`
  )
}

export function publishEntryRevision(
  worldId: string,
  entryId: string,
  payload: PublishEntryRevisionRequest
): Promise<EntryDetail> {
  return request<EntryDetail>(
    `/api/worlds/${encodeURIComponent(worldId)}/entries/${encodeURIComponent(entryId)}/revisions`,
    {
      method: 'POST',
      body: payload
    }
  )
}

/** 删除词条 */
export function deleteEntry(worldId: string, entryId: string): Promise<void> {
  return request<void>(
    `/api/worlds/${encodeURIComponent(worldId)}/entries/${encodeURIComponent(entryId)}`,
    { method: 'DELETE' }
  )
}
