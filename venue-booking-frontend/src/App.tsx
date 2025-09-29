// src/App.tsx
import React, { useState, useEffect } from 'react'
import { Calendar, BookOpenText, FilePlus2, ShieldCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import CalendarPage from './pages/CalendarPage'
import RulesPage from './pages/RulesPage'
import BookingPage from './pages/BookingPage'
import AdminReviewPage from './pages/AdminReviewPage'

import { isAgreedLocal, setAgreedLocal, recordAgreementOnServer, fetchAgreementFromServer } from './agree'
import TermsGateModal from './components/TermsGateModal'

type Tab = 'calendar' | 'rules' | 'apply' | 'admin'
// API base handled inside api.ts; no need here

const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: 'easeOut' },
}

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar')
  const [agreed, setAgreed] = useState<boolean>(isAgreedLocal())
  const [checking, setChecking] = useState(true)
  const [openGate, setOpenGate] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (agreed) {
        const ok = await fetchAgreementFromServer()
        if (alive) setAgreed(ok || true)
      }
      if (alive) setChecking(false)
    })()
    return () => { alive = false }
  }, [])

  function onClickApply() {
    if (checking) return
    if (agreed) setTab('apply')
    else setOpenGate(true)
  }

  async function onRulesAgreedFromPage() {
    setAgreedLocal()
    try { await recordAgreementOnServer() } catch {}
    setAgreed(true)
    setTab('apply')
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-blue-600 grid place-items-center text-white font-bold shadow">NB</div>
            <div>
              <div className="text-base font-semibold">南投支會場地借用系統</div>
              <div className="text-xs text-slate-500">Nantou Branch Venue Booking</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <button className="btn-ghost" onClick={() => setTab('calendar')}>
              <Calendar className="size-4" /> 行事曆
            </button>
            <button className="btn-ghost" onClick={() => setTab('rules')}>
              <BookOpenText className="size-4" /> 借用規範
            </button>
            <button className="btn" onClick={onClickApply} disabled={checking}
              title={!agreed ? '首次會先顯示借用規範' : '前往申請'}>
              <FilePlus2 className="size-4" /> {checking ? '檢查中…' : '申請借用'}
            </button>
            <button className="btn-ghost" onClick={() => setTab('admin')}>
              <ShieldCheck className="size-4" /> 管理者審核
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <AnimatePresence mode="wait">
          {tab === 'calendar' && (
            <motion.section key="calendar" {...fadeUp}>
              <CalendarPage apiBase={API_BASE} />
            </motion.section>
          )}
          {tab === 'rules' && (
            <motion.section key="rules" {...fadeUp}>
              <RulesPage onAgreed={onRulesAgreedFromPage} />
            </motion.section>
          )}
          {tab === 'apply' && (
            <motion.section key="apply" {...fadeUp}>
              <BookingPage apiBase={API_BASE} />
            </motion.section>
          )}
          {tab === 'admin' && (
            <motion.section key="admin" {...fadeUp}>
              <AdminReviewPage />
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Nantou Branch · 建議使用桌面版瀏覽器以獲得最佳體驗</span>
          <div className="flex flex-wrap items-center gap-3">
            <a href="mailto:example@example.com" className="hover:underline">聯絡我們</a>
            <span className="hidden sm:inline text-slate-300">|</span>
            <a href="#" className="hover:underline">隱私權政策</a>
          </div>
        </div>
      </footer>

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