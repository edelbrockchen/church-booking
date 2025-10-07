// venue-booking-frontend/src/web/lib/api.ts
// Unified API client with CORS credentials support.

const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')

export function apiUrl(path: string) {
  if (!path) path = '/'
  const clean = path.startsWith('/') ? path : `/${path}`
  if (clean.includes(':splat')) {
    const err = new Error(`Invalid API path contains ":splat": ${clean}`)
    console.error(err)
    throw err
  }
  return `${API_BASE}${clean}`
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method: 'GET',
    credentials: 'include', // ★ carry session cookie
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export async function apiPost<T>(path: string, body?: any): Promise<T> {
  const r = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include', // ★ carry session cookie
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

// helpers for admin auth
export const adminApi = {
  login: (username: string, password: string) => apiPost<{ok: true, user: {username: string}}>('/api/admin/login', { username, password }),
  me: () => apiGet<{user: {username: string} | null}>('/api/admin/me'),
  logout: () => apiPost<{ok: true}>('/api/admin/logout', {}),
}
