// venue-booking-frontend/src/web/lib/api.ts
// 相容舊寫法：提供 apiGet / apiPost / apiPut / apiDelete
// ★ 強制所有請求帶上 credentials: 'include'
// ★ 支援兩種模式：
//   1) 前端反向代理（推薦）：VITE_USE_FRONTEND_PROXY=1，程式就用相對路徑 /api/...（第一方 cookie，不會被「封鎖第三方 Cookie」影響）
//   2) 直連後端網址：設定 VITE_API_BASE_URL（或相容舊變數 VITE_API_BASE）

// ---- API Base 決策 ----
const DEFAULT_DIRECT_BASE = 'https://venue-booking-api-rjes.onrender.com'
const DEFAULT_API_BASE =
  import.meta.env.VITE_USE_FRONTEND_PROXY === '1'
    ? '' // 走同源代理：/api/...
    : DEFAULT_DIRECT_BASE

const RAW_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  DEFAULT_API_BASE

const API_BASE = (RAW_BASE || '').replace(/\/+$/, '')

// ---- Helper: 判斷是否為絕對 URL ----
function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u)
}

// ---- URL 組裝 ----
export function apiUrl(path: string) {
  const clean = path?.startsWith('/') ? path : `/${path || ''}`
  // 若採用前端代理（API_BASE===''），直接回相對路徑，讓瀏覽器打同源的 /api/...
  if (API_BASE === '') return clean
  return `${API_BASE}${clean}`
}

// ---- 統一 fetch（必帶 credentials）----
export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = isAbsoluteUrl(input) ? input : apiUrl(input)
  const headers = new Headers(init.headers || {})
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const r = await fetch(url, {
    ...init,
    headers,
    // 重要：跨站情境/同站皆帶 cookie
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
    } catch { /* ignore */ }
    throw new Error(`HTTP ${r.status}${msg ? `: ${msg}` : ''}`)
  }
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await r.json()) as T
  // 沒有內容（例如 204）或非 JSON，就回 null
  return null as unknown as T
}

// —— 相容舊的四個 helper —— //
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

// ===== Admin API（型別與你後端對齊） =====
export type AdminUser = { id: string; role: string; name: string }

export type AdminLoginResp = { ok: true; user: AdminUser }
export type AdminMeResp = {
  authenticated?: boolean
  loggedIn?: boolean
  user: AdminUser | null
}
export type ReviewStats = { pending: number; approved: number; rejected: number; cancelled: number }
export type AdminReviewListResp = { items: any[]; stats: ReviewStats }

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
  async reviewList(params?: { days?: number; venue?: string; showFinished?: boolean; q?: string }) {
    const qs = new URLSearchParams()
    if (params?.days != null) qs.set('days', String(params.days))
    if (params?.venue) qs.set('venue', params.venue)
    if (params?.showFinished != null) qs.set('showFinished', params.showFinished ? 'true' : 'false')
    if (params?.q) qs.set('q', params.q)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiJson<AdminReviewListResp>(`/api/admin/review${suffix}`, { method: 'GET' })
  },
  async logout() {
    return apiJson<{ ok: true }>('/api/admin/logout', { method: 'POST' })
  },
}

// =====（可選）條款 API，小工具 =====
export type TermsStatusResp = { ok: true; enabled: boolean; version: string; url: string | null; accepted: boolean; accepted_at: string | null }
export const termsApi = {
  status() { return apiJson<TermsStatusResp>('/api/terms/status') },
  accept(email?: string) {
    return apiJson<{ ok: true; accepted_at: string }>('/api/terms/accept', {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    })
  },
}
