export interface EntryAuthor {
  userId: string
  nickname: string
}

export interface EntryListItem {
  entryId: string
  worldId: string
  title: string
  summary: string
  tags: string[]
  updatedAt: string
}

export interface EntryLinkedEntry {
  entryId: string
  title: string
  summary: string
}

export interface EntryRevision {
  revisionId: string
  content: string
  author: EntryAuthor
  createdAt: string
  current: boolean
}

export interface EntryDetail {
  entryId: string
  worldId: string
  title: string
  currentRevisionId: string
  content: string
  tags: string[]
  author: EntryAuthor
  linkedEntries: EntryLinkedEntry[]
  revisions: EntryRevision[]
  createdAt: string
  updatedAt: string
}

export interface CreateEntryRequest {
  title: string
  content: string
  tags: string[]
}

export interface PublishEntryRevisionRequest {
  title: string
  content: string
  tags: string[]
}

export interface ListEntriesParams {
  keyword?: string
  page?: number
  pageSize?: number
}
