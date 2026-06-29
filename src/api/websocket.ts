const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export function buildWebSocketUrl(path = '/api/ws'): URL {
  const base = API_BASE_URL || `${window.location.protocol}//${window.location.host}`
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}
