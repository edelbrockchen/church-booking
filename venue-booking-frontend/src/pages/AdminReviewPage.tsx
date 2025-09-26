// src/pages/AdminReviewPage.tsx
import React, { useState } from 'react'
import { LogIn, LogOut, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'

type Item = {
  id: string
  start_ts: string
  end_ts: string
  created_at: string
  status: 'pending' | 'approved' | 'rejected'
  reviewed_at?: string | null
  reviewed_by?: string | null
  rejection_reason?: string | null
}

type MeRes = { user: { id: string; role: string; name: string } | null }

export default function AdminReviewPage({ apiBase }: { apiBase: string }) {
  const [authed, setAuthed] = useState(false)
  const [currentUser, setCurrentUser] = useState<string>('')
  const [user, setUser] = useState('')
  const [pwd, setPwd] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({})

  // 更新某筆退件理由
  function updateReason(id: string, v: string) {
    setReasonMap(prev => ({ ...prev, [id]: v }))
  }

  async function login() {
    const r = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: user, password: pwd }),
    })

    if (!r.ok) {
      alert('帳號或密碼錯誤，或尚未設定')
      return
    }

    // ✅ 登入成功後，確認 /me（確認 cookie 帶上了）
    const me = await fetch(`${apiBase}/api/admin/me`, { credentials: 'include' })
    if (!me.ok) {
      alert('登入後無法驗證身分，請重新嘗試')
      return
    }
    const meJson = (await me.json()) as MeRes
    if (!meJson.user) {
      alert('未取得使用者資訊，請重新登入')
      return
    }

    setCurrentUser(meJson.user.name)
    setAuthed(true)
    setPwd('') // 安全起見，清空輸入的密碼
    load()
  }

  async function logout() {
    await fetch(`${apiBase}/api/admin/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {})
    // 清空本地狀態
    setAuthed(false)
    setCurrentUser('')
    setItems([])
    setReasonMap({})
    setUser('')
    setPwd('')
  }

  async function load() {
    setLoading(true)
    const r = await fetch(`${apiBase}/api/admin/review`, { credentials: 'include' })
    if (r.ok) {
      const j = await r.json()
      setItems(j.items || [])
    } else {
      alert('未授權或伺服器錯誤')
    }
    setLoading(false)
  }

  async function approve(id: string) {
    const r = await fetch(`${apiBase}/api/admin/bookings/${id}/approve`, {
      method: 'POST',
      credentials: 'include',
    })
    if (r.ok) load()
    else alert('核准失敗')
  }

  async function reject(id: string, reason: string) {
    const r = await fetch(`${apiBase}/api/admin/bookings/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason }),
    })
    if (r.ok) load()
    else alert('退件失敗')
  }

  if (!authed) {
    return (
      <div className="max-w-md card">
        <h2 className="mb-3 text-lg font-semibold">管理者登入</h2>
        <div className="space-y-3">
          <input
            className="w-full rounded-xl2 border border-slate-300 px-3 py-2"
            placeholder="帳號"
            value={user}
            onChange={e => setUser(e.target.value)}
            autoComplete="username"
          />
          <input
            type="password"
            className="w-full rounded-xl2 border border-slate-300 px-3 py-2"
            placeholder="密碼"
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            autoComplete="current-password"
          />
          <button className="btn" onClick={login}>
            <LogIn className="size-4" /> 登入
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">近 60 天申請</h2>
          <div className="text-sm text-slate-600">（目前帳號：{currentUser}）</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 重新載入
          </button>
          <button className="btn-ghost" onClick={logout} title="登出">
            <LogOut className="size-4" /> 登出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">狀態</th>
              <th className="py-2">開始 → 結束</th>
              <th className="py-2">建立時間</th>
              <th className="py-2">審核資訊</th>
              <th className="py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {items.map(x => (
              <tr key={x.id} className="border-t">
                <td className="py-2">{x.status}</td>
                <td className="py-2">
                  {new Date(x.start_ts).toLocaleString()} → {new Date(x.end_ts).toLocaleString()}
                </td>
                <td className="py-2">{new Date(x.created_at).toLocaleString()}</td>
                <td className="py-2">
                  {x.status !== 'pending' ? (
                    <div className="space-y-1">
                      <div className={x.status === 'approved' ? 'text-emerald-600' : 'text-rose-600'}>
                        {x.status === 'approved' ? '已核准' : '已退件'}
                      </div>
                      {x.reviewed_at && (
                        <div className="text-slate-500">於 {new Date(x.reviewed_at).toLocaleString()}</div>
                      )}
                      {x.rejection_reason && (
                        <div className="text-slate-600">理由：{x.rejection_reason}</div>
                      )}
                    </div>
                  ) : (
                    <em className="text-slate-500">待審核</em>
                  )}
                </td>
                <td className="py-2 text-right">
                  {x.status === 'pending' && (
                    <div className="flex items-center justify-end gap-2">
                      <button className="btn" onClick={() => approve(x.id)}>
                        <CheckCircle2 className="size-4" /> 核准
                      </button>
                      <input
                        className="w-48 rounded-xl2 border border-slate-300 px-3 py-2"
                        placeholder="退件理由（可空）"
                        value={reasonMap[x.id] || ''}
                        onChange={e => updateReason(x.id, e.target.value)}
                      />
                      <button className="btn-ghost" onClick={() => reject(x.id, reasonMap[x.id] || '')}>
                        <XCircle className="size-4" /> 退件
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  暫無資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}