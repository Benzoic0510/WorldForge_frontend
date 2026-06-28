const DEFAULT_API_PROXY_TARGET = 'http://38.22.95.108:8080'

export async function onRequest({ request, env, params }) {
  const targetOrigin = (env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET).replace(/\/$/, '')
  const sourceUrl = new URL(request.url)
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '')
  const targetUrl = new URL(`${targetOrigin}/api/${path}`)
  targetUrl.search = sourceUrl.search

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
