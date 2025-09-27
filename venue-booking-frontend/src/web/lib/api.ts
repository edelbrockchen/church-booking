// src/web/lib/api.ts
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || ''

export function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    credentials: 'include', // 讓 session cookie 帶上
    ...init,
  })
}