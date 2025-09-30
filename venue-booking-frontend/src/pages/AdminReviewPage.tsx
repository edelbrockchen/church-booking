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

type RangeOpt = 7 | 30 | 60 | 180
type StatusOpt = 'all' | Booking['status']
type VenueOpt = 'all' | NonNullable<Booking['venue']>

const tz = 'Asia/Taipei'
const fmtDT = (d: Date) =>
  new Intl.DateTimeFormat('zh-TW', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d)
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

function parseInfoFromNote(note?: string | null) {
  const n = note ?? ''
  const venue = /\[場地:([^\]]+)\]/.exec(n)?.[1]
  const name  = /\[姓名:([^\]]+)\]/.exec(n)?.[1] ?? ''
  const email = /\[Email:([^\]]+)\]/.exec(n)?.[1] ?? ''
  const phone = /\[電話:([^\]]+)\]/.exec(n)?.[1] ?? ''
  return { venue, name, email, phone }
}

async function approveOne(id: string) {
  // 嘗試多種端點以相容既有後端
  const tries = [
    `/api/admin/bookings/${id}/approve`,
    `/api/admin/approve/${id}`,
    `/api/admin/approve`,
  ]
  for (const url of tries) {
    const r = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: url.endsWith('/approve') ? JSON.stringify({ id }) : undefined
    })
    if (r.ok || r.status !== 404) return r
  }
  throw new Error('approve_api_not_found')
}

async function rejectOne(id: string, reason: string) {
  const tries = [
    [`/api/admin/bookings/${id}/reject`, undefined] as const,
    [`/api/admin/reject/${id}`, undefined] as const,
    [`/api/admin/reject`, JSON.stringify({ id, reason })] as const,
  ]
  for (const [url, body] of tries) {
    const r = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ?? JSON.stringify({ reason })
    })
    if (r.ok || r.status !== 404) return r
  }
  throw new Error('reject_api_not_found')
}

