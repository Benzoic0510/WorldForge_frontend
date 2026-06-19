import { request } from './http'
import type { ChangeLogItem, ListChangeLogParams } from '@/types/changelog'
import type { PageResponse } from '@/types/world'

function buildChangeLogQuery(worldId: string, params: ListChangeLogParams): string {
  const searchParams = new URLSearchParams()

  if (params.page != null) {
    searchParams.set('page', String(params.page))
  }

  if (params.pageSize != null) {
    searchParams.set('pageSize', String(params.pageSize))
  }

  const query = searchParams.toString()
  const basePath = `/api/worlds/${encodeURIComponent(worldId)}/read/changelog`
  return query ? `${basePath}?${query}` : basePath
}

export function listChangeLog(
  worldId: string,
  params: ListChangeLogParams = {}
): Promise<PageResponse<ChangeLogItem>> {
  return request<PageResponse<ChangeLogItem>>(buildChangeLogQuery(worldId, params))
}
