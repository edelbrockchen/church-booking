// src/pages/CalendarPage.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../web/lib/api'

type Booking = {
  id: string
  start_ts: string
  end_ts: string
  note?: string | null
  category?: string | null
  venue?: '大會堂' | '康樂廳' | '其它教室' | null
}

const TZ = 'Asia/Taipei'

/** 台北時區 YYYY-MM-DD key（用來分組顯示） */
function tpeDateKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** HH:mm（台北） */
function fmtHHmmTPE(d: Date) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}

/** 取當月資訊 */
function tpeMonthInfo(pivot: Date) {
  const y = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(pivot))
  const m = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: '2-digit' }).format(pivot))
  const monthName = new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, year: 'numeric', month: 'long' }).format(pivot)
  return { year: y, month: m, monthName }
}

/** 產生 6 週（42 格）的月曆 key（YYYY-MM-DD，以台北時間計） */
function buildMonthGridKeys(pivot: Date) {
  const { year, month } = tpeMonthInfo(pivot)
  // 該月 1 號的 12:00（避免時區邊界）
  const firstMid = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00+08:00`)
  const firstDow = firstMid.getUTCDay() // 0..6
  // 第一格往回推到週日
  const firstGrid = new Date(firstMid)
  firstGrid.setUTCDate(firstMid.getUTCDate() - firstDow)

  const keys: string[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(firstGrid)
    d.setUTCDate(firstGrid.getUTCDate() + i)
    keys.push(tpeDateKey(d))
  }
  return keys
}

/** 從 note 萃取「申請原因」：剝除你前端加的標頭 */
function extractReason(note?: string | null) {
  if (!note) return ''
  let s = note
    .replace(/\[場地:[^\]]*\]\s*/g, '')
    .replace(/\[姓名:[^\]]*\]\s*/g, '')
    .replace(/\[Email:[^\]]*\]\s*/g, '')
    .replace(/\[電話:[^\]]*\]\s*/g, '')
    .trim()
  s = s.replace(/^(申請原因[:：]\s*)/g, '').trim()
  return s
}

export default function CalendarPage() {
  const [items, setItems] = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [pivot, setPivot] = useState(() => new Date()) // 當前月份任一天

  async function load() {
    setLoading(true)
    setErr('')
    try {
      const r = await apiFetch('/api/bookings/approved')
      const data = await r.json()
      setItems(data.items ?? [])
    } catch (e: any) {
      setErr(e?.message || '資料載入失敗')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const { monthName } = useMemo(() => tpeMonthInfo(pivot), [pivot])
  const keys = useMemo(() => buildMonthGridKeys(pivot), [pivot])

  // 依「台北日期」分組，並將每筆做成「HH:mm 申請原因」的標籤
  const eventsByKey = useMemo(() => {
    const map: Record<string, Array<{ id: string; start: Date; label: string }>> = {}
    for (const b of items) {
      const start = new Date(b.start_ts)
      const key = tpeDateKey(start)
      const reason = extractReason(b.note)
      const label = `${fmtHHmmTPE(start)} ${reason || '（未填原因）'}`
      if (!map[key]) map[key] = []
      map[key].push({ id: b.id, start, label })
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.start.getTime() - b.start.getTime())
    }
    return map
  }, [items])

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      {/* 標頭與操作 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">行事曆</h2>
        <div className="flex items-center gap-2">
          <button
            className="rounded border px-3 py-1"
            onClick={() => setPivot(d => {
              const info = tpeMonthInfo(d)
              const prev = new Date(`${info.year}-${String(info.month).padStart(2, '0')}-15T12:00:00+08:00`)
              prev.setUTCMonth(prev.getUTCMonth() - 1)
              return prev
            })}
          >
            上月
          </button>
          <button
            className="rounded border px-3 py-1"
            onClick={() => setPivot(new Date())}
          >
            本月
          </button>
          <button
            className="rounded border px-3 py-1"
            onClick={() => setPivot(d => {
              const info = tpeMonthInfo(d)
              const next = new Date(`${info.year}-${String(info.month).padStart(2, '0')}-15T12:00:00+08:00`)
              next.setUTCMonth(next.getUTCMonth() + 1)
              return next
            })}
          >
            下月
          </button>
          <button className="rounded border px-3 py-1" onClick={load} disabled={loading}>
            {loading ? '更新中…' : '重新整理'}
          </button>
        </div>
      </div>

      <div className="text-lg font-medium">{monthName}</div>
      {err && (
        <div className="rounded border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
          載入失敗：{err}
        </div>
      )}

      {/* 週標頭 */}
      <div className="grid grid-cols-7 text-center text-xs text-slate-600">
        {['日','一','二','三','四','五','六'].map(d => (
          <div key={d} className="py-2">{`週${d}`}</div>
        ))}
      </div>

      {/* 42 格月曆 */}
      <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden">
        {keys.map(k => {
          const dayNum = Number(k.slice(-2))
          const todayKey = tpeDateKey(new Date())
          const isToday = k === todayKey
          const events = eventsByKey[k] ?? []
          return (
            <div key={k} className="bg-white min-h-[110px]">
              <div className={`flex items-center justify-between px-2 py-1 text-xs ${isToday ? 'bg-blue-50' : ''}`}>
                <span className={`font-medium ${isToday ? 'text-blue-700' : 'text-slate-700'}`}>{dayNum}</span>
                {isToday && <span className="text-[10px] text-blue-700">今天</span>}
              </div>
              <div className="px-2 pb-2 space-y-1">
                {events.map(ev => (
                  <div
                    key={ev.id}
                    className="text-[12px] leading-tight px-2 py-1 rounded bg-emerald-50 text-emerald-700 truncate"
                    title={ev.label}
                  >
                    {ev.label}
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="text-[11px] text-slate-300 px-2 py-1">—</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-slate-500">
        說明：每筆以「台北時間」顯示；內容為「開始時間 + 申請原因」。若原因未填，會顯示「（未填原因）」。
      </p>
    </div>
  )
}