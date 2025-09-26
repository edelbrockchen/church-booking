import React, { useMemo, useState } from 'react'

// ---- 常數與工具 ----
const MAX_DAYS = 14
const DURATION_HOURS = 3
type Venue = '大會堂' | '康樂廳' | '其它教室'
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
const WDL: Record<Weekday, string> = { 0: '週日', 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五', 6: '週六' }

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function capOf(day: Date) { return (day.getDay() === 1 || day.getDay() === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 } }
function clampByRules(start: Date) {
  const targetEnd = addHours(start, DURATION_HOURS)
  const { h, m } = capOf(start)
  const cap = new Date(start); cap.setHours(h, m, 0, 0)
  const end = targetEnd > cap ? cap : targetEnd
  return { end, truncated: end < targetEnd }
}
function fmtLocal(d?: Date | null) {
  if (!d) return ''
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mm}`
}
function parseLocal(v: string) { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
function* daysBetween(a: Date, b: Date) { const d = new Date(a); while (d <= b) { yield new Date(d); d.setDate(d.getDate() + 1) } }
function withinTwoWeeks(a: Date, b: Date) { const days = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1; return days > 0 && days <= MAX_DAYS }

export default function BookingPage() {
  // 申請人與場地
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [venue, setVenue] = useState<Venue>('大會堂')

  // 單筆開始→自動算結束
  const [startAt, setStartAt] = useState<string>('') // datetime-local
  const startDate = parseLocal(startAt)
  const { end: autoEnd, truncated } = useMemo(() => {
    if (!startDate) return { end: null as Date | null, truncated: false }
    return clampByRules(startDate)
  }, [startAt])

  // 重複申請
  const [repeat, setRepeat] = useState(false)
  const [rangeStart, setRangeStart] = useState<string>('') // date
  const [rangeEnd, setRangeEnd] = useState<string>('')
  const [weekday, setWeekday] = useState<Record<Weekday, boolean>>({ 0: false, 1: true, 2: true, 3: true, 4: true, 5: false, 6: false })

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  function toggleWD(i: Weekday) { setWeekday(p => ({ ...p, [i]: !p[i] })) }

  // 預覽（重複申請才顯示）
  const preview = useMemo(() => {
    if (!repeat) return []
    setErr(null)
    const rs = rangeStart ? new Date(rangeStart) : null
    const re = rangeEnd ? new Date(rangeEnd) : null
    const tStart = startDate
    if (!rs || !re || !tStart) return []
    if (isNaN(rs.getTime()) || isNaN(re.getTime()) || re < rs) return []
    if (!withinTwoWeeks(rs, re)) return []
    const hh = tStart.getHours(), mm = tStart.getMinutes()

    const arr: { date: string; start: Date; end: Date; truncated: boolean; wd: Weekday }[] = []
    for (const d of daysBetween(rs, re)) {
      const wd = d.getDay() as Weekday
      if (wd === 0) continue // 週日禁用
      if (!weekday[wd]) continue
      const s = new Date(d); s.setHours(hh, mm, 0, 0)
      const { end, truncated } = clampByRules(s)
      arr.push({ date: d.toLocaleDateString(), start: s, end, truncated, wd })
    }
    return arr
  }, [repeat, rangeStart, rangeEnd, startAt, weekday])

  async function submit() {
    setErr(null); setOkMsg(null)

    // 基本驗證
    if (!name.trim()) return setErr('請輸入申請者姓名')
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return setErr('請輸入有效的 E-Mail')
    if (!reason.trim()) return setErr('請輸入申請事由')
    if (!startDate) return setErr('請選擇起始時間')

    setSubmitting(true)
    try {
      // 要送出的清單
      const payloads: Array<{ start: string; note: string; created_by: string; category: string }> = []

      if (repeat) {
        const rs = rangeStart ? new Date(rangeStart) : null
        const re = rangeEnd ? new Date(rangeEnd) : null
        if (!rs || !re || !withinTwoWeeks(rs, re)) {
          setSubmitting(false); return setErr('重複申請需提供有效的日期範圍（最長兩週）')
        }
        if (!preview.length) {
          setSubmitting(false); return setErr('所選星期在範圍內沒有可申請的日子（或全為週日）')
        }
        for (const it of preview) {
          payloads.push({
            start: it.start.toISOString(),
            category: '其他', // 與後端 AllowedCategories 對齊
            note: `【場地】${venue}｜【事由】${reason}｜【E-Mail】${email}`,
            created_by: name,
          })
        }
      } else {
        // 單筆
        if (startDate.getDay() === 0) { setSubmitting(false); return setErr('週日不可申請') }
        payloads.push({
          start: startDate.toISOString(),
          category: '其他',
          note: `【場地】${venue}｜【事由】${reason}｜【E-Mail】${email}`,
          created_by: name,
        })
      }

      let success = 0
      for (const p of payloads) {
        const r = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(p),
        })
        if (r.ok) success++
        else {
          const j = await r.json().catch(() => ({}))
          if (j?.error === 'must_accept_terms') { setErr('需先同意借用規範後才能申請。'); break }
          if (r.status === 401) { setErr('未登入或尚未建立使用者，請先登入。'); break }
          if (j?.error === 'overlap') { setErr('申請時間與既有預約重疊，請調整後再送出。'); break }
        }
      }
      if (success) setOkMsg(`已送出 ${success} 筆申請，待審核。`)
      else if (!err) setErr('申請未成功，請稍後再試。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">申請借用</h2>

      {/* Email */}
      <div className="mb-4">
        <label className="form-label">Email</label>
        <input className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
      </div>

      {/* 申請事由 */}
      <div className="mb-4">
        <label className="form-label">申請事由</label>
        <textarea className="input min-h-24" value={reason} onChange={e => setReason(e.target.value)} placeholder="請簡述用途…" />
      </div>

      {/* 借用場地 */}
      <div className="mb-4">
        <label className="form-label">借用場地</label>
        <select className="input" value={venue} onChange={e => setVenue(e.target.value as Venue)}>
          <option value="" disabled>請選擇場地</option>
          <option value="大會堂">大會堂</option>
          <option value="康樂廳">康樂廳</option>
          <option value="其它教室">其它教室</option>
        </select>
      </div>

      {/* 申請者姓名 */}
      <div className="mb-4">
        <label className="form-label">申請者姓名</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="請輸入姓名" />
      </div>

      {/* 開始時間 */}
      <div className="mb-1">
        <label className="form-label">開始時間（每日最早 07:00；週一/週三最晚 18:00；其他至 21:30；週日禁用）</label>
        <input
          type="datetime-local"
          className="input"
          value={startAt}
          onChange={e => setStartAt(e.target.value)}
          placeholder="yyyy/MM/dd -- --:--"
        />
      </div>

      {/* 結束時間（唯讀，自動=開始+3 小時，並依規範截斷） */}
      <div className="mb-2">
        <label className="form-label">結束時間（固定起始＋3 小時，唯讀）</label>
        <input
          type="datetime-local"
          className="input bg-slate-100"
          value={fmtLocal(autoEnd)}
          readOnly
          disabled
          placeholder="yyyy/MM/dd -- --:--"
        />
        <p className="mt-1 text-xs text-slate-500">＊ 系統固定每次 3 小時，結束時間自動等於起始＋3 小時（實際以後端為準）。{truncated && '（此時段因規範已截斷）'}</p>
      </div>

      {/* 重複申請 */}
      <div className="mt-4 mb-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} />
          重複申請（在日期範圍內的指定星期）
        </label>
      </div>

      {repeat && (
        <div className="rounded-xl border border-slate-200 p-4 mb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label">開始日期</label>
              <input type="date" className="input" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
            </div>
            <div>
              <label className="form-label">結束日期（最長兩週）</label>
              <input type="date" className="input" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
            </div>
          </div>
          <div className="mt-3">
            <div className="form-label mb-2">選擇星期</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(WDL) as unknown as Weekday[]).map(wd => (
                <button
                  key={wd}
                  type="button"
                  onClick={() => toggleWD(wd)}
                  className={`px-3 py-1 rounded-lg border ${weekday[wd] ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300'}`}
                >
                  {WDL[wd]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">兩週內會自動挑出所選星期建立多筆申請（週日自動排除）。</p>
          </div>

          {/* 預覽清單 */}
          <div className="mt-4 max-h-56 overflow-auto space-y-2 pr-1">
            {preview.map((it, i) => {
              const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="font-medium">{it.date}（{WDL[it.wd]}）</div>
                  <div className="text-slate-700">{hm(it.start)} → {hm(it.end)} {it.truncated && <span className="text-amber-600">(依規範截斷)</span>}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 動作區 */}
      <div className="mt-4">
        <button className="btn" disabled={submitting} onClick={submit}>{submitting ? '送出中…' : '送出申請'}</button>
      </div>

      {/* 訊息區 */}
      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
      {okMsg && <div className="mt-3 text-sm text-green-700">{okMsg}</div>}
    </div>
  )
}