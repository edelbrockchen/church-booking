// src/web/lib/api.ts
const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'

const API_BASE = (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '')

export function apiUrl(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${cleanPath}`
}

async function _fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
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

// 你原本的 apiFetch（保留），適合拿來 GET 不處理 body
export const apiFetch = _fetchJson

// 便捷方法（建議新用這些）
export const apiGet  = (path: string) => _fetchJson(path)
export const apiPost = (path: string, data?: unknown) =>
  _fetchJson(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined })
export const apiPut  = (path: string, data?: unknown) =>
  _fetchJson(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined })
export const apiDel  = (path: string) =>
  _fetchJson(path, { method: 'DELETE' })