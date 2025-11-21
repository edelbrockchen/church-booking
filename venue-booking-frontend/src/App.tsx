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
      if (!agreed) {
        setChecking(false)
        return
      }
      try {
        const ok = await fetchAgreementFromServer()
        if (alive) setAgreed(ok)
      } catch {
        // 忽略網路錯誤，保持本地狀態
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => {
      alive = false
    }
  }, []) // 初次載入檢查一次即可

  function toApply() {
    if (!agreed) {
      setOpenGate(true)
      return
    }
    setTab('apply')
  }

  // 深色按鈕樣式（膠囊形狀）
  const btnBase =
    'px-4 h-9 inline-flex items-center justify-center rounded-full border text-sm font-medium transition-colors'
  const btnActive = 'bg-zinc-800 text-white hover:bg-zinc-900 border-zinc-800'
  const btnInactive = 'bg-zinc-700 text-white/90 hover:bg-zinc-800 border-zinc-700'

  return (
    <div className="mx-auto max-w-6xl p-4">
      {/* 上方導覽列：白底卡片，左 Logo + 標題，右按鈕列 */}
      <header className="mb-6 rounded-2xl bg-white shadow-sm border border-slate-200 px-4 py-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* 左側：Icon + 系統名稱 */}
        <div className="flex items-center gap-3">
          {/* 使用只有圖示的 icon 版 */}
          <img
            src="/nantou-logo-icon.svg"
            alt="南投支會"
            className="h-10 md:h-11"
          />
          <div className="flex flex-col">
            <span className="text-lg md:text-xl font-bold leading-tight">
              南投支會場地借用系統
            </span>
            <span className="text-xs text-zinc-400 md:text-sm">
              Nantou Ward Venue Booking
            </span>
          </div>
        </div>

        {/* 右側：四個主功能按鈕 */}
        <nav className="flex flex-wrap gap-2 md:gap-3">
          <button
            onClick={() => setTab('calendar')}
            className={`${btnBase} ${
              tab === 'calendar' ? btnActive : btnInactive
            }`}
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
      </header>

      {/* 你若想在 checking=true 時顯示 Loading，可在此加載入指示 */}
      {tab === 'calendar' && <CalendarPage />}

      {/* 傳入 onAgreed：RulesPage 內部會寫入同意並呼叫這個回呼 */}
      {tab === 'rules' && (
        <RulesPage
          onAgreed={() => {
            setAgreed(true) // 更新本地狀態（RulesPage 已經寫入 local/server）
            setTab('apply') // 直接切到「申請借用」
          }}
        />
      )}

      {tab === 'apply' && <BookingPage />}
      {tab === 'admin' && <AdminReviewPage />}

      <TermsGateModal
        open={openGate}
        onClose={() => setOpenGate(false)}
        onAgreed={async () => {
          setAgreedLocal()
          try {
            await recordAgreementOnServer()
          } catch {
            // 忽略錯誤
          }
          setAgreed(true)
          setOpenGate(false)
          setTab('apply')
        }}
      />
    </div>
  )
}
