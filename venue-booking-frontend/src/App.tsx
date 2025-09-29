// src/App.tsx
import React, { useEffect, useState } from 'react'
import CalendarPage from './pages/CalendarPage'
import RulesPage from './pages/RulesPage'
import BookingPage from './pages/BookingPage'
import AdminReviewPage from './pages/AdminReviewPage'
import TermsGateModal from './web/components/TermsGateModal'
import { isAgreedLocal, setAgreedLocal, recordAgreementOnServer, fetchAgreementFromServer } from './web/agree'

type Tab = 'calendar' | 'rules' | 'apply' | 'admin'

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [agreed, setAgreed] = useState<boolean>(isAgreedLocal())
  const [checking, setChecking] = useState(true)
  const [openGate, setOpenGate] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!agreed) { setChecking(false); return }
      try {
        const ok = await fetchAgreementFromServer()
        if (alive) setAgreed(ok)
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, [])

  function toApply() {
    if (!agreed) { setOpenGate(true); return }
    setTab('apply')
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <nav className="flex gap-3 mb-4">
        <button onClick={() => setTab('calendar')} className="rounded border px-3 py-1">行事曆</button>
        <button onClick={() => setTab('rules')} className="rounded border px-3 py-1">借用規範</button>
        <button onClick={toApply} className="rounded border px-3 py-1">申請借用</button>
        <button onClick={() => setTab('admin')} className="rounded border px-3 py-1">管理審核</button>
      </nav>

      {tab === 'calendar' && <CalendarPage />}
      {tab === 'rules' && <RulesPage />}
      {tab === 'apply' && <BookingPage />}
      {tab === 'admin' && <AdminReviewPage />}

      <TermsGateModal
        open={openGate}
        onClose={() => setOpenGate(false)}
        onAgreed={async () => {
          setAgreedLocal()
          try { await recordAgreementOnServer() } catch {}
          setAgreed(true)
          setOpenGate(false)
          setTab('apply')
        }}
      />
    </div>
  )
}