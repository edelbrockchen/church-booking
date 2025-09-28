// src/web/lib/api.ts
const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'

const API_BASE = (
  import.meta.env.VITE_API_BASE || DEFAULT_API_BASE
).replace(/\/$/, '')

export function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    credentials: 'include', // 讓 session cookie 帶上
    ...init,
  })
}