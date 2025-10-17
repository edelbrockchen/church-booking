// venue-booking-frontend/src/web/lib/api.ts
// 統一封裝前端呼叫後端 API：
// - 強制帶上 credentials（跨網域 Session Cookie）
// - 同時支援「前端代理」與「直連後端」兩種模式
// - 型別與目前後端路由（admin/terms/bookings）對齊

/* ------------------------------------
 * API Base 決策
 * ------------------------------------ */
const DEFAULT_DIRECT_BASE = 'https://venue-booking-api-rjes.onrender.com'

const USE_PROXY = import.meta.env.VITE_USE_FRONTEND_PROXY === '1'
const DIRECT_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  DEFAULT_DIRECT_BASE
).replace(/\/$/, '')

// 代理模式：回傳相對路徑（/api/...），必須在本機 devServer 或 CDN/站台設定對 /api 的反向代理
export const API_BASE = USE_PROXY ? '' : DIRECT_BASE

/* ------------------------------------
 * URL 工具
 * ------------------------------------ */
function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u)
}

export function apiUrl(path: string) {
  const clean = path?.startsWith('/') ? path : `/${path || ''}`
  if (API_BASE === '' || isAbsoluteUrl(clean)) return clean
  return `${API_BASE}${clean}`
}

/* ------------------------------------
 * 低階 fetch + JSON helper
 * ------------------------------------ */
export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = isAbsoluteUrl(input) ? input : apiUrl(input)
  const headers = new Headers(init.headers || {})
  // 只有在有 body 時才預設 JSON Content-Type，避免 GET/HEAD 帶 content-type 造成部分 CDN 誤判
  if (!headers.has('Content-Type') && init.body != null) headers.set('Content-Type', 'application/json')

  const r = await fetch(url, {
    ...init,
    headers,
    credentials: 'include', // 關鍵：跨站/同站都帶 Cookie
  })
  return r
}

export async function apiJson<T = any>(input: string, init: RequestInit = {}) {
  const r = await apiFetch(input, init)
  // 不是 2xx → 盡量提取可讀錯誤
  if (!r.ok) {
    let msg = ''
    try {
      const ct = r.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const j: any = await r.json()
        msg = typeof j?.error === 'string' ? j.error : JSON.stringify(j)
      } else {
        msg = (await r.text())?.slice(0, 500) || ''
      }
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${r.status}${msg ? `: ${msg}` : ''}`)
  }
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) return (await r.json()) as T
  // 非 JSON（例如 204），回 null
  return null as unknown as T
}

/* ------------------------------------
 * 相容舊 helper
 * ------------------------------------ */
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

/* ------------------------------------
 * Admin API（與後端 /api/admin 對齊）
 * ------------------------------------ */
export type AdminLoginResp = { ok: true; user: string }
export type AdminMeResp = { admin: { user: string } | null }
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

  async reviewList(params?: { days?: number; venue?: string; includeEnded?: boolean; showFinished?: boolean; q?: string }) {
    const qs = new URLSearchParams()
    if (params?.days != null) qs.set('days', String(params.days))
    if (params?.venue) qs.set('venue', params.venue)
    // 前端舊稱 showFinished，後端採用 includeEnded → 自動轉換
    const includeEnded = params?.includeEnded ?? params?.showFinished ?? false
    if (includeEnded) qs.set('includeEnded', 'true')
    if (params?.q) qs.set('q', params.q)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiJson<AdminReviewListResp>(`/api/admin/review${suffix}`, { method: 'GET' })
  },

  async logout() {
    return apiJson<{ ok: true }>('/api/admin/logout', { method: 'POST' })
  },
}

/* ------------------------------------
 * Terms API（與 /api/terms 對齊）
 * ------------------------------------ */
export type TermsStatusResp = { enabled: boolean; accepted: boolean; updatedAt: string }

export const termsApi = {
  status() {
    return apiJson<TermsStatusResp>('/api/terms/status')
  },
  accept(email?: string) {
    // 後端目前回 { ok: true }
    return apiJson<{ ok: true }>('/api/terms/accept', {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    })
  },
}

/* ------------------------------------
 * （可選）Bookings API 簡單封裝
 * ------------------------------------ */
export type BookingCreateInput = {
  start: string
  applicantName: string
  email: string
  phone: string
  venue: '大會堂' | '康樂廳' | '其它教室'
  category: string
  note?: string
}

export const bookingsApi = {
  create(body: BookingCreateInput) {
    return apiJson<{ id: string; start_ts: string; end_ts: string }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  // 新增：一次送出多筆（前端批次呼叫 create）
  async createMany(base: Omit<BookingCreateInput, 'start'>, starts: string[]) {
    const bodies = starts.map((start) => ({ ...base, start }))
    const results = await Promise.allSettled(bodies.map((b) => this.create(b)))

    const ok = results
      .filter((r): r is PromiseFulfilledResult<{ id: string } & Record<string, any>> => r.status === 'fulfilled')
      .map((r) => r.value)

    const fail = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason)

    return { ok, fail }
  },

  list(days = 60) {
    return apiJson<{ items: any[] }>(`/api/bookings/list?days=${encodeURIComponent(String(days))}`)
  },
}

