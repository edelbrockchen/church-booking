// venue-booking-frontend/src/web/lib/api.ts
// ✅ 單檔版：不需要 src/web/admin 目錄

// 後端 API Base：優先採用 VITE_API_BASE_URL（或 VITE_API_BASE），並移除結尾斜線
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  ''
).replace(/\/+$/, '')

// 產生完整 API URL
export function apiUrl(path: string) {
  const clean = path?.startsWith('/') ? path : `/${path || ''}`
  return `${API_BASE}${clean}`
}

// 共用 fetch：一定帶 cookie（跨網域需要）
export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = input.startsWith('http') ? input : apiUrl(input)

  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    // 🔑 關鍵：跨網域時帶上/接收 session cookie
    credentials: 'include',
  })
  return r
}

// 取 JSON，失敗時拋出帶狀態碼的錯誤
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
  return (r.headers.get('content-type')?.includes('application/json')
    ? r.json()
    : (null as any)) as Promise<T>
}

// --- Admin API 也內建在此檔，避免要建資料夾 ---

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
    // /api/admin/review 需由後端用 requireAdmin 保護
    return apiJson<AdminReviewListResp>('/api/admin/review', { method: 'GET' })
  },

  async logout() {
    return apiJson<{ ok: true }>('/api/admin/logout', { method: 'POST' })
  },
}
