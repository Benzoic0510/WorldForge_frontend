import type { ApiErrorPayload, ApiResponse } from '@/types/common'

export class ApiError extends Error {
  code: string
  traceId?: string
  status: number
  rawMessage: string

  constructor(payload: ApiErrorPayload & { status: number }) {
    super(toFriendlyApiMessage(payload))
    this.name = 'ApiError'
    this.code = payload.code
    this.traceId = payload.traceId
    this.status = payload.status
    this.rawMessage = payload.message
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

const EXACT_ERROR_MESSAGE_MAP: Record<string, string> = {
  Unauthorized: '请先登录后再继续操作',
  'World not found': '世界不存在或已被删除',
  'Source world not found': '源世界不存在或已被删除',
  'World ID is required': '缺少世界 ID，请刷新页面后重试',
  'Source world ID is required': '缺少源世界 ID，请刷新页面后重试',
  'No permission to access this world': '你没有权限访问这个世界',
  'This world does not allow fork': '这个世界不允许被复刻',
  'Source world policy is missing': '源世界权限配置缺失，请联系创建者处理',
  'This world cannot be joined directly': '这个世界不能直接加入',
  'Only protected worlds accept join requests': '只有受保护世界可以提交加入申请',
  'User is already a member of this world': '你已经是这个世界的成员',
  'User already has a pending join request': '你已经提交过加入申请，请等待审核',
  'Join request message must be at most 500 characters': '申请说明不能超过 500 个字符',
  'Join request ID is required': '缺少申请 ID，请刷新页面后重试',
  'Decision must be approve or reject': '请选择通过或拒绝',
  'Review comment must be at most 500 characters': '审核备注不能超过 500 个字符',
  'Join request not found': '加入申请不存在或已被删除',
  'Join request has already been reviewed': '这条加入申请已经被处理',
  'Requester is already a member of this world': '申请人已经是这个世界的成员',
  'inviteeUserId is required': '请选择要邀请的用户',
  'Cannot invite yourself': '不能邀请自己',
  'Invitee not found': '要邀请的用户不存在',
  'Invitee is already a member of this world': '该用户已经是这个世界的成员',
  'Role must be contributor or co_admin': '邀请身份只能是贡献者或共同管理员',
  'expiresInHours must be between 1 and 720': '邀请有效期必须在 1 到 720 小时之间',
  'There is already a pending invitation for this user': '已经向该用户发送过邀请，请等待对方处理',
  'Invitation ID is required': '缺少邀请 ID，请刷新消息后重试',
  'Invitation not found': '邀请不存在或已被删除',
  'Invitation is no longer available': '这条邀请已经被处理或失效',
  'Invitation has expired': '这条邀请已过期',
  'Invitation is not for this user': '这条邀请不属于当前账号',
  'Invite code is required': '请输入邀请码',
  'Only world members can view members': '只有世界成员可以查看成员列表',
  'Only creator or co_admin can edit world settings': '只有创建者或共同管理员可以编辑世界设置',
  'Only creator can delete world': '只有创建者可以删除世界',
  'World delete failed because the resource changed': '世界状态已变化，请刷新后再删除',
  'Only world managers can perform this operation': '只有世界管理者可以执行此操作',
  'Only creator or co_admin can upload world image': '只有创建者或共同管理员可以上传世界封面',
  'Only world members can upload OC avatar': '只有世界成员可以上传角色头像',
  'Only creator or co_admin can create public channels': '只有创建者或共同管理员可以创建公开频道',
  'memberUserIds must all be world members': '频道成员必须都是当前世界成员',
  'name is required': '请输入名称',
  'name must be at most 50 characters': '名称不能超过 50 个字符',
  'channelType must be public or private': '频道类型不正确',
  'channel name already exists': '频道名称已存在',
  'beforeSentAt must be ISO-8601 datetime': '消息时间参数格式不正确',
  'messageId is required': '缺少消息 ID，请刷新后重试',
  'Page and pageSize must be positive': '分页参数不正确，请刷新后重试',
  'Status must be pending, approved, rejected, or all': '筛选状态不正确，请刷新后重试',
  'World name must be 2 to 50 characters': '世界名称需为 2 到 50 个字符',
  'World description must be at most 500 characters': '世界简介不能超过 500 个字符',
  'Cover image URL must be at most 255 characters': '封面地址不能超过 255 个字符',
  'Visibility must be public, protected, or private': '世界可见性设置不正确',
  'World can have at most 10 tags': '世界标签最多 10 个',
  'Each tag must be at most 20 characters': '每个标签不能超过 20 个字符',
  'worldId is required': '缺少世界 ID，请刷新页面后重试',
  'notificationId 不能为空': '缺少通知 ID，请刷新页面后重试'
}

const CODE_ERROR_MESSAGE_MAP: Record<string, string> = {
  UNAUTHORIZED: '请先登录后再继续操作',
  ACCESS_TOKEN_EXPIRED: '登录状态已过期，请重新登录',
  FORBIDDEN: '你没有权限执行此操作',
  NOT_FOUND: '请求的内容不存在或已被删除',
  CONFLICT: '当前内容状态已变化，请刷新后重试',
  BAD_REQUEST: '请求信息不完整或格式不正确，请检查后重试',
  INVALID_RESPONSE: '服务器返回了无法解析的响应',
  REQUEST_TIMEOUT: '请求超时，请检查服务是否已启动',
  INTERNAL_ERROR: '服务器暂时不可用，请稍后重试'
}

function hasChineseText(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

function toFriendlyApiMessage(payload: ApiErrorPayload & { status: number }): string {
  const rawMessage = payload.message?.trim() || ''

  if (rawMessage && hasChineseText(rawMessage)) {
    return rawMessage
  }

  if (rawMessage && EXACT_ERROR_MESSAGE_MAP[rawMessage]) {
    return EXACT_ERROR_MESSAGE_MAP[rawMessage]
  }

  if (payload.code && CODE_ERROR_MESSAGE_MAP[payload.code]) {
    return CODE_ERROR_MESSAGE_MAP[payload.code]
  }

  if (payload.status === 401) return CODE_ERROR_MESSAGE_MAP.UNAUTHORIZED
  if (payload.status === 403) return CODE_ERROR_MESSAGE_MAP.FORBIDDEN
  if (payload.status === 404) return CODE_ERROR_MESSAGE_MAP.NOT_FOUND
  if (payload.status === 409) return CODE_ERROR_MESSAGE_MAP.CONFLICT
  if (payload.status >= 500) return CODE_ERROR_MESSAGE_MAP.INTERNAL_ERROR

  return rawMessage || '操作失败，请稍后重试'
}

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
