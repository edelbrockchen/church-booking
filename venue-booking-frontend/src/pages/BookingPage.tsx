import React, { useMemo, useState } from 'react'

// ---- 主題顏色（可改）----
const BRAND = '#0F6FFF'

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

// 用於顯示時間（HH:mm）
function hhmm(d: Date) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

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
  const [timeHHMM, setTimeHHMM] = useState<string>('') // 例如 "16:00"
  // ✅ 預設全部未選
  const [weekday, setWeekday] = useState<Record<Weekday, boolean>>({
    0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false
  })

  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [confirmNote, setConfirmNote] = useState<string>('') // 顯示「已套用」訊息

  function toggleWD(i: Weekday) { setWeekday(p => ({ ...p, [i]: !p[i] })) }
  function selectWorkdays() { setWeekday({ 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false }) }
  function selectWeekendNoSun() { setWeekday({ 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: true }) }
  function clearWeekdays() { setWeekday({ 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }) }

  function confirmDates() {
    setConfirmNote('已套用日期/時間設定。')
    setTimeout(() => setConfirmNote(''), 2000)
  }

  // 預覽（重複申請才顯示）
  const preview = useMemo(() => {
    if (!repeat) return []
    setErr(null)
    const rs = rangeStart ? new Date(rangeStart) : null
    const re = rangeEnd ? new Date(rangeEnd) : null
    if (!rs || !re || re < rs) return []
    if (!withinTwoWeeks(rs, re)) return []
    // 時間來源：複選時使用 timeHHMM
    if (!timeHHMM) return []
    const [hhStr, mmStr] = timeHHMM.split(':')
    const hh = Number(hhStr), mm = Number(mmStr)
    if (Number.isNaN(hh) || Number.isNaN(mm)) return []

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
  }, [repeat, rangeStart, rangeEnd, timeHHMM, weekday])

  async function submit() {
    setErr(null); setOkMsg(null)
    if (!name.trim()) return setErr('請輸入申請者姓名')
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email.trim())) return setErr('請輸入有效的 E-Mail')
    if (!reason.trim()) return setErr('請輸入申請事由')

    setSubmitting(true)
    try {
      const payloads: Array<{ start: string; note: string; created_by: string; category: string }> = []

      if (repeat) {
        const rs = rangeStart ? new Date(rangeStart) : null
        const re = rangeEnd ? new Date(rangeEnd) : null
        if (!rs || !re || !withinTwoWeeks(rs, re)) { setSubmitting(false); return setErr('重複申請需提供有效的日期範圍（最長兩週）') }
        if (!preview.length) { setSubmitting(false); return setErr('請選擇起訖日期、時間與星期（週日不提供）') }

        for (const it of preview) {
          payloads.push({
            start: it.start.toISOString(),
            category: '其他',
            note: `【場地】${venue}｜【事由】${reason}｜【E-Mail】${email}`,
            created_by: name,
          })
        }
      } else {
        const sd = parseLocal(startAt)
        if (!sd) { setSubmitting(false); return setErr('請選擇起始時間') }
        if (sd.getDay() === 0) { setSubmitting(false); return setErr('週日不可申請') }
        payloads.push({
          start: sd.toISOString(),
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

  // 共用樣式
  const inputCx =
    `w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 shadow-inner
     focus:outline-none focus:ring-2 focus:ring-[${BRAND}] focus:border-[${BRAND}]`
  const selectCx =
    `w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-inner
     focus:outline-none focus:ring-2 focus:ring-[${BRAND}] focus:border-[${BRAND}]`
  // 1) 送出鈕黑底白字
  const primaryBtnCx =
    `inline-flex items-center rounded-2xl bg-black px-5 py-3 text-white hover:brightness-95 disabled:opacity-60 shadow-md`

  return (
    <>
      {/* 表單卡片 */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">填寫借用申請</h2>

        {/* 申請者姓名 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-1">申請者</label>
          <input className={inputCx} value={name} onChange={e => setName(e.target.value)} placeholder="請輸入姓名" />
        </div>

        {/* Email */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input className={inputCx} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" type="email" />
        </div>

        {/* 申請事由 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-1">申請事由</label>
          <textarea className={`${inputCx} min-h-28`} value={reason} onChange={e => setReason(e.target.value)} placeholder="請簡述用途（例如：研習活動／婚禮彩排）" />
        </div>

        {/* 借用場地 */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-1">借用場地</label>
          <select className={selectCx} value={venue} onChange={e => setVenue(e.target.value as Venue)}>
            <option value="" disabled>請選擇場地</option>
            <option value="大會堂">大會堂</option>
            <option value="康樂廳">康樂廳</option>
            <option value="其它教室">其它教室</option>
          </select>
        </div>

        {/* 單一日期區塊：在「重複申請」開啟時，整塊停用 + 灰階說明 */}
        <fieldset className={`mb-6 ${repeat ? 'opacity-60 pointer-events-none select-none' : ''}`}>
          <legend className="block text-sm font-medium text-slate-700 mb-2">單一日期</legend>

          {/* 開始時間 */}
          <div className="mb-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              開始時間
              <span className="ml-2 text-xs text-slate-500">（每日最早 07:00；週一/週三最晚 18:00；其他至 21:30；週日禁用）</span>
            </label>
            <input
              type="datetime-local"
              className={inputCx}
              value={startAt}
              onChange={e => setStartAt(e.target.value)}
              placeholder="yyyy/MM/dd -- --:--"
            />
          </div>

          {/* 結束時間（唯讀，自動=開始+3 小時，並依規範截斷） */}
          <div className="mb-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">結束時間（固定起始＋3 小時，唯讀）</label>
            <input type="datetime-local" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 shadow-inner" value={fmtLocal(autoEnd)} readOnly disabled />
            <p className="mt-1 text-xs text-slate-500">
              ＊ 系統固定每次 3 小時，並依規範自動截斷（週一/週三到 18:00；其餘至 21:30）。{truncated && '（此時段已截斷）'}
            </p>
          </div>

          <button type="button" onClick={confirmDates} className="mt-2 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            確定
          </button>
        </fieldset>

        {/* 重複申請 */}
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-white focus:ring-2"
              style={{ accentColor: BRAND }}
              checked={repeat}
              onChange={e => setRepeat(e.target.checked)}
            />
            重複申請（在日期範圍內的指定星期，最長兩週）
          </label>

          {repeat && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">開始日期</label>
                  <input type="date" className={inputCx} value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">結束日期（最長 2 週）</label>
                  <input type="date" className={inputCx} value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                </div>
                {/* 5) 複選時間：選擇起始時間（結束時間依規則自動+3並在預覽顯示/截斷） */}
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">開始時間（HH:mm）</label>
                  <input type="time" className={inputCx} value={timeHHMM} onChange={e => setTimeHHMM(e.target.value)} placeholder="16:00" />
                </div>
              </div>

              {/* ✅ 指定星期（checkbox pill，顏色不變；週日禁用） */}
              <div>
                <div className="block text-sm font-medium text-slate-700 mb-2">指定星期：</div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(WDL) as unknown as Weekday[]).map(wd => (
                    <label
                      key={wd}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl border text-sm bg-white text-slate-700 border-slate-300"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={weekday[wd]}
                        onChange={() => toggleWD(wd)}
                        disabled={wd === 0} // 2) 週日不能選
                      />
                      <span className={wd === 0 ? 'text-slate-400' : ''}>
                        {WDL[wd]}{wd === 0 && <span className="ml-1 text-xs">（週日禁用）</span>}
                      </span>
                    </label>
                  ))}
                </div>

                {/* 快捷鍵 */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectWorkdays}
                    className="px-3 py-1.5 rounded-2xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm"
                  >
                    一鍵選工作日（週一～週五）
                  </button>
                  <button
                    type="button"
                    onClick={selectWeekendNoSun}
                    className="px-3 py-1.5 rounded-2xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm"
                  >
                    一鍵選週末（排除週日）
                  </button>
                  <button
                    type="button"
                    onClick={clearWeekdays}
                    className="px-3 py-1.5 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 text-sm"
                  >
                    清空
                  </button>
                </div>

                <button type="button" onClick={confirmDates} className="mt-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                  確定
                </button>

                {/* 預覽清單 */}
                <div className="mt-4 max-h-56 overflow-auto space-y-2 pr-1">
                  {preview.map((it, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="font-medium">{it.date}（{WDL[it.wd]}）</div>
                      <div className="text-slate-700">
                        {hhmm(it.start)} → {hhmm(it.end)} {it.truncated && <span className="text-amber-600">(依規範截斷)</span>}
                      </div>
                    </div>
                  ))}
                  {!preview.length && (
                    <div className="text-xs text-slate-500">請選擇起訖日期、開始時間與星期（週日不提供）。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 若已開啟重複申請，額外說明以免誤會 */}
        {repeat && (
          <p className="mt-2 text-xs text-slate-500">
            已啟用「重複申請」，上方「單一日期」區塊已停用，實際送出將依複選日期與時間建立多筆申請。
          </p>
        )}

        {confirmNote && <div className="mt-3 text-sm text-green-700">{confirmNote}</div>}
      </div>

      {/* 頁面底部操作列（卡片外 → 位置在頁面下方） */}
      <div className="mt-4 pb-8">
        <button className={primaryBtnCx} disabled={submitting} onClick={submit}>
          {submitting ? '送出中…' : '送出申請單'}
        </button>

        {/* 訊息區（靠近按鈕更醒目） */}
        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        {okMsg && <div className="mt-3 text-sm text-green-700">{okMsg}</div>}
      </div>
    </>
  )
}