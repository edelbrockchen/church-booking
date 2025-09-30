import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../web/lib/api'

type Booking = {
  id: string
  start_ts: string
  end_ts: string
  created_at?: string
  created_by?: string | null
  status: 'pending'|'approved'|'rejected'|'cancelled'
  reviewed_at?: string | null
  reviewed_by?: string | null
  rejection_reason?: string | null
  category?: string | null
  note?: string | null
  venue?: '大會堂'|'康樂廳'|'其它教室'|null
}

type Guard = 'checking' | 'deny' | 'ok'
type RangeOpt = 7|30|60|180
type StatusOpt = 'all' | Booking['status']
type VenueOpt  = 'all' | NonNullable<Booking['venue']>

const TZ = 'Asia/Taipei'
const fmtDT = (d: Date) => new Intl.DateTimeFormat('zh-TW',{
  timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
}).format(d)
const fmtDate = (d: Date) => new Intl.DateTimeFormat('zh-TW',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
const parseContact = (note?: string|null) => {
  const n = note ?? ''
  return {
    venue: /\[場地:([^\]]+)\]/.exec(n)?.[1] ?? '',
    name:  /\[姓名:([^\]]+)\]/.exec(n)?.[1] ?? '',
    email: /\[Email:([^\]]+)\]/.exec(n)?.[1] ?? '',
    phone: /\[電話:([^\]]+)\]/.exec(n)?.[1] ?? '',
  }
}

async function approveOne(id: string) {
  return apiFetch(`/api/admin/bookings/${id}/approve`, { method:'POST' })
}
async function rejectOne(id: string, reason: string) {
  return apiFetch(`/api/admin/bookings/${id}/reject`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ reason })
  })
}

