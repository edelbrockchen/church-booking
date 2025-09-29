// src/web/lib/api.ts
const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'
const API_BASE = (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '')

export function apiUrl(path: string) {
  if (!path) path = '/'
  let clean = path.startsWith('/') ? path : `/${path}`

  // 🛡 防呆：偵測錯誤的 :splat
  if (clean.includes(':splat')) {
    const err = new Error(`Invalid API path contains ":splat": ${clean}`)
    // 印出誰呼叫的（堆疊），方便你在 Console 看到來源
    console.error(err)
    // 直接丟錯，避免真的送出錯誤請求
    throw err
  }

  return `${API_BASE}${clean}`
}

async function _json(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  })
  if (!res.ok) throw new Error(`[${res.status}] ${await res.text().catch(()=> '')}`)
  return res.status === 204 ? null : res.json()
}

export const apiGet  = (p: string) => _json(p)
export const apiPost = (p: string, data?: unknown) =>
  _json(p, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const apiDel  = (p: string) => _json(p, { method: 'DELETE' })