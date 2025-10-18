// venue-booking-frontend/src/web/agree.ts
import { termsApi } from './lib/api'

// 沿用你現在的 key，避免影響既有資料
const KEY = 'vb_terms_accepted'

export function isAgreedLocal() {
  return localStorage.getItem(KEY) === '1'
}
export function setAgreedLocal() {
  localStorage.setItem(KEY, '1')
}
export function clearAgreedLocal() {
  localStorage.removeItem(KEY)
}

/** 寫入伺服器（Session），必要時可傳 email 一併存備註 */
export async function recordAgreementOnServer(email?: string) {
  await termsApi.accept(email) // credentials: 'include' 已在 api.ts 處理
}

/** 向伺服器查詢是否已同意（讀 Session） */
export async function fetchAgreementFromServer(): Promise<boolean> {
  try {
    const s = await termsApi.status()
    return !!s.accepted
  } catch {
    return false
  }
}
