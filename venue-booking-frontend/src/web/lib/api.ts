// venue-booking-frontend/src/web/lib/api.ts
// 統一 API 呼叫工具（含 :splat 防呆 + credentials + 舊版鍵名相容）

const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'
export const API_BASE = (
  import.meta.env.VITE_API_BASE ??
  import.meta.env.VITE_API_BASE_URL ??
  DEFAULT_API_BASE
).replace(/\/+$/, '')

export function apiUrl(path: string) {
  if (!path) path = '/'
  const clean = path.startsWith('/') ? path : `/${path}`
  if (clean.includes(':splat')) throw new Error(`Invalid API path contains ":splat": ${clean}`)
  return `${API_BASE}${clean}`
}

export async function apiFetch(input: string, init?: RequestInit) {
  const url = input.startsWith('http') ? input : apiUrl(input)
  const r = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  return r
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await apiFetch(path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}
