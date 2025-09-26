// src/agree.ts
export async function recordAgreementOnServer() {
  try {
    await fetch('/api/terms/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
  } catch {}
}

export async function fetchAgreementFromServer(): Promise<boolean> {
  try {
    const r = await fetch('/api/terms/status', { credentials: 'include' })
    if (!r.ok) return false
    const j = await r.json()
    return !!j?.accepted
  } catch {
    return false
  }
}

const KEY = 'vb_terms_accepted'
export function setAgreedLocal() { localStorage.setItem(KEY, '1') }
export function isAgreedLocal() { return localStorage.getItem(KEY) === '1' }
export function clearAgreedLocal() { localStorage.removeItem(KEY) }