// src/web/components/SubmitWithTermsGate.tsx
import { useEffect, useState } from 'react'
import TermsGateModal from './TermsGateModal'

type Props = {
  onSubmit: () => Promise<void> | void    // 你的原本送單函式
  label?: string                           // 按鈕文字
  className?: string
}

export default function SubmitWithTermsGate({ onSubmit, label = '送出申請單', className }: Props) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 啟動時先問後端狀態；若後端沒這支 API，改用 localStorage 判斷
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/terms/status', { credentials: 'include' })
        if (!cancelled && r.ok) {
          const data = await r.json()
          const already = !!data?.accepted
          setOpen(!already)
        } else if (!cancelled) {
          // 後端沒有 /status 的情況，用 localStorage 判斷
          const already = localStorage.getItem('termsAccepted') === 'true'
          setOpen(!already)
        }
      } catch {
        const already = localStorage.getItem('termsAccepted') === 'true'
        setOpen(!already)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleClick() {
    // 若還在檢查狀態，就先不送
    if (checking) return
    // 若需要同意，先彈窗（TermsGateModal 裡按「同意」才會關閉）
    if (open) {
      setOpen(true)
      return
    }
    // 已同意 → 直接送單
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  // 當 TermsGateModal 按「同意」：寫 localStorage + 嘗試通知後端，再真正送單
  async function handleAgreed() {
    localStorage.setItem('termsAccepted', 'true')
    try {
      await fetch('/api/terms/accept', { method: 'POST', credentials: 'include' })
    } catch {
      // 容錯：後端暫時失敗仍放行
    }
    setOpen(false)
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={checking || submitting}
        className={className ?? 'inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60'}
      >
        {checking ? '檢查中…' : submitting ? '送出中…' : label}
      </button>

      <TermsGateModal
        open={open}
        onClose={() => setOpen(false)}
        onAgreed={handleAgreed}
      />
    </>
  )
}