const DEFAULT_API_PROXY_TARGET = 'http://38.22.95.108.sslip.io:8080'

export async function onRequest({ request, env, params }) {
  const targetOrigin = resolveTargetOrigin(env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET)
  const sourceUrl = new URL(request.url)
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
  const headers = new Headers(request.headers)
  const targetOrigin = `${targetUrl.protocol}//${targetUrl.host}`

  headers.set('origin', targetOrigin)
  headers.set('x-forwarded-host', new URL(request.url).host)
  headers.set('x-forwarded-proto', new URL(request.url).protocol.replace(':', ''))

  return fetch(targetUrl, {
    method: request.method,
    headers
  })
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
