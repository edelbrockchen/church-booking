import React, { useEffect, useState } from 'react'
import { apiFetch } from '../web/lib/api'

type Item = {
  id: string
  start_ts: string
  end_ts: string
  created_at: string
  status: 'pending' | 'approved' | 'rejected'
  reviewed_at?: string | null
  reviewed_by?: string | null
  rejection_reason?: string | null
  category?: string | null
  note?: string | null
  created_by?: string | null
}

export default function AdminReviewPage() {
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMsg, setLoginMsg] = useState<string>('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, status])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginMsg('')
    try {
      await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      setAuthed(true)
      setUsername('')
      setPassword('')
    } catch {
      setLoginMsg('登入失敗，請檢查帳號/密碼')
      setAuthed(false)
    }
  }

  async function load() {
    if (!authed) return
    setLoading(true)
    try {
      const qs = status === 'all' ? '' : `?status=${status}`
      const j = await apiFetch(`/api/admin/review${qs}`)
      setItems(j.items || [])
    } catch (e) {
      console.error(e)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  async function approve(id: string) {
    try {
      await apiFetch(`/api/admin/bookings/${id}/approve`, { method: 'POST' })
      load()
    } catch (e) { alert('核准失敗'); console.error(e) }
  }

  async function reject(id: string) {
    const reason = prompt('請輸入退回原因（可留空）') ?? ''
    try {
      await apiFetch(`/api/admin/bookings/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      load()
    } catch (e) { alert('退回失敗'); console.error(e) }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <h2 className="text-2xl font-bold">管理審核</h2>

      {!authed ? (
        <form onSubmit={login} className="max-w-md space-y-3">
          <input
            placeholder="帳號"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          <input
            type="password"
            placeholder="密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-white">登入</button>
          {loginMsg && <div className="text-rose-600 text-sm">{loginMsg}</div>}
        </form>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <select
              value={status}
              onChange={e => setStatus(e.target.value as any)}
              className="rounded-lg border px-3 py-2"
            >
              <option value="all">全部（近60天）</option>
              <option value="pending">待審</option>
              <option value="approved">已核准</option>
              <option value="rejected">已退回</option>
            </select>
            <button
              onClick={load}
              className="rounded-lg border px-4 py-2"
              disabled={loading}
            >
              {loading ? '載入中…' : '重新整理'}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2">狀態</th>
                  <th className="py-2">時間</th>
                  <th className="py-2">建立時間</th>
                  <th className="py-2">申請人/分類/備註</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {items.map(x => (
                  <tr key={x.id} className="border-b">
                    <td className="py-2">{x.status}</td>
                    <td className="py-2">
                      {new Date(x.start_ts).toLocaleString()} → {new Date(x.end_ts).toLocaleString()}
                    </td>
                    <td className="py-2">{new Date(x.created_at).toLocaleString()}</td>
                    <td className="py-2">
                      <div className="space-y-1">
                        {x.created_by && <div>申請人：{x.created_by}</div>}
                        {x.category && <div>分類：{x.category}</div>}
                        {x.note && <div className="text-slate-600">備註：{x.note}</div>}
                        {x.status !== 'pending' && (
                          <div className={x.status === 'approved' ? 'text-emerald-600' : 'text-rose-600'}>
                            {x.status === 'approved'
                              ? `已核准（${x.reviewed_by || ''} / ${x.reviewed_at ? new Date(x.reviewed_at).toLocaleString() : ''}）`
                              : `已退回（${x.reviewed_by || ''} / ${x.reviewed_at ? new Date(x.reviewed_at).toLocaleString() : ''}）`}
                            {x.rejection_reason ? `｜原因：${x.rejection_reason}` : ''}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2 space-x-2">
                      {x.status === 'pending' && (
                        <>
                          <button onClick={() => approve(x.id)} className="rounded bg-emerald-600 px-3 py-1 text-white">核准</button>
                          <button onClick={() => reject(x.id)} className="rounded bg-rose-600 px-3 py-1 text-white">退回</button>
                        </>
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
        </>
      )}
    </div>
  )
}