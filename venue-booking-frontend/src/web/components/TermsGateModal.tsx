// src/web/components/TermsGateModal.tsx
import { useEffect, useRef, useState } from 'react'
import { recordAgreementOnServer, setAgreedLocal } from '../agree'

type Props = {
  open: boolean
  onClose: () => void
  onAgreed: () => void
}

export default function TermsGateModal({ open, onClose, onAgreed }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const agreeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) agreeBtnRef.current?.focus()
  }, [open])

  async function agree() {
    if (submitting) return
    setSubmitting(true)
    try {
      setAgreedLocal()
      await recordAgreementOnServer()
      onAgreed()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[680px] max-w-[90vw] rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">借用規範</h2>
        <div className="prose max-h-[45vh] overflow-auto">
          <p>請詳閱並同意本借用規範後再送出申請。</p>
          <ul>
            <li>每日最早 07:00；週一/三最晚 18:00；其他日至 21:30；週日禁用。</li>
            <li>單日最多 3 小時；重複日期自動裁切/略過不合規之日。</li>
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2">取消</button>
          <button type="button" ref={agreeBtnRef}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            onClick={agree} disabled={submitting}>
            {submitting ? '處理中…' : '我已閱讀並同意'}
          </button>
        </div>
      </div>
    </div>
  )
}
