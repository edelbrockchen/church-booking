// src/web/components/SubmitWithTermsGate.tsx
import { useEffect, useState } from 'react'
import TermsGateModal from './TermsGateModal'
import { apiFetch } from '../lib/api'

type Props = {
  onSubmit: () => Promise<void> | void
  label?: string
  className?: string
}

export default function SubmitWithTermsGate({ onSubmit, label='送出申請單', className }: Props) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function checkTerms() {
    setChecking(true)
    try {
      const r = await apiFetch('/api/terms/status')
      if (r.ok) {
        const j = await r.json().catch(() => ({}))
        setOpen(!j?.accepted)
      } else {
        // status 查不到就保守地要求同意
        setOpen(true)
      }
    } finally {
      setChecking(false)
    }
  }

  async function handleClick() {
    await checkTerms()
    if (!open) {
      setSubmitting(true)
      try { await onSubmit() } finally { setSubmitting(false) }
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={checking || submitting}
        className={className ?? 'inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-60'}>
        {checking ? '檢查中…' : submitting ? '送出中…' : label}
      </button>

      <TermsGateModal
        open={open}
        onClose={() => setOpen(false)}
        onAgreed={async () => {
          setOpen(false)
          setSubmitting(true)
          try { await onSubmit() } finally { setSubmitting(false) }
        }}
      />
    </>
  )
}
