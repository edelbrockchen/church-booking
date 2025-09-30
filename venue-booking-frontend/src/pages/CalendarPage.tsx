// src/pages/CalendarPage.tsx
import React, { useEffect, useMemo, useState } from 'react'

/** 從 props 接 apiBase，沒有則回退到環境變數（本地可為空字串→走 Vite 代理） */
type Props = { apiBase?: string }

const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL || ''

/** 後端回傳格式（保持相容：category / note 可能不存在） */
type ApprovedItem = {
  id: string
  start_ts: string
  end_ts: string
  created_by?: string | null
  category?: string | null
  note?: string | null
}

/** 內部切片後顯示用 */
type DayPiece = {
  id: string
  dayKey: string           // YYYY-MM-DD（本地時區）
  start: Date
  end: Date
  created_by?: string | null
  category?: string | null
  note?: string | null
}

type MonthKey = { y: number; m: number } // m: 0-11
type ViewMode = 'month' | 'week' | 'day'

/* ====== 小工具 ====== */
function fmtTime(d: Date) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

/** 以「本地時區」產 YYYY-MM-DD（避免 toISOString 造成 UTC 偏移） */
function ymdLocal(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function startOfWeek(d: Date) {
  const x = new Date(d)
  const wd = x.getDay() // 0(日)~6(六) 本地
  x.setDate(x.getDate() - wd)
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x }

/** 產生月曆 6 週（像 Google Calendar） */
function buildMonthGrid(key: MonthKey) {
  const first = new Date(key.y, key.m, 1)
  const gridStart = startOfWeek(first) // 以週日為首
  const days: Date[] = []
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i))
  return days
}

/** 把跨日事件切成以「日」為單位的片段，方便塞進日格（本地時區） */
function splitByDay(item: ApprovedItem): DayPiece[] {
  const s = new Date(item.start_ts)
  const e = new Date(item.end_ts)
  const out: DayPiece[] = []
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return out

  let cur = new Date(s)
  while (cur < e) {
    const dayEnd = new Date(cur); dayEnd.setHours(23, 59, 59, 999)
    const segEnd = e < dayEnd ? e : dayEnd
    out.push({
      id: item.id,
      dayKey: ymdLocal(cur),
      start: new Date(cur),
      end: new Date(segEnd),
      created_by: item.created_by ?? undefined,
      category: item.category ?? undefined,
      note: item.note ?? undefined
    })
    const next = new Date(cur); next.setDate(cur.getDate() + 1); next.setHours(0, 0, 0, 0)
    cur = next
  }
  return out
}

