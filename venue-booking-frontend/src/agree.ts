// 統一處理「已同意規範」的本機與伺服器狀態
import { termsApi } from './lib/api'

const KEY = 'terms.accepted.v1'

export function isAgreedLocal() {
  return localStorage.getItem(KEY) === '1'
}
export function setAgreedLocal() {
  localStorage.setItem(KEY, '1')
}

export async function recordAgreementOnServer(email?: string) {
  // 重要：這會用 credentials=include 呼叫 /api/terms/accept，寫入 Session
  await termsApi.accept(email)
}

export async function fetchAgreementFromServer() {
  try {
    const s = await termsApi.status()
    return !!s.accepted
  } catch {
    return false
  }
}
