// src/pages/AdminReviewPage.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../web/lib/api'

type Booking = {
  id: string
  start_ts: string
  end_ts: string
  created_at?: string
  created_by?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  reviewed_at?: string | null
  reviewed_by?: string | null
  rejection_reason?: string | null
  category?: string | null
  note?: string | null
  venue?: '大會堂' | '康樂廳' | '其它教室' | null
}

type StatusOpt = 'all' | Booking['status']
type VenueOpt = 'all' | NonNullable<Booking['venue']>
type RangeOpt = 7 | 30 | 60 | 180

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
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

function parseContact(note?: string | null) {
  const n = note ?? ''
  return {
    venue: /\[場地:([^\]]+)\]/.exec(n)?.[1] ?? '',
    name: /\[姓名:([^\]]+)\]/.exec(n)?.[1] ?? '',
    email: /\[Email:([^\]]+)\]/.exec(n)?.[1] ?? '',
    phone: /\[電話:([^\]]+)\]/.exec(n)?.[1] ?? '',
  }
}

async function approveOne(id: string) {
  return apiFetch(`/api/admin/bookings/${id}/approve`, { method: 'POST' })
}
async function rejectOne(id: string, reason: string) {
  return apiFetch(`/api/admin/bookings/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}

export default function AdminReviewPage() {
  // --- 狀態 ---
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Booking[]>([])
  const [error, setError] = useState<string>('')

  // 篩選/搜尋/區間
  const [status, setStatus] = useState<StatusOpt>('all')
  const [venue, setVenue] = useState<VenueOpt>('all')
  const [q, setQ] = useState('')
  const [range, setRange] = useState<RangeOpt>(60)
  const [showPast, setShowPast] = useState(true)

  // 勾選 & 批次
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [working, setWorking] = useState(false)

  // 退回彈窗
  const [rejOpen, setRejOpen] = useState(false)
  const [rejId, setRejId] = useState<string | '__batch__' | null>(null)
  const [rejReason, setRejReason] = useState('')

  // 自動刷新
  const [auto, setAuto] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const r = await apiFetch('/api/bookings')
      if (r.status === 401 || r.status === 403) {
        setError('需要管理者登入才能查看。請先登入後再重試。')
        setItems([])
        return
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body?.error || 'load_failed')
      }
      const data = (await r.json()) as { items: Booking[] }
      setItems(data.items ?? [])
    } catch (e: any) {
      setError(e?.message || '資料載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [auto])

  // 區間起點
  const cutoff = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - range)
    d.setHours(0, 0, 0, 0)
    return d
  }, [range])

  // 統計
  const stats = useMemo(() => {
    const s: Record<Booking['status'], number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
    for (const b of items) s[b.status]++
    return s
  }, [items])

  // 進一步過濾
  const filtered = useMemo(() => {
    const now = new Date()
    return (items ?? [])
      .filter(b => new Date(b.start_ts) >= cutoff)
      .filter(b => (status === 'all' ? true : b.status === status))
      .filter(b => {
        const v = b.venue ?? parseContact(b.note).venue
        return venue === 'all' ? true : v === venue
      })
      .filter(b => {
        if (showPast) return true
        return new Date(b.end_ts) >= now
      })
      .filter(b => {
        const c = parseContact(b.note)
        const hay = `${b.created_by ?? ''} ${b.category ?? ''} ${b.note ?? ''} ${c.venue} ${c.name} ${c.email} ${c.phone}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .sort((a, b) => new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime())
  }, [items, cutoff, status, venue, q, showPast])

  // 批次勾選
  const allChecked = filtered.length > 0 && filtered.every(b => sel[b.id])
  const anyChecked = filtered.some(b => sel[b.id])
  const toggleAll = (v: boolean) =>
    setSel(v ? Object.fromEntries(filtered.filter(b => b.status === 'pending').map(b => [b.id, true])) : {})

  // 動作
  async function approveSelected() {
    if (!anyChecked) return
    setWorking(true)
    setError('')
    try {
      const ids = Object.keys(sel).filter(id => sel[id])
      for (const id of ids) {
        const r = await approveOne(id)
        if (r.status === 404) throw new Error('後端缺少核准端點 /api/admin/bookings/:id/approve')
        if (!r.ok) throw new Error('核准失敗')
      }
      setSel({})
      await load()
    } catch (e: any) {
      setError(e?.message || '批次核准失敗')
    } finally {
      setWorking(false)
    }
  }

  function openReject(id: string | '__batch__') {
    setRejId(id)
    setRejReason('')
    setRejOpen(true)
  }

  async function doReject() {
    if (!rejId) return
    const reason = rejReason.trim() || '不符合借用規範'
    setWorking(true)
    setError('')
    try {
      if (rejId === '__batch__') {
        const ids = Object.keys(sel).filter(id => sel[id])
        for (const id of ids) {
          const r = await rejectOne(id, reason)
          if (r.status === 404) throw new Error('後端缺少退回端點 /api/admin/bookings/:id/reject')
          if (!r.ok) throw new Error('退回失敗')
        }
        setSel({})
      } else {
        const r = await rejectOne(rejId, reason)
        if (r.status === 404) throw new Error('後端缺少退回端點 /api/admin/bookings/:id/reject')
        if (!r.ok) throw new Error('退回失敗')
      }
      await load()
      setRejOpen(false)
    } catch (e: any) {
      setError(e?.message || '退回失敗')
    } finally {
      setWorking(false)
    }
  }

  // 匯出 CSV（就匯出目前「篩選後」清單）
  function exportCSV() {
    const header = [
      'id',
      '開始時間(台北)',
      '結束時間(台北)',
      '狀態',
      '場地',
      '分類',
      '申請人',
      'Email',
      '電話',
      '建立時間(台北)',
      '退回理由',
      '備註原文',
    ]
    const lines = [header]
    for (const b of filtered) {
      const c = parseContact(b.note)
      const row = [
        b.id,
        fmtDT(new Date(b.start_ts)),
        fmtDT(new Date(b.end_ts)),
        b.status,
        b.venue ?? c.venue ?? '',
        b.category ?? '',
        b.created_by ?? c.name ?? '',
        c.email,
        c.phone,
        b.created_at ? fmtDT(new Date(b.created_at)) : '',
        b.rejection_reason ?? '',
        (b.note ?? '').replaceAll(/\s+/g, ' ').trim(),
      ]
      lines.push(row)
    }
    const csv = lines.map(cols => cols.map(toCSVCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  function toCSVCell(s: any) {
    const v = String(s ?? '')
    if (/[,"\n]/.test(v)) return `"${v.replaceAll('"', '""')}"`
    return v
  }

  // UI
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h2 className="text-2xl font-bold">管理審核</h2>

      {/* 統計＋控制列（置頂） */}
      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur rounded-xl border p-3 space-y-3">
        {/* 統計 */}
        <div className="flex flex-wrap gap-3 text-sm">
          <Badge color="amber">待審 {stats.pending}</Badge>
          <Badge color="emerald">已核准 {stats.approved}</Badge>
          <Badge color="rose">已退回 {stats.rejected}</Badge>
          <Badge color="slate">已取消 {stats.cancelled}</Badge>
        </div>

        {/* 控制列 */}
        <div className="flex flex-wrap gap-3 items-center">
          <select value={status} onChange={e => setStatus(e.target.value as StatusOpt)} className="border rounded-lg px-3 py-2">
            <option value="all">全部狀態</option>
            <option value="pending">待審</option>
            <option value="approved">已核准</option>
            <option value="rejected">已退回</option>
            <option value="cancelled">已取消</option>
          </select>

          <select value={venue} onChange={e => setVenue(e.target.value as VenueOpt)} className="border rounded-lg px-3 py-2">
            <option value="all">全部場地</option>
            <option value="大會堂">大會堂</option>
            <option value="康樂廳">康樂廳</option>
            <option value="其它教室">其它教室</option>
          </select>

          <select value={range} onChange={e => setRange(Number(e.target.value) as RangeOpt)} className="border rounded-lg px-3 py-2">
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
            <option value={60}>近 60 天</option>
            <option value={180}>近 180 天</option>
          </select>

          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />
            顯示已結束
          </label>

          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜尋：申請人 / 場地 / 備註 / 分類"
            className="border rounded-lg px-3 py-2 flex-1 min-w-[220px]"
          />

          <button onClick={load} disabled={loading} className="rounded-lg border px-3 py-2">
            {loading ? '更新中…' : '重新整理'}
          </button>

          <button onClick={exportCSV} className="rounded-lg border px-3 py-2">匯出 CSV</button>

          <label className="inline-flex items-center gap-2 text-sm ml-auto">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            自動刷新（20 秒）
          </label>
        </div>

        {/* 批次操作 */}
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} />
            選取列表中所有「待審」
          </label>
          <button
            onClick={approveSelected}
            disabled={!anyChecked || working}
            className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 disabled:opacity-50"
          >
            批次核准
          </button>
          <button
            onClick={() => openReject('__batch__')}
            disabled={!anyChecked || working}
            className="rounded-lg bg-rose-600 text-white px-3 py-1.5 disabled:opacity-50"
          >
            批次退回
          </button>
        </div>
      </div>

      {/* 錯誤訊息 */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          {error}
          {/需要管理者登入/.test(error) && (
            <span className="ml-2">
              （請前往你的登入頁再回來。若你有 <code>/admin-login</code> 頁，可
              <a href="/admin-login" className="text-blue-700 underline ml-1">點此登入</a>）
            </span>
          )}
        </div>
      )}

      {/* 表格 */}
      <div className="rounded-xl border overflow-x-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left">
              <th className="px-3 py-2 w-[44px]">
                <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} />
              </th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2">時間（台北）</th>
              <th className="px-3 py-2">場地 / 分類</th>
              <th className="px-3 py-2">申請人 / 聯絡</th>
              <th className="px-3 py-2">建立時間</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const s = new Date(b.start_ts)
              const e = new Date(b.end_ts)
              const c = parseContact(b.note)
              const v = b.venue ?? c.venue ?? '（未填）'
              const isPending = b.status === 'pending'
              const badge =
                b.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-700'
                  : b.status === 'rejected'
                  ? 'bg-rose-100 text-rose-700'
                  : b.status === 'cancelled'
                  ? 'bg-slate-200 text-slate-600'
                  : 'bg-amber-100 text-amber-700'
              return (
                <tr key={b.id} className="border-t">
                  <td className="px-3 py-2 align-top">
                    {isPending ? (
                      <input
                        type="checkbox"
                        checked={!!sel[b.id]}
                        onChange={e => setSel(s => ({ ...s, [b.id]: e.target.checked }))}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={`px-2 py-0.5 rounded ${badge}`}>{b.status}</span>
                    {b.rejection_reason && <div className="text-rose-600 mt-1">{b.rejection_reason}</div>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div>{fmtDT(s)} → {fmtDT(e)}</div>
                    <div className="text-xs text-slate-500">{fmtDate(s)}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{v}</div>
                    <div className="text-xs text-slate-500">{b.category || '（未分類）'}</div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div>申請人：{b.created_by || c.name || '—'}</div>
                    <div className="text-xs text-slate-600">
                      {c.email ? `[Email:${c.email}] ` : ''}{c.phone ? `[電話:${c.phone}]` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">{b.created_at ? fmtDT(new Date(b.created_at)) : '—'}</td>
                  <td className="px-3 py-2 align-top text-right">
                    {isPending ? (
                      <div className="inline-flex gap-2">
                        <button
                          disabled={working}
                          onClick={async () => {
                            setWorking(true)
                            setError('')
                            try {
                              const r = await approveOne(b.id)
                              if (r.status === 404) throw new Error('後端缺少核准端點 /api/admin/bookings/:id/approve')
                              if (!r.ok) throw new Error('核准失敗')
                              await load()
                            } catch (e: any) {
                              setError(e?.message || '核准失敗')
                            } finally {
                              setWorking(false)
                            }
                          }}
                          className="rounded bg-emerald-600 text-white px-3 py-1.5 disabled:opacity-50"
                        >
                          核准
                        </button>
                        <button
                          disabled={working}
                          onClick={() => openReject(b.id)}
                          className="rounded bg-rose-600 text-white px-3 py-1.5 disabled:opacity-50"
                        >
                          退回
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
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  沒有符合條件的項目
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 退回理由彈窗 */}
      {rejOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[min(520px,90vw)] p-4 space-y-3">
            <div className="text-lg font-semibold">填寫退回理由</div>
            <textarea
              value={rejReason}
              onChange={e => setRejReason(e.target.value)}
              rows={4}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="請輸入退回原因…"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejOpen(false)} className="rounded border px-3 py-2">
                取消
              </button>
              <button onClick={doReject} disabled={working} className="rounded bg-rose-600 text-white px-3 py-2 disabled:opacity-50">
                確認退回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Badge({ children, color }: { children: React.ReactNode; color: 'amber' | 'emerald' | 'rose' | 'slate' }) {
  const map: Record<typeof color, string> = {
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
    slate: 'bg-slate-200 text-slate-700',
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded ${map[color]}`}>{children}</span>
}