export default function AdminReviewPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Booking[]>([])
  const [status, setStatus] = useState<StatusOpt>('all')
  const [venue, setVenue]   = useState<VenueOpt>('all')
  const [q, setQ]           = useState('')
  const [range, setRange]   = useState<RangeOpt>(60)
  const [selection, setSelection] = useState<Record<string, boolean>>({})
  const [working, setWorking] = useState(false)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await apiFetch('/api/bookings')
      const data = (await r.json()) as { items: Booking[] }
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const cutoff = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - range)
    return d
  }, [range])

  const filtered = useMemo(() => {
    return (items ?? [])
      .filter(b => {
        // 時間區間：近 N 天（以 start_ts 判斷）
        const s = new Date(b.start_ts)
        if (!(s >= cutoff)) return false
        // 狀態
        if (status !== 'all' && b.status !== status) return false
        // 場地（優先看欄位，其次從 note 解析）
        const v = b.venue ?? parseInfoFromNote(b.note).venue ?? ''
        if (venue !== 'all' && v !== venue) return false
        // 搜尋（申請人/備註/分類/場地）
        const t = `${b.created_by ?? ''} ${b.category ?? ''} ${b.note ?? ''} ${v}`.toLowerCase()
        return t.includes(q.toLowerCase())
      })
      .sort((a, b) => new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime())
  }, [items, cutoff, status, venue, q])

  const allChecked = filtered.length > 0 && filtered.every(b => selection[b.id])
  const anyChecked = filtered.some(b => selection[b.id])

  function toggleAll(v: boolean) {
    const next: Record<string, boolean> = {}
    if (v) for (const b of filtered) if (b.status === 'pending') next[b.id] = true
    setSelection(next)
  }

  async function onApproveSelected() {
    if (!anyChecked) return
    setWorking(true)
    try {
      const ids = Object.keys(selection).filter(id => selection[id])
      for (const id of ids) await approveOne(id)
      await load()
      setSelection({})
    } finally {
      setWorking(false)
    }
  }

  async function onRejectSelected() {
    const ids = Object.keys(selection).filter(id => selection[id])
    if (!ids.length) return
    setRejectId('__batch__')
    setRejectReason('')
  }

  async function onApprove(id: string) {
    setWorking(true)
    try {
      await approveOne(id)
      await load()
    } finally {
      setWorking(false)
    }
  }

  async function onReject(id: string) {
    setRejectId(id)
    setRejectReason('')
  }

  async function confirmReject() {
    if (!rejectId) return
    const reason = rejectReason.trim() || '不符合借用規範'
    setWorking(true)
    try {
      if (rejectId === '__batch__') {
        const ids = Object.keys(selection).filter(id => selection[id])
        for (const id of ids) await rejectOne(id, reason)
        setSelection({})
      } else {
        await rejectOne(rejectId, reason)
      }
      await load()
    } finally {
      setWorking(false)
      setRejectId(null)
      setRejectReason('')
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h2 className="text-2xl font-bold">管理審核</h2>

      {/* 控制列 */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={status} onChange={e=>setStatus(e.target.value as StatusOpt)} className="border rounded-lg px-3 py-2">
          <option value="all">全部</option>
          <option value="pending">待審</option>
          <option value="approved">已核准</option>
          <option value="rejected">已退回</option>
          <option value="cancelled">已取消</option>
        </select>

        <select value={venue} onChange={e=>setVenue(e.target.value as VenueOpt)} className="border rounded-lg px-3 py-2">
          <option value="all">全部場地</option>
          <option value="大會堂">大會堂</option>
          <option value="康樂廳">康樂廳</option>
          <option value="其它教室">其它教室</option>
        </select>

        <select value={range} onChange={e=>setRange(Number(e.target.value) as RangeOpt)} className="border rounded-lg px-3 py-2">
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={60}>近 60 天</option>
          <option value={180}>近 180 天</option>
        </select>

        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="搜尋：申請人 / 場地 / 備註 / 分類"
          className="border rounded-lg px-3 py-2 flex-1 min-w-[220px]"
        />

        <button onClick={load} disabled={loading} className="rounded-lg border px-3 py-2">
          {loading ? '更新中…' : '重新整理'}
        </button>

        <div className="ml-auto flex gap-2">
          <button
            onClick={onApproveSelected}
            disabled={!anyChecked || working}
            className="rounded-lg bg-emerald-600 text-white px-3 py-2 disabled:opacity-50">
            批次核准
          </button>
          <button
            onClick={onRejectSelected}
            disabled={!anyChecked || working}
            className="rounded-lg bg-rose-600 text-white px-3 py-2 disabled:opacity-50">
            批次退回
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div className="rounded-xl border overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2 w-[44px]">
                <input type="checkbox" checked={allChecked} onChange={e=>toggleAll(e.target.checked)} />
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
              const info = parseInfoFromNote(b.note)
              const v = b.venue ?? info.venue ?? '（未填）'
              const rowPending = b.status === 'pending'
              const badgeClass =
                b.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                b.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                b.status === 'cancelled' ? 'bg-slate-200 text-slate-600' :
                'bg-amber-100 text-amber-700'
              return (
                <tr key={b.id} className="border-t">
                  <td className="px-3 py-2 align-top">
                    {rowPending ? (
                      <input
                        type="checkbox"
                        checked={!!selection[b.id]}
                        onChange={e=>setSelection(s => ({ ...s, [b.id]: e.target.checked }))}
                      />
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={`px-2 py-0.5 rounded ${badgeClass}`}>{b.status}</span>
                    {b.rejection_reason ? <div className="text-rose-600 mt-1">{b.rejection_reason}</div> : null}
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
                    <div>申請人：{b.created_by || info.name || '—'}</div>
                    <div className="text-xs text-slate-600">
                      {info.email ? `[Email:${info.email}] ` : ''}{info.phone ? `[電話:${info.phone}]` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {b.created_at ? fmtDT(new Date(b.created_at)) : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    {rowPending ? (
                      <div className="inline-flex gap-2">
                        <button
                          disabled={working}
                          onClick={()=>onApprove(b.id)}
                          className="rounded bg-emerald-600 text-white px-3 py-1.5 disabled:opacity-50">
                          核准
                        </button>
                        <button
                          disabled={working}
                          onClick={()=>onReject(b.id)}
                          className="rounded bg-rose-600 text-white px-3 py-1.5 disabled:opacity-50">
                          退回
                        </button>
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">沒有符合條件的項目</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 退回理由對話框（簡易版） */}
      {rejectId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[min(520px,90vw)] p-4 space-y-3">
            <div className="text-lg font-semibold">填寫退回理由</div>
            <textarea
              value={rejectReason}
              onChange={e=>setRejectReason(e.target.value)}
              rows={4}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="請輸入退回原因（例如：時間衝突、資料不完整等）"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={()=>{ setRejectId(null); setRejectReason('') }}
                className="rounded border px-3 py-2">取消</button>
              <button
                onClick={confirmReject}
                disabled={working}
                className="rounded bg-rose-600 text-white px-3 py-2 disabled:opacity-50">
                確認退回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}