// src/web/components/SubmitWithTermsGate.tsx
import { useEffect, useState } from 'react'
import TermsGateModal from './TermsGateModal'
import { apiFetch } from '../lib/api'

type Props = {
  onSubmit: () => Promise<void> | void  // 你的原本送單函式
  label?: string                         // 按鈕文字
  className?: string
}

export default function SubmitWithTermsGate({
  onSubmit,
  label = '送出申請單',
  className,
}: Props) {
  const [open, setOpen] = useState(false)        // 是否顯示條款彈窗
  const [checking, setChecking] = useState(true) // 啟動時檢查狀態
  const [submitting, setSubmitting] = useState(false)

  // 啟動時：詢問後端是否已同意；若沒有這支 API 或 404 → 視為未同意（彈窗）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await apiFetch('/api/terms/status')
        if (cancelled) return

        if (r.ok) {
          const data = await r.json().catch(() => ({}))
          const already = !!(data as any)?.accepted
          setOpen(!already)
        } else if (r.status === 404) {
          // 後端沒提供 /status 時，一律要求彈窗
          setOpen(true)
        } else {
          // 其他 HTTP 錯誤 → fallback localStorage
          const already = localStorage.getItem('termsAccepted') === 'true'
          setOpen(!already)
        }
      } catch {
        // 連線失敗 → fallback localStorage
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
    // 需要同意 → 先彈窗（TermsGateModal 按「同意」才會關閉並繼續送單）
    if (open) { setOpen(true); return }
    // 已同意 → 直接送單
    setSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setSubmitting(false)
    }
  }

  // TermsGateModal 按「同意」：localStorage + 嘗試通知後端 → 送單
  async function handleAgreed() {
    localStorage.setItem('termsAccepted', 'true')
    try {
      await apiFetch('/api/terms/accept', { method: 'POST' })
    } catch {
      // 容錯：後端暫時失敗仍放行（前端已記錄同意）
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