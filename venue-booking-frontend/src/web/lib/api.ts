// venue-booking-frontend/src/web/lib/api.ts
// 相容舊寫法：提供 apiGet/apiPost/apiPut/apiDelete
// 並強制所有請求帶上 credentials: 'include'

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  ''
).replace(/\/+$/, '')

export function apiUrl(path: string) {
  const clean = path?.startsWith('/') ? path : `/${path || ''}`
  return `${API_BASE}${clean}`
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = input.startsWith('http') ? input : apiUrl(input)

  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    // 重要：跨網域帶 cookie
    credentials: 'include',
  })
  return r
}

export async function apiJson<T = any>(input: string, init: RequestInit = {}) {
  const r = await apiFetch(input, init)
  if (!r.ok) {
    let msg = ''
    try {
      const t = await r.text()
      msg = t?.slice(0, 300) || ''
    } catch {}
    throw new Error(`HTTP ${r.status}${msg ? `: ${msg}` : ''}`)
  }
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await r.json()) as T
  return null as unknown as T
}

// —— 這四個是為了相容你舊的 import ——
// GET / POST / PUT / DELETE 都會自動帶 cookie
export function apiGet<T = any>(path: string) {
  return apiJson<T>(path, { method: 'GET' })
}
export function apiPost<T = any, B = any>(path: string, body?: B) {
  return apiJson<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}
export function apiPut<T = any, B = any>(path: string, body?: B) {
  return apiJson<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
}
export function apiDelete<T = any>(path: string) {
  return apiJson<T>(path, { method: 'DELETE' })
}

// —— Admin API 直接放這支檔案（不必建資料夾）——
export type AdminLoginResp = { ok: true; user: string }
export type AdminMeResp = { user: string | null }
export type AdminReviewListResp = { items: any[] }

export const adminApi = {
  async login(username: string, password: string) {
    return apiJson<AdminLoginResp>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  async me() {
    return apiJson<AdminMeResp>('/api/admin/me', { method: 'GET' })
  },
  async reviewList() {
    return apiJson<AdminReviewListResp>('/api/admin/review', { method: 'GET' })
  },
  async logout() {
    return apiJson<{ ok: true }>('/api/admin/logout', { method: 'POST' })
  },
}
