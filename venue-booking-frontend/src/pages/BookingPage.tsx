import React, { useMemo, useState } from 'react'
import { Send } from 'lucide-react'
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function isSunday(d: Date) { return d.getDay() === 0 }
function latestEnd(d: Date) { const day = d.getDay(); return (day === 1 || day === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 } }
function clampEnd(start: Date) { const target = addHours(start, 3); const { h, m } = latestEnd(start); const cap = new Date(start); cap.setHours(h, m, 0, 0); return target.getTime() > cap.getTime() ? cap : target }
function fmt(d?: Date) { return d ? d.toISOString().slice(0, 16) : '' }
function willTruncate(start: Date) { const targetEnd = addHours(start, 3); const { h, m } = latestEnd(start); const cap = new Date(start); cap.setHours(h, m, 0, 0); return targetEnd.getTime() > cap.getTime() }

export default function BookingPage() {
  const [start, setStart] = useState('')
  const startDate = useMemo(() => start ? new Date(start) : undefined, [start])
  const endDate = useMemo(() => startDate ? clampEnd(startDate) : undefined, [startDate])

  async function submit() {
    if (!startDate) { alert('請選擇開始時間'); return }
    if (isSunday(startDate)) { alert('週日禁用'); return }
    const r = await fetch(`${API_BASE}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ start: startDate.toISOString() }) })
    const j = await r.json()
    if (!r.ok) { alert('錯誤：' + (j?.error || 'unknown')); return }
    alert('已送出（待審核）：\n' + JSON.stringify(j, null, 2))
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2 card">
        <h2 className="mb-3 text-lg font-semibold">申請借用</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm text-slate-600">開始時間（本地時區）：</label>
            <input type="datetime-local" className="w-full rounded-xl2 border border-slate-300 px-3 py-2" value={start} onChange={(e) => setStart(e.target.value)} />
            {!!startDate && <p className="text-xs text-slate-500">{isSunday(startDate) ? '（週日禁用）' : (willTruncate(startDate) ? '＊超過當日上限，將自動截短' : '原則 +3 小時')}</p>}
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-600">結束時間（自動計算；可能截短）：</label>
            <input type="datetime-local" className="w-full rounded-xl2 border border-slate-300 px-3 py-2" value={fmt(endDate)} readOnly />
          </div>
        </div>
        <div className="mt-4"><button className="btn" onClick={submit}><Send className="size-4" /> 送出申請</button></div>
      </div>
      <aside className="card">
        <h3 className="mb-2 font-medium">時間規範</h3>
        <ul className="text-sm text-slate-600 space-y-1">
          <li>原則每次 3 小時。</li>
          <li>週一／週三最晚至 18:00；其餘至 21:30。</li>
          <li>週日禁用。</li>
        </ul>
      </aside>
    </div>
  )
}