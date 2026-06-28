const DEFAULT_API_PROXY_TARGET = 'http://38.22.95.108:8080'

export async function onRequest({ request, env, params }) {
  const targetOrigin = (env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET).replace(/\/$/, '')
  const sourceUrl = new URL(request.url)
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '')
  const targetUrl = new URL(`${targetOrigin}/api/${path}`)
  targetUrl.search = sourceUrl.search

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('connection')
  headers.delete('content-length')
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
