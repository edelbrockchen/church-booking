import React, { useMemo, useState } from 'react'

// ---- 規範常數 ----
const MAX_WEEKS = 2
const MAX_DAYS = 14 // 兩週
const DURATION_HOURS = 3

type Venue = '大會堂' | '康樂廳' | '其它教室'

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Sun..Sat（Date.getDay）
const WEEKDAY_LABEL: Record<Weekday, string> = {
  0: '週日',
  1: '週一',
  2: '週二',
  3: '週三',
  4: '週四',
  5: '週五',
  6: '週六',
}

// ---- 時間工具 ----
function addHours(d: Date, h: number) {
  return new Date(d.getTime() + h * 3600_000)
}
function latestEndCap(d: Date) {
  const day = d.getDay()
  return (day === 1 || day === 3) // 週一 or 週三
    ? { hour: 18, minute: 0 }
    : { hour: 21, minute: 30 }
}
function clampByCap(start: Date, durationHours: number) {
  const targetEnd = addHours(start, durationHours)
  const { hour, minute } = latestEndCap(start)
  const cap = new Date(start)
  cap.setHours(hour, minute, 0, 0)
  const end = targetEnd.getTime() > cap.getTime() ? cap : targetEnd
  const truncated = end.getTime() < targetEnd.getTime()
  return { end, truncated }
}
function isSunday(d: Date) {
  return d.getDay() === 0
}
function toISODate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function parseTimeHHMM(value: string): { hour: number; minute: number } | null {
  // e.g. "16:00"
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const h = Number(m[1]); const mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return { hour: h, minute: mm }
}
function withinTwoWeeks(start: Date, end: Date) {
  const diffDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
  return diffDays > 0 && diffDays <= MAX_DAYS
}
function* eachDateInRange(start: Date, end: Date) {
  const cur = new Date(start)
  while (cur <= end) {
    yield new Date(cur)
    cur.setDate(cur.getDate() + 1)
  }
}