/** 類別顏色（可按需增修）。沒有 category 就用 'default'。 */
const CATEGORY_STYLE: Record<string, { chip: string; dot: string; pill: string }> = {
  default:  { chip: 'bg-brand-100 text-brand-700', dot: 'bg-brand-600',  pill: 'bg-brand-600 text-white' },
  教會聚會: { chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-600', pill: 'bg-emerald-600 text-white' },
  社團活動: { chip: 'bg-rose-100 text-rose-700',       dot: 'bg-rose-600',    pill: 'bg-rose-600 text-white' },
  研習:     { chip: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-600',  pill: 'bg-indigo-600 text-white' },
  其他:     { chip: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-600',   pill: 'bg-amber-600 text-white' }
}

/** 取得類別樣式（含 fallback） */
function catStyle(category?: string | null) {
  if (!category) return CATEGORY_STYLE.default
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.default
}

/** 從 note 萃取「申請原因」：移除像 [場地:][姓名:][Email:][電話:] 這類方括號資訊 */
function extractReason(note?: string | null) {
  if (!note) return ''
  // 先移除所有 [xxx:yyy] 標籤
  let s = note.replace(/\[[^\]]+\]/g, '').trim()
  // 壓掉多餘空白
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/* ====== 主元件 ====== */
export default function CalendarPage({ apiBase }: Props) {
  const API_BASE = (apiBase ?? ENV_API_BASE ?? '').replace(/\/+$/, '') // 去尾斜線，避免 //api
  const now = new Date()
  const [mode, setMode] = useState<ViewMode>('month')
  const [month, setMonth] = useState<MonthKey>({ y: now.getFullYear(), m: now.getMonth() })
  const [anchor, setAnchor] = useState<Date>(startOfWeek(now)) // 週/日模式的定位點（週首日）
  const [items, setItems] = useState<ApprovedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setErr] = useState<string | null>(null)
  const [active, setActive] = useState<DayPiece | null>(null) // 事件詳情卡

  const monthDays = useMemo(() => buildMonthGrid(month), [month])
  const weekDays  = useMemo(() => Array.from({length:7}, (_,i) => addDays(anchor, i)), [anchor])

  useEffect(() => {
    let mounted = true
    const ac = new AbortController()
    ;(async () => {
      setLoading(true); setErr(null)
      try {
        // 你後端若路由不同（例如 /api/bookings），請在這裡對齊
        const url = `${API_BASE}/api/bookings/approved`
        // 逾時保護（8 秒）
        const t = setTimeout(() => ac.abort('timeout'), 8000)
        const r = await fetch(url, {
          credentials: 'include', // 若後端用 Session/Cookie 必須帶上
          headers: { 'Accept': 'application/json' },
          signal: ac.signal,
        })
        clearTimeout(t)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = await r.json()
        if (mounted) setItems(Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [])
      } catch (e: any) {
        // fetch TypeError / abort 多半是 CORS、HTTPS 混合內容或網路中斷
        const msg =
          e?.name === 'AbortError' ? '連線逾時（請檢查後端是否可達 / CORS）' :
          e?.message?.includes('Failed to fetch') ? '連線失敗（可能是 CORS 或 HTTPS 網域不一致）' :
          e?.message || '資料載入失敗'
        if (mounted) setErr(msg)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false; ac.abort() }
  }, [API_BASE])

  /** 把所有事件切片後按日分組並排序 */
  const byDay = useMemo(() => {
    const map = new Map<string, DayPiece[]>()
    for (const it of items) {
      for (const seg of splitByDay(it)) {
        const list = map.get(seg.dayKey) ?? []
        list.push(seg); map.set(seg.dayKey, list)
      }
    }
    for (const [k, list] of map) {
      list.sort((a,b) => a.start.getTime() - b.start.getTime())
      map.set(k, list)
    }
    return map
  }, [items])

  /* ====== 導覽控制 ====== */
  function prev() {
    if (mode === 'month') {
      const d = new Date(month.y, month.m, 1); d.setMonth(month.m - 1)
      setMonth({ y: d.getFullYear(), m: d.getMonth() })
    } else if (mode === 'week') {
      setAnchor(addDays(anchor, -7))
    } else {
      setAnchor(addDays(anchor, -1))
    }
  }
  function next() {
    if (mode === 'month') {
      const d = new Date(month.y, month.m, 1); d.setMonth(month.m + 1)
      setMonth({ y: d.getFullYear(), m: d.getMonth() })
    } else if (mode === 'week') {
      setAnchor(addDays(anchor, 7))
    } else {
      setAnchor(addDays(anchor, 1))
    }
  }
  function today() {
    const t = new Date()
    if (mode === 'month') setMonth({ y: t.getFullYear(), m: t.getMonth() })
    else setAnchor(startOfWeek(t))
  }

  const monthLabel = new Date(month.y, month.m, 1).toLocaleDateString([], { year: 'numeric', month: 'long' })
  const weekLabel = `${weekDays[0].toLocaleDateString()} ~ ${weekDays[6].toLocaleDateString()}`
  const dayLabel  = anchor.toLocaleDateString()
  const tzLabel   = Intl.DateTimeFormat().resolvedOptions().timeZone
  const weekNames = ['日','一','二','三','四','五','六']

  /* ====== UI ====== */
  return (
    <div className="space-y-4">
      {/* 控制列 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={prev}>← 上一個</button>
          <button className="btn-ghost" onClick={today}>今天</button>
          <button className="btn-ghost" onClick={next}>下一個 →</button>
        </div>

        <div className="flex items-center gap-2 text-lg font-semibold">
          {mode === 'month' && monthLabel}
          {mode === 'week'  && `本週：${weekLabel}`}
          {mode === 'day'   && `這一天：${dayLabel}`}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">時區：{tzLabel}</span>
          <div className="border-l h-5 mx-2" />
          <div className="inline-flex rounded-2xl border border-slate-300 overflow-hidden">
            <button className={`px-3 py-1 text-sm ${mode==='month'?'bg-slate-200':''}`} onClick={()=>setMode('month')}>月</button>
            <button className={`px-3 py-1 text-sm ${mode==='week'?'bg-slate-200':''}`}  onClick={()=>setMode('week')}>週</button>
            <button className={`px-3 py-1 text-sm ${mode==='day'?'bg-slate-200':''}`}   onClick={()=>setMode('day')}>日</button>
          </div>
        </div>
      </div>

      {/* 載入／錯誤 */}
      {loading && <div className="card text-sm text-slate-600">載入中…</div>}
      {error   && <div className="card text-sm text-rose-600">載入失敗：{error}</div>}

      {/* 視圖 */}
      {mode === 'month' && (
        <MonthView days={monthDays} byDay={byDay} currentMonth={month.m} onPick={setActive} />
      )}
      {mode === 'week' && (
        <WeekView days={weekDays} byDay={byDay} onPick={setActive} />
      )}
      {mode === 'day' && (
        <DayView day={anchor} byDay={byDay} onPick={setActive} />
      )}

      {/* 類別圖例（僅示意幾種） */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 mr-1">圖例：</span>
        {Object.entries(CATEGORY_STYLE).map(([name, st]) => (
          <span key={name} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${st.chip}`}>
            <span className={`size-2 rounded-full ${st.dot}`} />
            {name}
          </span>
        ))}
      </div>

      {/* 事件詳情卡（Modal） */}
      {active && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={()=>setActive(null)}>
          <div className="card max-w-md w-full" onClick={(e)=>e.stopPropagation()}>
            <div className="mb-2 text-lg font-semibold">事件詳情</div>
            <div className="space-y-1 text-sm">
              <div><span className="text-slate-500">日期：</span>{active.dayKey}</div>
              <div><span className="text-slate-500">時間：</span>{fmtTime(active.start)}–{fmtTime(active.end)}</div>
              <div><span className="text-slate-500">申請人：</span>{active.created_by || '—'}</div>
              <div><span className="text-slate-500">分類：</span>{active.category || 'default'}</div>
              <div><span className="text-slate-500">申請原因：</span>{extractReason(active.note) || '（未填）'}</div>
            </div>
            <div className="mt-4 text-right">
              <button className="btn-ghost" onClick={()=>setActive(null)}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ====== 子視圖元件 ====== */

function MonthView({
  days, byDay, currentMonth, onPick
}: {
  days: Date[]
  byDay: Map<string, DayPiece[]>
  currentMonth: number
  onPick: (p: DayPiece)=>void
}) {
  const weekNames = ['日','一','二','三','四','五','六']
  return (
    <div className="grid grid-cols-7 gap-px rounded-2xl overflow-hidden border border-slate-200 bg-slate-200">
      {weekNames.map(w=>(
        <div key={w} className="bg-slate-50 px-2 py-1 text-center text-xs font-medium text-slate-500">{w}</div>
      ))}
      {days.map((d, i) => {
        const inMonth = d.getMonth() === currentMonth
        const isToday = d.toDateString() === new Date().toDateString()
        const key = ymdLocal(d)
        const list = byDay.get(key) ?? []
        return (
          <div key={i} className={`min-h-28 bg-white p-2 ${!inMonth ? 'bg-slate-50 text-slate-400':''}`}>
            <div className="flex items-center justify-between">
              <div className={[
                'inline-flex items-center justify-center size-6 rounded-full text-xs',
                isToday ? 'bg-brand-600 text-white font-semibold shadow-soft' : 'text-slate-700'
              ].join(' ')}>
                {d.getDate()}
              </div>
              {list.length>0 && <div className="text-[10px] text-slate-500">共 {list.length} 筆</div>}
            </div>
            <div className="mt-1 space-y-1">
              {list.slice(0,4).map(ev=>{
                const st = catStyle(ev.category)
                const reason = extractReason(ev.note) || '（未填原因）'
                return (
                  <button
                    key={`${ev.id}-${ev.start.toISOString()}`}
                    className={`w-full text-left truncate rounded-md px-2 py-1 text-xs ${st.chip}`}
                    onClick={()=>onPick(ev)}
                    title={`${fmtTime(ev.start)} · ${reason}`}
                  >
                    <span className={`inline-block size-2 rounded-full mr-1 align-middle ${st.dot}`} />
                    {fmtTime(ev.start)} · {reason}
                  </button>
                )
              })}
              {list.length>4 && <div className="text-[10px] text-slate-500">… 還有 {list.length-4} 筆</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekView({
  days, byDay, onPick
}: {
  days: Date[]
  byDay: Map<string, DayPiece[]>
  onPick: (p: DayPiece)=>void
}) {
  return (
    <div className="grid md:grid-cols-7 grid-cols-1 gap-2">
      {days.map((d,i)=>{
        const key = ymdLocal(d)
        const list = byDay.get(key) ?? []
        const isToday = d.toDateString() === new Date().toDateString()
        return (
          <div key={i} className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`size-6 grid place-items-center rounded-full text-xs ${isToday?'bg-brand-600 text-white':'bg-slate-100 text-slate-700'}`}>
                  {['日','一','二','三','四','五','六'][d.getDay()]}
                </div>
                <div className="text-sm">{d.toLocaleDateString()}</div>
              </div>
              {list.length>0 && <div className="text-[10px] text-slate-500">共 {list.length} 筆</div>}
            </div>
            <div className="space-y-1">
              {list.map(ev=>{
                const st = catStyle(ev.category)
                const reason = extractReason(ev.note) || '（未填原因）'
                return (
                  <button
                    key={`${ev.id}-${ev.start.toISOString()}`}
                    className={`w-full text-left truncate rounded-md px-2 py-1 text-xs ${st.chip}`}
                    onClick={()=>onPick(ev)}
                    title={`${fmtTime(ev.start)} · ${reason}`}
                  >
                    <span className={`inline-block size-2 rounded-full mr-1 align-middle ${st.dot}`} />
                    {fmtTime(ev.start)} · {reason}
                  </button>
                )
              })}
              {list.length===0 && <div className="text-xs text-slate-400">— 無 —</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayView({
  day, byDay, onPick
}: {
  day: Date
  byDay: Map<string, DayPiece[]>
  onPick: (p: DayPiece)=>void
}) {
  const key = ymdLocal(day)
  const list = byDay.get(key) ?? []
  return (
    <div className="card">
      <div className="mb-2 text-sm text-slate-600">{day.toLocaleDateString()}（{['日','一','二','三','四','五','六'][day.getDay()]}）</div>
      <div className="space-y-1">
        {list.map(ev=>{
          const st = catStyle(ev.category)
          const reason = extractReason(ev.note) || '（未填原因）'
          return (
            <button
              key={`${ev.id}-${ev.start.toISOString()}`}
              className={`w-full text-left truncate rounded-md px-3 py-2 text-sm ${st.chip}`}
              onClick={()=>onPick(ev)}
              title={`${fmtTime(ev.start)} · ${reason}`}
            >
              <span className={`inline-block size-2 rounded-full mr-2 align-middle ${st.dot}`} />
              {fmtTime(ev.start)} · {reason}
            </button>
          )
        })}
        {list.length===0 && <div className="text-sm text-slate-400">今日尚無已核准借用</div>}
      </div>
    </div>
  )
}