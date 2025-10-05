// src/web/lib/api.ts
const DEFAULT_API_BASE = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE || '').replace(/\/+$/,'')

export function apiUrl(path: string) {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `${DEFAULT_API_BASE}${clean}`
}

export async function apiFetch(input: string, init: RequestInit = {}) {
  const url = input.startsWith('http') ? input : apiUrl(input)

  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    // 🔑 Send/receive the session cookie cross-site
    credentials: 'include',
  })
  return r
}

export async function apiJson<T = any>(input: string, init: RequestInit = {}) {
  const r = await apiFetch(input, init)
  if (!r.ok) {
    const text = await r.text().catch(()=>'')
    throw new Error(`HTTP ${r.status}${text ? `: ${text}` : ''}`)
  }
  return r.json() as Promise<T>
}