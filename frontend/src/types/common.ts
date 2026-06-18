export interface ApiResponse<T> {
  success: boolean
  code: string
  message: string
  data: T
  traceId: string
  timestamp: string
}

export interface ApiErrorPayload {
  code: string
  message: string
  traceId?: string
}
