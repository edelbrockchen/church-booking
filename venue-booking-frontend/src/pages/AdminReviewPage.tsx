import React, { useState } from 'react'
import { LogIn, RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

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

export default function AdminReviewPage({ apiBase }: { apiBase: string }) {
  const [authed, setAuthed] = useState(false)
  const [user, setUser] = useState('')
  const [pwd, setPwd] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [loginMsg, setLoginMsg] = useState<string | null>(null)

  async function checkMe(): Promise<boolean> {
    try {
      const r = await fetch(`${apiBase}/api/admin/me`, { credentials: 'include' })
      if (!r.ok) return false
      const j = await r.json().catch(() => ({} as any))
      return !!j?.user
    } catch {
      return false
    }
  }

  async function login() {
    setLoginMsg(null)
    try {
      const r = await fetch(`${apiBase}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // 關鍵：一定要帶 cookie
        body: JSON.stringify({ username: user, password: pwd })
      })
      if (!r.ok) {
        setLoginMsg('帳號或密碼錯誤，或尚未設定')
        return
      }

      // 登入成功 → 立刻檢查 /me，確認 session 是否建立
      const ok = await checkMe()
      if (!ok) {
        setLoginMsg(
          '未取得使用者資訊。可能原因：\n' +
          '1) 瀏覽器阻擋跨站 Cookie（Safari/第三方 Cookie 設定）。\n' +
          '2) 後端 CORS_ORIGIN 未包含前端網域。\n' +
          '3) API 的 SameSite/secure 設定不正確（我們已設 sameSite=None, secure=true）。\n' +
          '請嘗試重新登入，或改用 Chrome/Edge 再試。'
        )
        return
      }

      setAuthed(true)
      load()
    } catch (e) {
      setLoginMsg('登入時發生錯誤，請稍後再試')
    }
  }

  async function load() {
    setLoading(true)
    const r = await fetch(`${apiBase}/api/admin/review`, { credentials: 'include' })
    if (r.status === 401) {
      setAuthed(false)
      setLoginMsg('登入狀態失效，請重新登入')
      setLoading(false)
      return
    }
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
      credentials: 'include'
    })
    if (r.status === 401) {
      setAuthed(false); setLoginMsg('登入狀態失效，請重新登入'); return
    }
    if (r.ok) load()
    else alert('核准失敗')
  }

  async function reject(id: string) {
    const r = await fetch(`${apiBase}/api/admin/bookings/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ reason })
    })
    if (r.status === 401) {
      setAuthed(false); setLoginMsg('登入狀態失效，請重新登入'); return
    }
    if (r.ok) { setReason(''); load() } else alert('退件失敗')
  }

  if (!authed) {
    return (
      <div className="max-w-md card">
        <h2 className="mb-3 text-lg font-semibold">管理者登入</h2>
        <div className="space-y-3">
          <input
            className="w-full rounded-xl2 border border-slate-300 px-3 py-2"
            placeholder="帳號（ADMIN_USERS_JSON）"
            value={user}
            onChange={e => setUser(e.target.value)}
          />
          <input
            type="password"
            className="w-full rounded-xl2 border border-slate-300 px-3 py-2"
            placeholder="密碼（明文，後端會比對 bcrypt 雜湊）"
            value={pwd}
            onChange={e => setPwd(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button className="btn" onClick={login}><LogIn className="size-4" /> 登入</button>
            <button
              className="btn-ghost"
              onClick={async () => {
                setLoginMsg('檢查登入狀態中…')
                const ok = await checkMe()
                setLoginMsg(ok ? '已登入狀態（可直接進入）' : '尚未登入或 Cookie 未帶上')
                if (ok) setAuthed(true)
              }}
            >
              <AlertCircle className="size-4" /> 檢查登入狀態
            </button>
          </div>
          {loginMsg && (
            <pre className="whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
{loginMsg}
            </pre>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">近 60 天申請</h2>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 重新載入
        </button>
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
                  {x.status !== 'pending'
                    ? (
                      <div className="space-y-1">
                        <div className={x.status === 'approved' ? 'text-emerald-600' : 'text-rose-600'}>
                          {x.status === 'approved' ? '已核准' : '已退件'}
                        </div>
                        {x.reviewed_at && <div className="text-slate-500">於 {new Date(x.reviewed_at).toLocaleString()}</div>}
                        {x.rejection_reason && <div className="text-slate-600">理由：{x.rejection_reason}</div>}
                      </div>
                    )
                    : <em className="text-slate-500">待審核</em>}
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
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                      />
                      <button className="btn-ghost" onClick={() => reject(x.id)}>
                        <XCircle className="size-4" /> 退件
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">暫無資料</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}