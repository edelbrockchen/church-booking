import React, { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

type ApprovedItem = {
  id: string
  start_ts: string // ISO
  end_ts: string   // ISO
  created_by?: string | null
}

type MonthKey = { y: number; m: number } // m: 0-11

// 工具：當地時區格式
function fmtDate(d: Date) { return d.toLocaleDateString() }
function fmtTime(d: Date) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

// 取當月的 6 週格（前後補齊，像 Google Calendar）
function buildMonthGrid(key: MonthKey) {
  const first = new Date(key.y, key.m, 1)
  const startDay = first.getDay() // 0(日)~6(六)
  // 以週一為首看起來也很好，不過此處沿用週日為首（和台灣 Google Calendar 預設一致）
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - startDay) // 從這天開始畫 6*7 = 42 格

  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    days.push(d)
  }
  return days
}

// 把跨日事件切成「每天」的片段，方便放進日格
function splitByDay(item: ApprovedItem) {
  const start = new Date(item.start_ts)
  const end = new Date(item.end_ts)
  const pieces: { id: string; dayKey: string; start: Date; end: Date }[] = []
  // 安全保護
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return pieces

  let cur = new Date(start)
  while (cur < end) {
    const dayEnd = new Date(cur)
    dayEnd.setHours(23, 59, 59, 999)
    const segEnd = end < dayEnd ? end : dayEnd

    const dayKey = cur.toISOString().slice(0, 10) // YYYY-MM-DD（UTC 切鍵，但顯示使用在地時間即可）
    pieces.push({ id: item.id, dayKey, start: new Date(cur), end: new Date(segEnd) })

    // 下一天 00:00
    const next = new Date(cur)
    next.setDate(cur.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    cur = next
  }
  return pieces
}

export default function CalendarPage() {
  const today = new Date()
  const [month, setMonth] = useState<MonthKey>({ y: today.getFullYear(), m: today.getMonth() })
  const [items, setItems] = useState<ApprovedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setErr] = useState<string | null>(null)

  const days = useMemo(() => buildMonthGrid(month), [month])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(`${API_BASE}/api/bookings/approved`, { credentials: 'include' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (mounted) setItems(Array.isArray(j.items) ? j.items : [])
      } catch (e: any) {
        if (mounted) setErr(e?.message || '資料載入失敗')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  // 依日分組（跨日切片後再分組）
  const byDay = useMemo(() => {
    const map = new Map<string, { id: string; start: Date; end: Date }[]>()
    for (const it of items) {
      for (const seg of splitByDay(it)) {
        const list = map.get(seg.dayKey) ?? []
        list.push({ id: seg.id, start: seg.start, end: seg.end })
        map.set(seg.dayKey, list)
      }
    }
    // 每日依開始時間排序
    for (const [k, list] of map) {
      list.sort((a, b) => a.start.getTime() - b.start.getTime())
      map.set(k, list)
    }
    return map
  }, [items])

  function prevMonth() {
    setMonth((cur) => {
      const d = new Date(cur.y, cur.m, 1); d.setMonth(cur.m - 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  function nextMonth() {
    setMonth((cur) => {
      const d = new Date(cur.y, cur.m, 1); d.setMonth(cur.m + 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  function thisMonth() {
    const d = new Date()
    setMonth({ y: d.getFullYear(), m: d.getMonth() })
  }

  const monthLabel = new Date(month.y, month.m, 1).toLocaleDateString([], { year: 'numeric', month: 'long' })
  const weekLabels = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div className="space-y-4">
      {/* 控制列 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={prevMonth}>← 上個月</button>
          <button className="btn-ghost" onClick={thisMonth}>今天</button>
          <button className="btn-ghost" onClick={nextMonth}>下個月 →</button>
        </div>
        <div className="text-lg font-semibold">{monthLabel}</div>
        <div className="text-xs text-slate-500">
          時區：{Intl.DateTimeFormat().resolvedOptions().timeZone}
        </div>
      </div>

      {/* 載入／錯誤 */}
      {loading && <div className="card text-sm text-slate-600">載入中…</div>}
      {error && <div className="card text-sm text-rose-600">載入失敗：{error}</div>}

      {/* 月曆 */}
      <div className="grid grid-cols-7 gap-px rounded-xl2 overflow-hidden border border-slate-200 bg-slate-200">
        {/* 週標 */}
        {weekLabels.map(w => (
          <div key={w} className="bg-slate-50 px-2 py-1 text-center text-xs font-medium text-slate-500">{w}</div>
        ))}

        {/* 日格（6 週 * 7 天） */}
        {days.map((d, idx) => {
          const inMonth = d.getMonth() === month.m
          const isToday = d.toDateString() === new Date().toDateString()
          const dayKey = d.toISOString().slice(0, 10)
          const dayEvents = byDay.get(dayKey) ?? []

          return (
            <div
              key={idx}
              className={[
                'min-h-28 bg-white p-2',
                !inMonth ? 'bg-slate-50 text-slate-400' : '',
                'relative'
              ].join(' ')}
            >
              {/* 日期角標 */}
              <div className="flex items-center justify-between">
                <div className={[
                  'inline-flex items-center justify-center size-6 rounded-full text-xs',
                  isToday ? 'bg-brand-600 text-white font-semibold shadow-soft' : 'text-slate-700'
                ].join(' ')}>
                  {d.getDate()}
                </div>
                {/* 當日事件數量 */}
                {dayEvents.length > 0 && (
                  <div className="text-[10px] text-slate-500">共 {dayEvents.length} 筆</div>
                )}
              </div>

              {/* 事件列表 */}
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 4).map(ev => (
                  <div key={`${ev.id}-${ev.start.toISOString()}`} className="truncate rounded-md bg-brand-100 px-2 py-1 text-xs text-brand-700">
                    {fmtTime(ev.start)}–{fmtTime(ev.end)}
                  </div>
                ))}
                {dayEvents.length > 4 && (
                  <div className="text-[10px] text-slate-500">… 還有 {dayEvents.length - 4} 筆</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 備註 */}
      <div className="text-xs text-slate-500">
        僅顯示「已核准」的借用。時間皆依瀏覽器的在地時區呈現。
      </div>
    </div>
  )
}