export default function AdminReviewPage() {
  /* ---- 守門：必須管理者 ---- */
  const [guard, setGuard] = useState<Guard>('checking')
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch('/api/admin/me')
        const d = r.ok ? await r.json() : { authenticated:false }
        setGuard(d.authenticated ? 'ok' : 'deny')
      } catch { setGuard('deny') }
    })()
  }, [])
  if (guard === 'checking') return <div className="max-w-6xl mx-auto p-6">檢查身分中…</div>
  if (guard === 'deny') {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-3">
        <div className="text-xl font-semibold">需要管理者登入</div>
        <a href="/admin-login" className="inline-block rounded bg-blue-600 text-white px-4 py-2">前往管理者登入</a>
      </div>
    )
  }

  /* ---- 資料與控制 ---- */
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Booking[]>([])
  const [status, setStatus] = useState<StatusOpt>('all')
  const [venue, setVenue]   = useState<VenueOpt>('all')
  const [q, setQ]           = useState('')
  const [range, setRange]   = useState<RangeOpt>(60)
  const [sel, setSel]       = useState<Record<string, boolean>>({})
  const [working, setWorking] = useState(false)
  const [rejId, setRejId]   = useState<string|null>(null)
  const [rejReason, setRejReason] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await apiFetch('/api/bookings') // 後端已限制僅管理者可用
      const data = (await r.json()) as { items: Booking[] }
      setItems(data.items ?? [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const cutoff = useMemo(() => { const d=new Date(); d.setDate(d.getDate()-range); return d }, [range])
  const filtered = useMemo(() =>
    (items ?? [])
      .filter(b => new Date(b.start_ts) >= cutoff)
      .filter(b => status === 'all' ? true : b.status === status)
      .filter(b => venue === 'all' ? true : (b.venue ?? parseContact(b.note).venue) === venue)
      .filter(b => {
        const c = parseContact(b.note)
        const hay = `${b.created_by ?? ''} ${b.category ?? ''} ${b.note ?? ''} ${c.venue} ${c.name} ${c.email} ${c.phone}`.toLowerCase()
        return hay.includes(q.toLowerCase())
      })
      .sort((a,b) => new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime())
  , [items, cutoff, status, venue, q])

  const allChecked = filtered.length>0 && filtered.every(b => sel[b.id])
  const anyChecked = filtered.some(b => sel[b.id])
  const toggleAll  = (v:boolean) => setSel(v ? Object.fromEntries(filtered.filter(b=>b.status==='pending').map(b=>[b.id,true])) : {})

  async function approveSelected() {
    if (!anyChecked) return
    setWorking(true)
    try {
      const ids = Object.keys(sel).filter(id => sel[id])
      for (const id of ids) await approveOne(id)
      setSel({}); await load()
    } finally { setWorking(false) }
  }
  function openReject(id: string | '__batch__') {
    setRejId(id === '__batch__' ? '__batch__' : id); setRejReason('')
  }
  async function doReject() {
    if (!rejId) return
    const reason = rejReason.trim() || '不符合借用規範'
    setWorking(true)
    try {
      if (rejId === '__batch__') {
        const ids = Object.keys(sel).filter(id => sel[id])
        for (const id of ids) await rejectOne(id, reason)
        setSel({})
      } else {
        await rejectOne(rejId, reason)
      }
      await load()
    } finally { setWorking(false); setRejId(null); setRejReason('') }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h2 className="text-2xl font-bold">管理審核</h2>

      {/* 控制列（置頂） */}
      <div className="flex flex-wrap gap-3 items-center sticky top-0 bg-white/80 backdrop-blur z-10 py-2">
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
        <input value={q} onChange={e=>setQ(e.target.value)}
               placeholder="搜尋：申請人 / 場地 / 備註 / 分類"
               className="border rounded-lg px-3 py-2 flex-1 min-w-[220px]" />
        <button onClick={load} disabled={loading} className="rounded-lg border px-3 py-2">
          {loading ? '更新中…' : '重新整理'}
        </button>
        <div className="ml-auto flex gap-2">
          <button onClick={approveSelected} disabled={!anyChecked || working}
                  className="rounded-lg bg-emerald-600 text-white px-3 py-2 disabled:opacity-50">批次核准</button>
          <button onClick={()=>openReject('__batch__')} disabled={!anyChecked || working}
                  className="rounded-lg bg-rose-600 text-white px-3 py-2 disabled:opacity-50">批次退回</button>
        </div>
      </div>

      {/* 表格 */}
      <div className="rounded-xl border overflow-x-auto">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="bg-slate-50">
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
              const s = new Date(b.start_ts), e = new Date(b.end_ts)
              const c = parseContact(b.note)
              const v = b.venue ?? c.venue ?? '（未填）'
              const badge =
                b.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                b.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                b.status === 'cancelled'? 'bg-slate-200 text-slate-600' :
                                          'bg-amber-100 text-amber-700'
              const isPending = b.status === 'pending'
              return (
                <tr key={b.id} className="border-t">
                  <td className="px-3 py-2 align-top">
                    {isPending
                      ? <input type="checkbox" checked={!!sel[b.id]} onChange={e=>setSel(s=>({ ...s, [b.id]: e.target.checked }))}/>
                      : <span className="text-slate-300">—</span>}
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
                        <button disabled={working} onClick={async()=>{setWorking(true);await approveOne(b.id);await load();setWorking(false)}}
                                className="rounded bg-emerald-600 text-white px-3 py-1.5 disabled:opacity-50">核准</button>
                        <button disabled={working} onClick={()=>setRejId(b.id)}
                                className="rounded bg-rose-600 text-white px-3 py-1.5 disabled:opacity-50">退回</button>
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

      {/* 退回理由彈窗 */}
      {rejId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[min(520px,90vw)] p-4 space-y-3">
            <div className="text-lg font-semibold">填寫退回理由</div>
            <textarea value={rejReason} onChange={e=>setRejReason(e.target.value)} rows={4}
                      className="w-full border rounded-lg px-3 py-2" placeholder="請輸入退回原因…" />
            <div className="flex justify-end gap-2">
              <button onClick={()=>{ setRejId(null); setRejReason('') }} className="rounded border px-3 py-2">取消</button>
              <button onClick={doReject} disabled={working}
                      className="rounded bg-rose-600 text-white px-3 py-2 disabled:opacity-50">確認退回</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}