// venue-booking-frontend/src/pages/BookingPage.tsx
import React, { useMemo, useState } from 'react'
import SubmitWithTermsGate from '../web/components/SubmitWithTermsGate'
import { apiFetch } from '../web/lib/api'

// 分類（空字串＝未分類）
type Category = '' | '教會聚會' | '社團活動' | '研習' | '其他'
type Venue = '大會堂' | '康樂廳' | '其它教室'
type Mode = 'single' | 'repeat'

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function fmtDate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function fmtLocal(d?: Date | null) {
  if (!d) return ''
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mm}`
}
function parseLocal(v: string) { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
function parseTimeToDate(baseDate: Date, hhmm: string) {
  const [hh, mm] = hhmm.split(':').map(Number)
  const d = new Date(baseDate); d.setHours(hh ?? 0, mm ?? 0, 0, 0)
  return d
}

/** --- 台北時間規則（透過 ISO +08:00 建立對齊的時間點） --- */
function tpeDateKey(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(d) // e.g. "2025-10-01"
}
function tpeDow(d: Date) { return new Date(`${tpeDateKey(d)}T12:00:00+08:00`).getUTCDay() } // 0..6
function earliestOfDayTPE(d: Date) { return new Date(`${tpeDateKey(d)}T07:00:00+08:00`) }
function latestCapTPE(d: Date) {
  const dow = tpeDow(d)
  const hhmm = (dow === 1 || dow === 3) ? '18:00:00' : '21:30:00'
  return new Date(`${tpeDateKey(d)}T${hhmm}+08:00`)
}
function isSundayTPE(d: Date) { return tpeDow(d) === 0 }

/** 將任意開始時間調整到「可申請窗口」並回傳狀態 */
function adjustToWindowTPE(s: Date) {
  if (isSundayTPE(s)) return { status: 'sunday' as const }
  const earliest = earliestOfDayTPE(s)
  const cap = latestCapTPE(s)

  let start = s
  let adjusted = false
  if (start.getTime() < earliest.getTime()) {
    start = earliest
    adjusted = true
  }
  if (start.getTime() >= cap.getTime()) {
    return { status: 'invalid' as const } // 當日可申請窗口已過
  }

  const targetEnd = addHours(start, 3)
  const end = new Date(Math.min(targetEnd.getTime(), cap.getTime()))
  const cut = end.getTime() < targetEnd.getTime()
  return { status: (cut || adjusted) ? ('adjusted' as const) : ('ok' as const), start, end, adjusted, cut }
}

export default function BookingPage() {
  /* ---------------- 基本狀態 ---------------- */
  const now = useMemo(() => {
    const n = new Date()
    const m = n.getMinutes()
    const rounded = new Date(n)
    rounded.setMinutes(m < 30 ? 30 : 0, 0, 0)
    if (m >= 30) rounded.setHours(n.getHours() + 1)
    return rounded
  }, [])

  const [mode, setMode] = useState<Mode>('single')

  // 申請人資訊（必填）
  const [applicant, setApplicant] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [venue, setVenue] = useState<Venue>('大會堂')

  // 其他設定
  const [category, setCategory] = useState<Category>('') // 空字串＝未分類
  const [reason, setReason] = useState('')               // 申請原因（改為必填）

  /* ---------------- 單日模式 ---------------- */
  const [startStr, setStartStr] = useState(fmtLocal(now))
  const start = parseLocal(startStr) || now

  const singleAdj = adjustToWindowTPE(start)
  const dayCap = latestCapTPE(start)
  const earliest = earliestOfDayTPE(start)
  const end = singleAdj && (singleAdj as any).end ? (singleAdj as any).end as Date : addHours(start, 3)

  const tpeHhmm = (d: Date) =>
    new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  const singleAllowedTip = `當日可申請時段（台北）：${tpeHhmm(earliest)} – ${tpeHhmm(dayCap)}（超出自動裁切/調整）`
  const singleEffectiveTip = `實際送出時段：${start.toLocaleString()} → ${end.toLocaleString()}${(singleAdj as any)?.cut || (singleAdj as any)?.adjusted ? '（已調整/裁切）' : ''}`
  const startMinLocal = fmtLocal(earliest)

  /* ---------------- 重複模式 ---------------- */
  const [rangeStart, setRangeStart] = useState(fmtDate(now))
  const [rangeEnd, setRangeEnd] = useState(fmtDate(addHours(now, 24 * 13))) // 最長 2 週
  const [repeatTime, setRepeatTime] = useState('07:00')
  const [repeatWds, setRepeatWds] = useState<{[k in 1|2|3|4|5|6]: boolean}>({1:true,2:true,3:true,4:true,5:true,6:false})

  type PreviewItem = { date: Date; start?: Date; end?: Date; status: 'ok'|'cut'|'skip_sun'|'invalid' }
  const repeatPreview: PreviewItem[] = useMemo(() => {
    const rs = new Date(rangeStart + 'T00:00:00')
    const re = new Date(rangeEnd + 'T23:59:59')
    const items: PreviewItem[] = []
    const MAX_DAYS = 31
    let cur = new Date(rs), i = 0
    while (cur <= re && i < MAX_DAYS) {
      const s = parseTimeToDate(cur, repeatTime)
      const dow = tpeDow(s)
      if (dow === 0 || !repeatWds[dow as 1|2|3|4|5|6]) {
        items.push({ date: new Date(cur), status: 'skip_sun' })
      } else {
        const adj = adjustToWindowTPE(s)
        if ((adj as any).status === 'invalid' || (adj as any).status === 'sunday') {
          items.push({ date: new Date(cur), status: 'invalid' })
        } else {
          items.push({ date: new Date(cur), start: (adj as any).start, end: (adj as any).end, status: (adj as any).cut ? 'cut' : 'ok' })
        }
      }
      const next = new Date(cur); next.setDate(cur.getDate() + 1); next.setHours(0,0,0,0)
      cur = next; i++
    }
    return items
  }, [rangeStart, rangeEnd, repeatTime, repeatWds])

  /* ---------------- 驗證 ---------------- */
  function validateCommon(): string | null {
    if (!applicant.trim()) return '請填寫申請者姓名'
    if (!email.trim()) return '請填寫電子郵件'
    if (!phone.trim()) return '請填寫聯絡電話'
    if (!venue) return '請選擇場地'
    if (!reason.trim()) return '請填寫申請原因'
    return null
  }
  function validateSingle(): string | null {
    const s = parseLocal(startStr)
    if (!s) return '請選擇開始日期時間'
    if ((adjustToWindowTPE(s) as any).status === 'invalid') return '該日可申請窗口已過，請改選其他時間'
    return null
  }
  function validateRepeat(): string | null {
    const rs = new Date(rangeStart + 'T00:00:00')
    const re = new Date(rangeEnd   + 'T23:59:59')
    const days = Math.floor((re.getTime() - rs.getTime())/86400000) + 1
    if (days > 14) return '重複日期最長 2 週'
    const anyWd = Object.values(repeatWds).some(Boolean)
    if (!anyWd) return '請至少選擇一個平日或週六'
    return null
  }

  /* ---------------- 提交 ---------------- */
  const [submitting, setSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState('')

  async function submit() {
    setSubmitting(true)
    setResultMsg('')
    try {
      const commonErr = validateCommon()
      if (commonErr) throw new Error(commonErr)

      const header = `[場地:${venue}] [姓名:${applicant}] [Email:${email}] [電話:${phone}]`
      const fullNote = header + (reason.trim() ? ` ${reason.trim()}` : '')

      if (mode === 'single') {
        const s = parseLocal(startStr)!
        const adj = adjustToWindowTPE(s)
        if ((adj as any).status === 'invalid' || (adj as any).status === 'sunday') {
          throw new Error('該日不可申請或已過上限，請改選其他時間')
        }
        const payload: any = {
          start: (adj as any).start.toISOString(),
          venue,
          created_by: applicant.trim(),
          note: fullNote,
          ...(category ? { category } : {})
        }
        const r = await apiFetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        if (!r.ok) {
          const j = await r.json().catch(() => null)
          throw new Error(JSON.stringify(j || { error: `HTTP ${r.status}` }))
        }
        setResultMsg('已送出 1 筆申請，等待管理者審核')
      } else {
        const err = validateRepeat()
        if (err) throw new Error(err)

        let count = 0
        for (const it of repeatPreview) {
          if (it.start && it.end) {
            const payload: any = {
              start: it.start.toISOString(),
              venue,
              created_by: applicant.trim(),
              note: fullNote,
              ...(category ? { category } : {})
            }
            const rr = await apiFetch('/api/bookings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
            if (!rr.ok) {
              const j = await rr.json().catch(() => null)
              throw new Error(JSON.stringify(j || { error: `HTTP ${rr.status}` }))
            }
            count++
          }
        }
        setResultMsg(`已送出 ${count} 筆重複日期申請，等待管理者審核`)
      }
    } catch (e: any) {
      let msg = e?.message || 'unknown'
      try {
        const jsonStr = msg.replace(/^.*?\{/, '{')
        const data = JSON.parse(jsonStr)
        if (data?.error === 'overlap') {
          if (data?.conflict) {
            const s = new Date(data.conflict.start_ts)
            const ee = new Date(data.conflict.end_ts)
            const fmt = new Intl.DateTimeFormat('zh-TW', { timeZone:'Asia/Taipei', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false })
            const range = `${fmt.format(s)}–${fmt.format(ee)}`
            msg = data?.message || `該場地已被申請（${data.conflict.venue ?? venue}；${range}）`
          } else {
            msg = data?.message || '該場地已被申請，請改時間或改場地。'
          }
        } else if (data?.error === 'must_accept_terms') {
          msg = '請先同意借用規範，再送出申請。'
        } else if (data?.error === 'sunday_disabled') {
          msg = '週日不可申請。'
        } else if (data?.error === 'too_late') {
          msg = '已超過當日可申請上限，請改選更早的時間。'
        } else if (data?.error === 'too_early') {
          msg = '每日最早 07:00 開放申請。'
        } else if (data?.error === 'invalid_payload') {
          msg = '送出的資料格式不正確，請重新整理或聯繫管理員。'
        }
      } catch {}
      setResultMsg(`送出失敗：${msg}`)
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  /* ---------------- UI ---------------- */
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <h2 className="text-2xl font-bold">申請借用</h2>

      {/* 模式切換 */}
      <div className="rounded-xl border p-4">
        <div className="flex items-center gap-6">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="mode" checked={mode==='single'} onChange={()=>setMode('single')} />
            單日
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="mode" checked={mode==='repeat'} onChange={()=>setMode('repeat')} />
            重複日期（最長 2 週）
          </label>
        </div>
      </div>

      {/* 申請人資訊 */}
      <div className="rounded-xl border p-4 space-y-4">
        <h3 className="font-semibold">申請人資訊</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">申請者姓名 <span className="text-rose-600">*</span></span>
            <input
              value={applicant}
              onChange={e=>setApplicant(e.target.value)}
              placeholder="請輸入姓名"
              className="rounded-lg border px-3 py-2 placeholder-slate-400"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">電子郵件 <span className="text-rose-600">*</span></span>
            <input
              type="email"
              value={email}
              onChange={e=>setEmail(e.target.value)}
              placeholder="name@example.com"
              className="rounded-lg border px-3 py-2 placeholder-slate-400"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">聯絡電話 <span className="text-rose-600">*</span></span>
            <input
              value={phone}
              onChange={e=>setPhone(e.target.value)}
              placeholder="例如：0912-345-678"
              className="rounded-lg border px-3 py-2 placeholder-slate-400"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">場地 <span className="text-rose-600">*</span></span>
            <select
              value={venue}
              onChange={e=>setVenue(e.target.value as Venue)}
              className="rounded-lg border px-3 py-2"
              required
            >
              <option value="大會堂">大會堂</option>
              <option value="康樂廳">康樂廳</option>
              <option value="其它教室">其它教室</option>
            </select>
          </label>
        </div>
      </div>

      {/* 其他設定 */}
      <div className="rounded-xl border p-4 space-y-4">
        <h3 className="font-semibold">其他設定</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">分類（可不選＝未分類）</span>
            <select value={category} onChange={e=>setCategory(e.target.value as Category)} className="rounded-lg border px-3 py-2">
              <option value="">（未分類）</option>
              <option value="教會聚會">教會聚會</option>
              <option value="社團活動">社團活動</option>
              <option value="研習">研習</option>
              <option value="其他">其他</option>
            </select>
          </label>

          <label className="md:col-span-2 flex flex-col gap-1">
            <span className="text-sm text-slate-600">申請原因 <span className="text-rose-600">*</span>（最多 200 字）</span>
            <textarea
              value={reason}
              onChange={e=>setReason(e.target.value)}
              rows={4}
              maxLength={200}
              placeholder="請敘明活動內容、需求等"
              className="rounded-lg border px-3 py-2"
              required
            />
          </label>
        </div>
      </div>

      {/* 日期與時間 */}
      <div className="rounded-xl border p-4 space-y-4">
        <h3 className="font-semibold">日期與時間</h3>

        {mode === 'single' ? (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-slate-600">開始時間（每日最早 07:00；以台北時間計）</span>
                <input
                  type="datetime-local"
                  value={startStr}
                  onChange={e => setStartStr(e.target.value)}
                  className="rounded-lg border px-3 py-2"
                  min={startMinLocal}
                />
                <div className="text-xs text-slate-500">{singleAllowedTip}</div>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm text-slate-600">結束時間（唯讀，最多 3 小時；超出上限自動裁切）</span>
                <input type="datetime-local" value={fmtLocal(end)} readOnly className="rounded-lg border px-3 py-2 bg-slate-50" />
              </label>
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">{singleEffectiveTip}</div>
            {validateSingle() && <div className="text-sm text-rose-600">{validateSingle()}</div>}
          </>
        ) : (
          <>
            <div className="grid md:grid-cols-3 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-sm text-slate-600">開始日期（最長 2 週）</span>
                <input type="date" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} className="rounded-lg border px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-slate-600">結束日期</span>
                <input type="date" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} className="rounded-lg border px-3 py-2" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm text-slate-600">每天開始時間</span>
                <input type="time" value={repeatTime} onChange={e=>setRepeatTime(e.target.value)} className="rounded-lg border px-3 py-2" />
              </label>
            </div>
            {/* 將冗長備註移出欄位，避免擠壓版面 */}
            <div className="text-xs text-slate-500">每天開始時間以台北時間計，最早 07:00。</div>

            {/* 重複日期預覽（以台北時間判斷有效性/裁切） */}
            <div className="space-y-2">
              <div className="text-sm text-slate-600">預覽（超出上限自動裁切；台北週日與未勾選星期將跳過）</div>
              <div className="rounded-lg border divide-y">
                {repeatPreview.map((it, idx) => {
                  const ds = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', weekday:'short' }).format(it.date)
                  let badge = '', badgeClass = ''
                  if (it.status === 'ok')        { badge = '可申請';  badgeClass = 'bg-emerald-100 text-emerald-700' }
                  if (it.status === 'cut')       { badge = '裁切';    badgeClass = 'bg-amber-100 text-amber-700' }
                  if (it.status === 'skip_sun')  { badge = '跳過';    badgeClass = 'bg-slate-100 text-slate-600' }
                  if (it.status === 'invalid')   { badge = '不可';    badgeClass = 'bg-rose-100 text-rose-700' }
                  return (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded ${badgeClass}`}>{badge}</span>
                        <span>{ds}（台北）</span>
                      </div>
                      <div className="text-right text-slate-700">
                        {(it.start && it.end) ? (
                          <span>
                            {
                              new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:false }).format(it.start)
                            } → {
                              new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour:'2-digit', minute:'2-digit', hour12:false }).format(it.end)
                            }（台北）
                          </span>
                        ) : (
                          <span className="text-slate-500">不送出</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {validateRepeat() && <div className="text-sm text-rose-600">{validateRepeat()}</div>}
          </>
        )}
      </div>

      {/* 送出 */}
      <div className="flex items-center gap-3">
        <SubmitWithTermsGate onSubmit={submit} />
        {submitting && <span className="text-sm text-slate-500">送出中…</span>}
      </div>

      {resultMsg && <div className="text-sm text-emerald-700">{resultMsg}</div>}

      <p className="text-xs text-slate-500">
        規範以台北時間計：每日最早 07:00；週一/週三最晚 18:00；其他至 21:30；週日禁用。每一日最多 3 小時。重複日期最長 2 週。
      </p>
    </div>
  )
}