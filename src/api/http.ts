import type { ApiErrorPayload, ApiResponse } from '@/types/common'

export class ApiError extends Error {
  code: string
  traceId?: string
  status: number

  constructor(payload: ApiErrorPayload & { status: number }) {
    super(payload.message)
    this.name = 'ApiError'
    this.code = payload.code
    this.traceId = payload.traceId
    this.status = payload.status
  }
}

type RequestBody = BodyInit | object | null | undefined

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: RequestBody
  _isRetry?: boolean
  skipAuthRefresh?: boolean
}

const REQUEST_TIMEOUT_MS = 5000
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

let refreshTokenCallback: (() => Promise<unknown>) | null = null

export function setRefreshTokenCallback(cb: () => Promise<unknown>) {
  refreshTokenCallback = cb
}

function buildRequestBody(body: RequestBody): BodyInit | undefined {
  if (body == null) {
    return undefined
  }

  if (body instanceof FormData || body instanceof Blob || typeof body === 'string') {
    return body
  }

  return JSON.stringify(body)
}

function buildHeaders(body: RequestBody, headers?: HeadersInit): Headers {
  const result = new Headers(headers)

  if (
    body != null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !result.has('Content-Type')
  ) {
    result.set('Content-Type', 'application/json')
  }

  if (!result.has('Accept')) {
    result.set('Accept', 'application/json')
  }

  return result
}

async function parseJson<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return await response.json()
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: '服务器返回了无法解析的响应'
    })
  }
}

async function doFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response

  try {
    response = await fetch(buildRequestUrl(path), {
      ...options,
      body: buildRequestBody(options.body),
      credentials: 'include',
      headers: buildHeaders(options.body, options.headers),
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError({
        status: 408,
        code: 'REQUEST_TIMEOUT',
        message: '请求超时，请检查服务是否已启动'
      })
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

  const payload = await parseJson<T>(response)

  if (!response.ok || !payload.success) {
    throw new ApiError({
      status: response.status,
      code: payload.code,
      message: payload.message,
      traceId: payload.traceId
    })
  }

  return payload.data
}

function buildRequestUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || !API_BASE_URL) {
    return path
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

const RETRYABLE_AUTH_CODES = new Set(['ACCESS_TOKEN_EXPIRED', 'UNAUTHORIZED'])

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await doFetch<T>(path, options)
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 401 ||
      !RETRYABLE_AUTH_CODES.has(error.code) ||
      options._isRetry ||
      options.skipAuthRefresh ||
      !refreshTokenCallback
    ) {
      throw error
    }

    try {
      await refreshTokenCallback()
    } catch {
      throw error
    }

    return await doFetch<T>(path, { ...options, _isRetry: true })
  }
}
