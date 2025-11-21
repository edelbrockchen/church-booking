// src/App.tsx
import React, { useEffect, useState } from 'react'
import CalendarPage from './pages/CalendarPage'
import RulesPage from './pages/RulesPage'
import BookingPage from './pages/BookingPage'
import AdminReviewPage from './pages/AdminReviewPage'
import TermsGateModal from './web/components/TermsGateModal'
import {
  isAgreedLocal,
  setAgreedLocal,
  recordAgreementOnServer,
  fetchAgreementFromServer,
} from './web/agree'

type Tab = 'calendar' | 'rules' | 'apply' | 'admin'

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [agreed, setAgreed] = useState<boolean>(isAgreedLocal())
  const [checking, setChecking] = useState(true)
  const [openGate, setOpenGate] = useState(false)

  // 第一次載入時，如果本機已記錄同意，就向後端確認一次
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!agreed) { setChecking(false); return }
      try {
        const ok = await fetchAgreementFromServer()
        if (alive) setAgreed(ok)
      } catch {
        /* ignore */
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, []) // 初次載入檢查一次即可

  function toApply() {
    if (!agreed) { setOpenGate(true); return }
    setTab('apply')
  }

  // 深色按鈕樣式
  const btnBase = 'px-3 py-1 rounded border transition-colors'
  const btnActive = 'bg-zinc-800 text-white hover:bg-zinc-900 border-zinc-800'
  const btnInactive = 'bg-zinc-700 text-white/90 hover:bg-zinc-800 border-zinc-700'

  return (
    <div className="mx-auto max-w-6xl p-4">
      {/* 導覽列（含 Logo） */}
      <nav className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 mr-2">
          <img
            src="/logo.svg"
            alt="南投場地借用系統 Logo"
            className="h-8 w-auto select-none"
            draggable={false}
          />
          <span className="hidden sm:inline text-lg font-semibold text-zinc-800">
            南投場地借用系統
          </span>
        </div>

        <button
          onClick={() => setTab('calendar')}
          className={`${btnBase} ${tab === 'calendar' ? btnActive : btnInactive}`}
        >
          行事曆
        </button>
        <button
          onClick={() => setTab('rules')}
          className={`${btnBase} ${tab === 'rules' ? btnActive : btnInactive}`}
        >
          借用規範
        </button>
        <button
          onClick={toApply}
          className={`${btnBase} ${tab === 'apply' ? btnActive : btnInactive}`}
        >
          申請借用
        </button>
        <button
          onClick={() => setTab('admin')}
          className={`${btnBase} ${tab === 'admin' ? btnActive : btnInactive}`}
        >
          管理審核
        </button>
      </nav>

      {/* 你若想在 checking=true 時顯示 Loading，可在此加載入指示 */}
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
