// src/App.tsx
import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom'

import CalendarPage from './pages/CalendarPage'
import RulesPage from './pages/RulesPage'
import BookingPage from './pages/BookingPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminReviewPage from './pages/AdminReviewPage'

import TermsGateModal from './web/components/TermsGateModal'
import {
  isAgreedLocal,
  setAgreedLocal,
  recordAgreementOnServer,
  fetchAgreementFromServer,
} from './web/agree'

/** 申請頁面保護：未同意條款就先彈窗，同意後才顯示 BookingPage */
function ProtectedApply() {
  const navigate = useNavigate()
  const [agreed, setAgreed] = useState<boolean>(isAgreedLocal())
  const [checking, setChecking] = useState(true)
  const [openGate, setOpenGate] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!agreed) {
        setOpenGate(true)
        setChecking(false)
        return
      }
      try {
        const ok = await fetchAgreementFromServer()
        if (alive) {
          setAgreed(ok)
          if (!ok) setOpenGate(true)
        }
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, []) // 初次載入時檢查

  if (checking) return <div className="mx-auto max-w-6xl p-4">檢查中…</div>

  if (!agreed) {
    return (
      <>
        <div className="mx-auto max-w-6xl p-4">
          <h2 className="text-xl font-semibold mb-2">需要同意借用規範</h2>
          <p className="text-slate-600 mb-4">同意後即可進入申請頁面。</p>
          <button
            onClick={() => setOpenGate(true)}
            className="rounded-lg bg-blue-600 text-white px-4 py-2"
          >
            開啟條款
          </button>
          <button
            onClick={() => navigate('/rules')}
            className="ml-2 rounded-lg border px-4 py-2"
          >
            先查看借用規範
          </button>
        </div>

        <TermsGateModal
          open={openGate}
          onClose={() => setOpenGate(false)}
          onAgreed={async () => {
            setAgreedLocal()
            try { await recordAgreementOnServer() } catch {}
            setOpenGate(false)
            setAgreed(true)
          }}
        />
      </>
    )
  }

  // 已同意 → 顯示申請頁
  return <BookingPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="mx-auto max-w-6xl p-4">
        {/* 導覽列 */}
        <nav className="flex flex-wrap gap-3 mb-4">
          <Link to="/calendar" className="rounded border px-3 py-1">行事曆</Link>
          <Link to="/rules" className="rounded border px-3 py-1">借用規範</Link>
          {/* 直接連到 /apply，裡面有保護層會檢查是否已同意條款 */}
          <Link to="/apply" className="rounded border px-3 py-1">申請借用</Link>
          <Link to="/admin/review" className="rounded border px-3 py-1">管理審核</Link>
        </nav>

        {/* 路由設定 */}
        <Routes>
          <Route path="/" element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/apply" element={<ProtectedApply />} />
          <Route path="/admin-login" element={<AdminLoginPage />} />
          <Route path="/admin/review" element={<AdminReviewPage />} />
          {/* 兜底 */}
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}