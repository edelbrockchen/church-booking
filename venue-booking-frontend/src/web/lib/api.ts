// venue-booking-frontend/src/web/lib/api.ts
// 統一 API 呼叫工具（含 :splat 防呆 + 舊版相容 apiFetch）

const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'
const API_BASE = (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '')

export function apiUrl(path: string) {
  if (!path) path = '/'
  let clean = path.startsWith('/') ? path : `/${path}`

  // 🛡 防呆：不應該出現 Rewrite 佔位符
  if (clean.includes(':splat')) {
    const err = new Error(`Invalid API path contains ":splat": ${clean}`)
    // 印出堆疊方便追查來源
    console.error(err)
    throw err
  }

  return `${API_BASE}${clean}`
}

async function _json(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include', // 帶上 session cookie
    headers: {
      'Accept': 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[${res.status}] ${text || res.statusText}`)
  }
  return res.status === 204 ? null : res.json()
}

/** 舊版相容：仍可 import { apiFetch } 使用 */
export const apiFetch = _json

/** 建議使用的新方法 */
export const apiGet  = (p: string) => _json(p)
export const apiPost = (p: string, data?: unknown) =>
  _json(p, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const apiPut  = (p: string, data?: unknown) =>
  _json(p, { method: 'PUT',  body: data ? JSON.stringify(data) : undefined })
export const apiDel  = (p: string) => _json(p, { method: 'DELETE' })