// src/web/agree.ts
import { apiFetch } from './lib/api'

export async function recordAgreementOnServer() {
  try {
    await apiFetch('/api/terms/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // apiFetch 已內建 credentials: 'include'
    })
  } catch {}
}

export async function fetchAgreementFromServer(): Promise<boolean> {
  try {
    const r = await apiFetch('/api/terms/status')
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
