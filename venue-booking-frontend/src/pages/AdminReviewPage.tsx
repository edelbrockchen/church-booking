// src/pages/AdminReviewPage.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../web/lib/api'

type Item = {
  id: string
  start_ts: string
  end_ts: string
  created_at: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  reviewed_at?: string | null
  reviewed_by?: string | null
  rejection_reason?: string | null
  category?: string | null
  note?: string | null
  created_by?: string | null
  venue?: '大會堂' | '康樂廳' | '其它教室' | null
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'
type VenueFilter = 'all' | NonNullable<Item['venue']>

const TZ = 'Asia/Taipei'
const fmtDT = (d: Date) =>
  new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)

function parseContact(note?: string | null) {
  const n = note ?? ''
  return {
    venue: /\[場地:([^\]]+)\]/.exec(n)?.[1] ?? '',
    name: /\[姓名:([^\]]+)\]/.exec(n)?.[1] ?? '',
    email: /\[Email:([^\]]+)\]/.exec(n)?.[1] ?? '',
    phone: /\[電話:([^\]]+)\]/.exec(n)?.[1] ?? '',
  }
}

export default function AdminReviewPage() {
  // --- 登入/資料 ---
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string>('')

  // 後端狀態參數（UI 下拉）
  const [status, setStatus] = useState<StatusFilter>('all')

  // 額外前端過濾/控制
  const [venue, setVenue] = useState<VenueFilter>('all')
  const [q, setQ] = useState('')
  const [showPast, setShowPast] = useState(true)
  const [auto, setAuto] = useState(false)

  // 登入表單
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginMsg, setLoginMsg] = useState<string>('')

  // 登入
  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoginMsg('')
    try {
      const r = await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setAuthed(true)
      setUsername('')
      setPassword('')
      setError('')
      // 登入後立即載入
      load()
    } catch {
      setLoginMsg('登入失敗，請檢查帳號/密碼')
      setAuthed(false)
    }
  }

  // 讀取列表（僅在已登入時）
  async function load() {
    if (!authed) return
    setLoading(true)
    setError('')
    try {
      // 後端 /api/admin/review 目前不支援 status 參數，我們用前端過濾
      const r = await apiFetch(`/api/admin/review`)
      if (r.status === 401) {
        // Session 逾時，退回登入
        setAuthed(false)
        setItems([])
        setError('尚未登入或登入已逾時，請重新登入')
        return
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setItems(j.items || [])
    } catch (e: any) {
      setItems([])
      setError(e?.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  // 首次掛載後，若已登入（有時同域 Cookie），嘗試載入一次
  useEffect(() => {
    if (authed) load()
  }, [authed])

  // 自動刷新
  useEffect(() => {
    if (!auto || !authed) return
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [auto, authed])

  // 場地選項（從資料推導：先用欄位，沒有就從 note 標頭解析）
  const venueOptions: VenueFilter[] = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) {
      const v = it.venue ?? parseContact(it.note).venue
      if (v) set.add(v)
    }
    const list = Array.from(set) as VenueFilter[]
    const valid = ['大會堂', '康樂廳', '其它教室']
    const ordered = valid.filter((v) => list.includes(v as VenueFilter)) as VenueFilter[]
    return (['all' as const, ...ordered]) as VenueFilter[]
  }, [items])

  // 統計
  const stats = useMemo(() => {
    const s: Record<NonNullable<Item['status']>, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    }
    for (const it of items) s[it.status] = (s[it.status] ?? 0) + 1
    return s
  }, [items])

  // 前端過濾（狀態、是否顯示已結束、場地、關鍵字）
  const filtered = useMemo(() => {
    const now = new Date()
    return items
      .filter((it) => (status === 'all' ? true : it.status === status)) // ★ 加上狀態過濾
      .filter((it) => (showPast ? true : new Date(it.end_ts) >= now))
      .filter((it) => {
        if (venue === 'all') return true
        const v = it.venue ?? parseContact(it.note).venue
        return v === venue
      })
      .filter((it) => {
        if (!q.trim()) return true
        const c = parseContact(it.note)
     const hay = [
  it.id,                        // ★ 新增這行，方便用 ID 搜尋
  it.created_by ?? '',
  it.category ?? '',
  it.note ?? '',
  c.venue, c.name, c.email, c.phone,
].join(' ').toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .sort((a, b) => new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime())
  }, [items, status, showPast, venue, q])

  // 動作：核准/退回/取消（只在登入後）
  async function approve(id: string) {
    if (!authed) return
    try {
      const r = await apiFetch(`/api/admin/bookings/${id}/approve`, { method: 'POST' })
      if (r.status === 401) { setAuthed(false); setError('登入逾時'); return }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      load()
    } catch (e) {
      alert('核准失敗')
      console.error(e)
    }
  }
  async function reject(id: string) {
    if (!authed) return
    const reason = prompt('請輸入退回原因（可留空）') ?? ''
    try {
      const r = await apiFetch(`/api/admin/bookings/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (r.status === 401) { setAuthed(false); setError('登入逾時'); return }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      load()
    } catch (e) {
      alert('退回失敗')
      console.error(e)
    }
  }
  async function cancel(id: string) {
    if (!authed) return
    const reason = prompt('請輸入取消原因（可留空）') ?? ''
    try {
      const r = await apiFetch(`/api/admin/bookings/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (r.status === 401) { setAuthed(false); setError('登入逾時'); return }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      load()
    } catch (e) {
      alert('取消失敗')
      console.error(e)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
  <img src="/logo-icon.svg" alt="" className="h-6 w-6" />
  管理審核
</h2>


      {!authed ? (
        <form onSubmit={login} className="max-w-md rounded-xl border p-4 space-y-3 bg-white">
          <div className="text-slate-700">請先以管理者身分登入</div>
          <input
            placeholder="帳號"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            autoFocus
          />
          <input
            type="password"
            placeholder="密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          <button
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={!username || !password}
          >
            登入
          </button>
          {loginMsg && <div className="text-rose-600 text-sm">{loginMsg}</div>}
        </form>
      ) : (
        <>
          {/* 控制列 */}
          <div className="sticky top-0 z-10 bg-white/80 backdrop-blur rounded-xl border p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                className="rounded-lg border px-3 py-2"
              >
                <option value="all">全部（近 60 天）</option>
                <option value="pending">待審</option>
                <option value="approved">已核准</option>
                <option value="rejected">已退回</option>
                <option value="cancelled">已取消</option>
              </select>

              <select
                value={venue}
                onChange={(e) => setVenue(e.target.value as VenueFilter)}
                className="rounded-lg border px-3 py-2"
              >
                {venueOptions.map((v) => (
                  <option key={v} value={v}>
                    {v === 'all' ? '全部場地' : v}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showPast}
                  onChange={(e) => setShowPast(e.target.checked)}
                />
                顯示已結束
              </label>

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜尋：申請人 / 場地 / 備註 / 分類"
                className="flex-1 min-w-[220px] rounded-lg border px-3 py-2"
              />

              <button onClick={load} className="rounded-lg border px-3 py-2" disabled={loading}>
                {loading ? '更新中…' : '重新整理'}
              </button>

              <button onClick={exportCSV} className="rounded-lg border px-3 py-2">
                匯出 CSV
              </button>

              <label className="inline-flex items-center gap-2 text-sm ml-auto">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                />
                自動刷新（20 秒）
              </label>
            </div>

            {/* 小統計 */}
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge color="amber">待審 {stats.pending}</Badge>
              <Badge color="emerald">已核准 {stats.approved}</Badge>
              <Badge color="rose">已退回 {stats.rejected}</Badge>
              <Badge color="slate">已取消 {stats.cancelled}</Badge>
            </div>
          </div>

          {/* 錯誤訊息 */}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* 清單 */}
          <div className="rounded-xl border overflow-x-auto bg-white">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left">
                  <th className="px-3 py-2">狀態</th>
                  <th className="px-3 py-2">時間（台北）</th>
                  <th className="px-3 py-2">場地 / 分類</th>
                  <th className="px-3 py-2">申請人 / 聯絡</th>
                  <th className="px-3 py-2">建立時間</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {filtered.map((x) => {
                  const s = new Date(x.start_ts)
                  const e = new Date(x.end_ts)
                  const c = parseContact(x.note)
                  const venueShow = x.venue ?? c.venue ?? '（未填）'
                  const isPending = x.status === 'pending'
                  const isApproved = x.status === 'approved'
                  const badge =
                    x.status === 'approved'
                      ? 'bg-emerald-100 text-emerald-700'
                      : x.status === 'rejected'
                      ? 'bg-rose-100 text-rose-700'
                      : x.status === 'cancelled'
                      ? 'bg-slate-200 text-slate-600'
                      : 'bg-amber-100 text-amber-700'
                  return (
                    <tr key={x.id} className="border-t">
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded ${badge}`}>{x.status}</span>
                        {x.rejection_reason && (
                          <div className="text-rose-600 mt-1">{x.rejection_reason}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div>
                          {fmtDT(s)} → {fmtDT(e)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{venueShow}</div>
                        <div className="text-xs text-slate-500">
                          {x.category || '（未分類）'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>申請人：{x.created_by || c.name || '—'}</div>
                        <div className="text-xs text-slate-600">
                          {c.email ? `[Email:${c.email}] ` : ''}
                          {c.phone ? `[電話:${c.phone}]` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2">{fmtDT(new Date(x.created_at))}</td>
                      <td className="px-3 py-2 text-right">
                        {(isPending || isApproved) ? (
                          <div className="inline-flex gap-2">
                            {isPending && (
                              <>
                                <button
                                  onClick={() => approve(x.id)}
                                  className="rounded bg-emerald-600 px-3 py-1.5 text-white"
                                >
                                  核准
                                </button>
                                <button
                                  onClick={() => reject(x.id)}
                                  className="rounded bg-rose-600 px-3 py-1.5 text-white"
                                >
                                  退回
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => cancel(x.id)}
                              className="rounded bg-slate-600 px-3 py-1.5 text-white"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      沒有符合條件的項目
                    </td>
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

function Badge({
  children,
  color,
}: {
  children: React.ReactNode
  color: 'amber' | 'emerald' | 'rose' | 'slate'
}) {
  const map: Record<typeof color, string> = {
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-200 text-slate-700',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded ${map[color]}`}>
      {children}
    </span>
  )
}

// 匯出 CSV（匯出目前篩選後清單）
function exportCSV() {
  // 這個函式需要可見的資料；為了簡單起見，直接抓目前畫面上的表格資料即可。
  // 如果你希望匯出未經前端過濾的完整資料，可以改成在載入時另外保留一份原始 items。
  const table = document.querySelector('table')
  if (!table) return
  const rows: string[][] = []
  const header = ['狀態', '開始(台北)', '結束(台北)', '場地', '分類', '申請人/聯絡', '建立時間(台北)']
  rows.push(header)
  const bodyRows = table.querySelectorAll('tbody tr')
  bodyRows.forEach((tr) => {
    const tds = Array.from(tr.querySelectorAll('td')).map((td) =>
      (td.textContent || '').replace(/\s+/g, ' ').trim()
    )
    if (tds.length >= 6) rows.push(tds.slice(0, 6))
  })
  const csv = rows.map((r) => r.map(toCSVCell).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bookings_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
function toCSVCell(v: any) {
  const s = String(v ?? '')
  return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
