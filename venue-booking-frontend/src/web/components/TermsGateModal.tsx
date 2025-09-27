// src/web/components/TermsGateModal.tsx
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'   // ✅ 新增：共用 API 呼叫

type Props = {
  open: boolean
  onClose: () => void
  onAgreed: () => void
}

export default function TermsGateModal({ open, onClose, onAgreed }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const agreeBtnRef = useRef<HTMLButtonElement | null>(null)

  // ★ Hook 一律無條件呼叫；在 effect 內再看 open
  useEffect(() => {
    if (!open) return
    agreeBtnRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function recordAgreementOnServer() {
    try {
      await apiFetch('/api/terms/accept', {   // ✅ 改用 apiFetch
        method: 'POST',
      })
    } catch (e) {
      console.error('[TermsGate] recordAgreementOnServer failed', e)
    }
  }

  function setAgreedLocal() {
    try { localStorage.setItem('termsAccepted', 'true') } catch {}
  }

  async function agree() {
    if (submitting) return
    setSubmitting(true)
    try {
      setAgreedLocal()
      await recordAgreementOnServer() // 容錯：失敗也放行
    } finally {
      setSubmitting(false)
      onAgreed()
    }
  }

  // ★ 早退 return 放在所有 Hook 之後（不再破壞 Hook 次序）
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="termsgate-title"
      aria-describedby="termsgate-desc"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-4">
          <h2 id="termsgate-title" className="text-lg font-semibold">
            開始前，請先同意借用規範
          </h2>
          <ol id="termsgate-desc" className="list-decimal pl-6 mt-3 space-y-1 text-sm text-gray-700">
            <li>週日不可預約。</li>
            <li>每次固定 3 小時，超時不受理。</li>
            <li>週一/週三最晚離場 18:00，其餘日最晚 21:30。</li>
            <li>請維護場地整潔並準時歸還。</li>
            <li>違反規範將影響後續借用資格。</li>
          </ol>
          <div className="mt-3 text-sm">
            <a className="text-blue-600 hover:underline" href="/terms" target="_blank" rel="noreferrer">
              查看完整借用規範（新分頁）
            </a>
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-3">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-60"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            ref={agreeBtnRef}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            onClick={agree}
            disabled={submitting}
          >
            {submitting ? '處理中…' : '我已閱讀並同意'}
          </button>
        </div>
      </div>
    </div>
  )
}