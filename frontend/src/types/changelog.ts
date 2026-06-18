export interface ChangeLogItem {
  changelogId: string
  targetType: string
  actionType: string
  targetId: string
  title: string
  lineId: string
  lineName: string
  summary: string
  occurredAt: string
}

export interface ListChangeLogParams {
  page?: number
  pageSize?: number
}
