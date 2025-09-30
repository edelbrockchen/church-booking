// src/web/components/SubmitWithTermsGate.tsx
import { useEffect, useState } from 'react'
import TermsGateModal from './TermsGateModal'
import { apiFetch } from '../lib/api'

type Props = {
  onSubmit: () => Promise<void> | void   // 送單函式（外部傳入）
  label?: string                         // 按鈕文字
  className?: string
}

type TermsStatus = { accepted?: boolean } | null

export default function SubmitWithTermsGate({
  onSubmit,
  label = '送出申請單',
  className,
}: Props) {
  const [open, setOpen] = useState(false)        // 是否顯示條款彈窗
  const [checking, setChecking] = useState(true) // 啟動檢查中
  const [submitting, setSubmitting] = useState(false)

  // 啟動時：詢問後端 /api/terms/status，失敗則 fallback localStorage
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = (await apiFetch('/api/terms/status')) as TermsStatus
        if (cancelled) return
        const already = !!data?.accepted
        setOpen(!already)
      } catch (e: any) {
        // 若後端無此 API 或非 2xx，apiFetch 會丟錯 → fallback localStorage
        if (cancelled) return
        const already = localStorage.getItem('termsAccepted') === 'true'
        setOpen(!already)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleClick() {
    if (checking || submitting) return
    // 尚未同意 → 先顯示條款彈窗
    if (open) { setOpen(true); return }
    // 已同意 → 直接送單
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  // 條款彈窗按「同意」：localStorage 標記 + 嘗試通知後端 → 繼續送單
  async function handleAgreed() {
    localStorage.setItem('termsAccepted', 'true')
    try {
      await apiFetch('/api/terms/accept', { method: 'POST' })
    } catch {
      // 容錯：後端暫失敗也不擋送單
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
        className={
          className ??
          'inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60'
        }
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