export async function onRequest({ request, env, params }) {
  const sourceUrl = new URL(request.url)
  const configuredTarget = resolveConfiguredTarget(env, sourceUrl)
  if (configuredTarget instanceof Response) {
    return configuredTarget
  }
  const targetOrigin = resolveTargetOrigin(configuredTarget)
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '')
  const targetUrl = new URL(`${targetOrigin}/api/${path}`)
  targetUrl.search = sourceUrl.search

  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    return proxyWebSocket(request, targetUrl)
  }

  const headers = buildProxyHeaders(request.headers)
  headers.set('x-forwarded-host', sourceUrl.host)
  headers.set('x-forwarded-proto', sourceUrl.protocol.replace(':', ''))

  const init = {
    method: request.method,
    headers,
    redirect: 'manual'
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  return fetch(targetUrl, init)
}

function proxyWebSocket(request, targetUrl) {
  const proxiedRequest = new Request(targetUrl, request)
  const headers = new Headers(proxiedRequest.headers)
  const sourceUrl = new URL(request.url)

  headers.set('x-forwarded-host', sourceUrl.host)
  headers.set('x-forwarded-proto', sourceUrl.protocol.replace(':', ''))

  return fetch(new Request(proxiedRequest, { headers }))
}

function resolveConfiguredTarget(env, sourceUrl) {
  const configured = env.API_PROXY_TARGET || env.VITE_API_PROXY_TARGET
  if (configured) {
    return configured
  }

  if (sourceUrl.hostname === 'localhost' || sourceUrl.hostname === '127.0.0.1') {
    return 'http://localhost:8080'
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: 'API_PROXY_TARGET_MISSING',
      message: 'Cloudflare Pages 环境变量 API_PROXY_TARGET 未配置',
      data: null
    }),
    {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

function resolveTargetOrigin(value) {
  const url = new URL(value)

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)) {
    url.hostname = `${url.hostname}.sslip.io`
  }

  url.pathname = ''
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}

function buildProxyHeaders(sourceHeaders) {
  const headers = new Headers()
  const allowedHeaders = [
    'accept',
    'accept-language',
    'authorization',
    'content-type',
    'cookie',
    'origin',
    'referer',
    'user-agent'
  ]

  for (const name of allowedHeaders) {
    const value = sourceHeaders.get(name)
    if (value) {
      headers.set(name, value)
    }
  }

  return headers
}
