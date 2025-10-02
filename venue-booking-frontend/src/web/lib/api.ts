// web/lib/api.ts
const DEFAULT_API_BASE = 'https://venue-booking-api-rjes.onrender.com'

// 兩種 Vite 變數都支援；取到的字串再去尾斜線
const API_BASE = (
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  DEFAULT_API_BASE
).replace(/\/+$/, '')

export function apiUrl(path: string) {
  const clean = path ? (path.startsWith('/') ? path : `/${path}`) : '/'
  if (clean.includes(':splat')) throw new Error(`Invalid API path contains ":splat": ${clean}`)
  return `${API_BASE}${clean}`
}
