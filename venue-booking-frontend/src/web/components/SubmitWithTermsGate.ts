// src/web/components/SubmitWithTermsGate.tsx
import { useEffect, useState } from 'react'
import TermsGateModal from './TermsGateModal'
import { apiFetch } from '../lib/api' // ✅ 改用共用 API 呼叫

type Props = {
  onSubmit: () => Promise<void> | void // 你的原本送單函式
  label?: string                        // 按鈕文字
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
        const r = await apiFetch('/api/terms/status') // ✅ 用 apiFetch（帶上 API_BASE + Cookie）
        if (!cancelled && r.ok) {
          const data = await r.json()
          const already = !!data?.accepted
          setOpen(!already)
        } else if (!cancelled) {
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
    if (checking) return
    // 需要同意 → 先彈窗（TermsGateModal 裡按「同意」才會關閉）
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
      await apiFetch('/api/terms/accept', { method: 'POST' }) // ✅ 用 apiFetch
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