export default function BookingPage() {
  // 申請人/表單欄位
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [venue, setVenue] = useState<Venue>('大會堂')

  // 區間與時間
  const [dateStart, setDateStart] = useState(toISODate(new Date()))
  const [dateEnd, setDateEnd] = useState(toISODate(new Date()))
  const [startTime, setStartTime] = useState('16:00') // 預設 16:00
  const [repeatMode, setRepeatMode] = useState<'none' | 'weekdays'>('none')
  const [weekdaySel, setWeekdaySel] = useState<Record<Weekday, boolean>>({
    0: false, 1: true, 2: true, 3: true, 4: true, 5: false, 6: false
  })

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // 預覽：根據條件產生每一天的開始/結束時間（自動截斷）
  const preview = useMemo(() => {
    setErr(null)
    setOkMsg(null)

    // 驗證基本欄位
    if (!name.trim()) return { items: [], error: '請輸入申請者姓名' }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return { items: [], error: 'E-Mail 格式不正確' }
    if (!reason.trim()) return { items: [], error: '請輸入申請事由' }

    const sDate = new Date(dateStart)
    const eDate = new Date(dateEnd)
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return { items: [], error: '請選擇有效的日期區間' }
    }
    if (eDate < sDate) return { items: [], error: '結束日期不可早於開始日期' }
    if (!withinTwoWeeks(sDate, eDate)) {
      return { items: [], error: `可申請最長為 ${MAX_WEEKS} 週（${MAX_DAYS} 天）` }
    }

    const t = parseTimeHHMM(startTime)
    if (!t) return { items: [], error: '請輸入有效的開始時間（HH:mm）' }

    const items: Array<{
      date: string
      startISO: string
      endISO: string
      truncated: boolean
      weekday: Weekday
    }> = []

    for (const day of eachDateInRange(sDate, eDate)) {
      if (isSunday(day)) continue // 週日禁用

      const wd = day.getDay() as Weekday
      if (repeatMode === 'weekdays') {
        if (!weekdaySel[wd]) continue
      }

      const start = new Date(day)
      start.setHours(t.hour, t.minute, 0, 0)

      const { end, truncated } = clampByCap(start, DURATION_HOURS)

      items.push({
        date: toISODate(day),
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        truncated,
        weekday: wd,
      })
    }

    if (items.length === 0) {
      return { items: [], error: '條件下沒有可申請的日期（可能全落在週日或未勾選週幾）' }
    }

    return { items, error: null }
  }, [name, email, reason, venue, dateStart, dateEnd, startTime, repeatMode, weekdaySel])

  async function submitAll() {
    setErr(null); setOkMsg(null)
    const result = preview
    if (result.error) { setErr(result.error); return }
    setSubmitting(true)
    try {
      let success = 0
      for (const it of result.items) {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            start: it.startISO,
            category: venue, // 後端 AllowedCategories 目前是 ['教會聚會','婚禮','研習','其他']；若要寫場地可自行放寬或以 note 記錄
            note: `【場地】${venue}｜【事由】${reason}｜【E-Mail】${email}`,
            created_by: name,
          }),
        })
        if (res.ok) success++
        else {
          const j = await res.json().catch(() => ({}))
          // 若未同意規範 / 未登入，後端會回 403/401
          if (j?.error === 'must_accept_terms') {
            setErr('後端回覆：需先同意借用規範。請在首頁按「申請借用」，同意規範後再送出。')
            break
          }
          if (res.status === 401) {
            setErr('後端回覆：未登入或尚未建立使用者。請先登入後再送出。')
            break
          }
          // 其他錯誤繼續嘗試下一筆
        }
      }
      if (success > 0) {
        setOkMsg(`已送出 ${success} 筆申請。待管理者審核。`)
      } else if (!err) {
        setErr('申請未成功，請稍後再試或聯絡管理員。')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function toggleWeekday(wd: Weekday) {
    setWeekdaySel(prev => ({ ...prev, [wd]: !prev[wd] }))
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* 表單區 */}
      <section className="md:col-span-2 card">
        <h2 className="text-lg font-semibold mb-4">申請資料</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="form-label">申請者姓名</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="請輸入姓名" />
          </div>
          <div>
            <label className="form-label">E-Mail</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label">申請事由</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="簡述用途，例如：研習活動 / 婚禮彩排" />
          </div>
          <div>
            <label className="form-label">申請場地</label>
            <select className="input" value={venue} onChange={e => setVenue(e.target.value as Venue)}>
              <option value="大會堂">大會堂</option>
              <option value="康樂廳">康樂廳</option>
              <option value="其它教室">其它教室</option>
            </select>
          </div>

          <div>
            <label className="form-label">開始日期</label>
            <input type="date" className="input" value={dateStart} onChange={e => setDateStart(e.target.value)} />
          </div>
          <div>
            <label className="form-label">結束日期（最長 2 週）</label>
            <input type="date" className="input" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
          </div>

          <div>
            <label className="form-label">每天開始時間</label>
            <input className="input" value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="HH:mm，例如 16:00" />
            <p className="mt-1 text-xs text-slate-500">系統會自動套用 3 小時原則，並依規範在週一/週三最晚 18:00、其餘 21:30 截斷。</p>
          </div>

          <div>
            <label className="form-label">重複方式</label>
            <select className="input" value={repeatMode} onChange={e => setRepeatMode(e.target.value as any)}>
              <option value="none">不重複（只使用日期區間的每一天）</option>
              <option value="weekdays">勾選每週幾（兩週內的對應日子）</option>
            </select>
          </div>

          {repeatMode === 'weekdays' && (
            <div className="sm:col-span-2">
              <div className="form-label mb-2">選擇每週幾</div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(WEEKDAY_LABEL) as unknown as Weekday[]).map(wd => (
                  <button
                    key={wd}
                    type="button"
                    onClick={() => toggleWeekday(wd)}
                    className={`px-3 py-1 rounded-lg border ${weekdaySel[wd] ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'}`}
                  >
                    {WEEKDAY_LABEL[wd]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">系統將在兩週內，自動挑出所選的星期日子建立申請（週日自動排除）。</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button className="btn-ghost" onClick={() => { /* 可以加清除表單 */ }}>清除</button>
          <button className="btn" disabled={submitting} onClick={submitAll}>{submitting ? '送出中…' : '送出申請（批次）'}</button>
        </div>

        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        {okMsg && <div className="mt-3 text-sm text-green-700">{okMsg}</div>}
      </section>

      {/* 預覽區 */}
      <aside className="card">
        <h3 className="font-medium mb-3">預覽（依規範自動截斷）</h3>
        <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
          {preview.error && <div className="text-sm text-red-600">{preview.error}</div>}
          {!preview.error && preview.items.map((it, idx) => {
            const start = new Date(it.startISO)
            const end = new Date(it.endISO)
            const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
            return (
              <div key={idx} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="font-medium">{it.date}（{WEEKDAY_LABEL[it.weekday]}）</div>
                <div className="text-slate-700">{hm(start)} → {hm(end)} {it.truncated && <span className="text-amber-600">(依規範截斷)</span>}</div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          說明：每筆申請固定 3 小時；週一/週三最晚至 18:00、其餘至 21:30；週日不可申請。
        </p>
      </aside>
    </div>
  )
}