// venue-booking-frontend/src/pages/BookingPage.tsx
import React, { useMemo, useState } from 'react'
import SubmitWithTermsGate from '../web/components/SubmitWithTermsGate'
import { apiFetch } from '../web/lib/api'

// 分類：把「婚禮」改為「社團活動」，並保留「未分類」(空字串) 會使用行事曆 default 樣式
type Category = '' | '教會聚會' | '社團活動' | '研習' | '其他'
// 場地：必填
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
function latestEndCap(d: Date) {
  const wd = d.getDay()
  const cap = new Date(d)
  if (wd === 1 || wd === 3) cap.setHours(18, 0, 0, 0)   // 週一/週三最晚 18:00
  else cap.setHours(21, 30, 0, 0)                       // 其他日最晚 21:30
  return cap
}
function isSunday(d: Date) { return d.getDay() === 0 }

export default function BookingPage() {
  // ---- 基本值 ----
  const now = useMemo(() => {
    const n = new Date()
    const m = n.getMinutes()
    const rounded = new Date(n)
    // 取下個 30 分鐘刻度
    rounded.setMinutes(m < 30 ? 30 : 0, 0, 0)
    if (m >= 30) rounded.setHours(n.getHours() + 1)
    // 最早 07:00
    if (rounded.getHours() < 7) rounded.setHours(7, 0, 0, 0)
    return rounded
  }, [])

  // ---- 表單狀態 ----
  const [mode, setMode] = useState<Mode>('single')

  // 單日
  const [startStr, setStartStr] = useState(fmtLocal(now))
  const start = parseLocal(startStr) || now

  // 重複
  const [rangeStart, setRangeStart] = useState(fmtDate(now))
  const [rangeEnd, setRangeEnd] = useState(fmtDate(addHours(now, 24*13))) // 預設 2 週內
  const [repeatTime, setRepeatTime] = useState('07:00') // 時段起始（每天同一時間）
  const [repeatWds, setRepeatWds] = useState<{[k in 1|2|3|4|5|6]: boolean}>({1:true,2:true,3:true,4:true,5:true,6:false}) // 週一~週六
  // 週日禁用，不提供 0

  // 共用（結束時間以 3 小時為基準並受晚間上限裁切）
  const end = useMemo(() => {
    const base = mode === 'single' ? (parseLocal(startStr) || now) : parseTimeToDate(new Date(rangeStart), repeatTime)
    const target = addHours(base, 3)
    const cap = latestEndCap(base)
    return new Date(Math.min(target.getTime(), cap.getTime()))
  }, [mode, startStr, rangeStart, repeatTime])

  // 必填欄位
  const [applicant, setApplicant] = useState('') // 申請者姓名（→ created_by）
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [venue, setVenue] = useState<Venue>('大會堂')

  // 選填
  const [category, setCategory] = useState<Category>('') // 空字串＝未分類
  const [note, setNote] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState('')

  // ---- 驗證 ----
  function validateSingle(): string | null {
    const s = parseLocal(startStr)
    if (!s) return '請選擇開始日期時間'
    if (isSunday(s)) return '週日不可申請'
    if (s.getHours() < 7) return '每日最早 07:00'
    const cap = latestEndCap(s)
    if (s.getTime() >= cap.getTime()) return `當日最晚 ${cap.getHours().toString().padStart(2,'0')}:${cap.getMinutes().toString().padStart(2,'0')} 前開始`
    return null
  }
  function validateRepeat(): string | null {
    const rs = new Date(rangeStart + 'T00:00:00')
    const re = new Date(rangeEnd   + 'T23:59:59')
    const days = Math.floor((re.getTime() - rs.getTime())/86400000) + 1
    if (days > 14) return '重複日期最長 2 週'
    if (re < rs) return '結束日期不可早於開始日期'
    const anyWd = Object.values(repeatWds).some(Boolean)
    if (!anyWd) return '請至少選擇一個平日或週六'
    const time = parseTimeToDate(rs, repeatTime)
    if (time.getHours() < 7) return '每日最早 07:00'
    return null
  }
  function validateCommon(): string | null {
    if (!applicant.trim()) return '請填寫申請者姓名'
    if (!email.trim()) return '請填寫電子郵件'
    if (!phone.trim()) return '請填寫聯絡電話'
    if (!venue) return '請選擇場地'
    return null
  }

  // ---- 提交 ----
  async function submit() {
    setSubmitting(true)
    setResultMsg('')
    try {
      // 共同 note：把聯絡資訊與場地寫入 note（後端會一起保存）
      const header = `[場地:${venue}] [姓名:${applicant}] [Email:${email}] [電話:${phone}]`
      const fullNote = header + (note.trim() ? ` ${note.trim()}` : '')

      const commonErr = validateCommon()
      if (commonErr) throw new Error(commonErr)

      if (mode === 'single') {
        const err = validateSingle()
        if (err) throw new Error(err)
        const s = parseLocal(startStr)!
        const cap = latestEndCap(s)
        const end3h = addHours(s, 3)
        const finalStart = s
        const finalEnd = new Date(Math.min(end3h.getTime(), cap.getTime()))
        // 前端只送 start；後端會套 3h 和上限（這裡僅做前端檢查/提示）
        const payload: any = {
          start: finalStart.toISOString(),
          created_by: applicant.trim(),
          note: fullNote,
        }
        if (category) payload.category = category
        await apiFetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        setResultMsg('已送出 1 筆申請，等待管理者審核')
      } else {
        const err = validateRepeat()
        if (err) throw new Error(err)
        // 逐日建立（跳過週日；只取所選星期）
        const rs = new Date(rangeStart + 'T00:00:00')
        const re = new Date(rangeEnd   + 'T23:59:59')
        let cur = new Date(rs)
        let count = 0

        while (cur <= re) {
          const wd = cur.getDay() as 0|1|2|3|4|5|6
          if (wd !== 0 && repeatWds[wd as 1|2|3|4|5|6]) {
            const s = parseTimeToDate(cur, repeatTime)
            const cap = latestEndCap(s)
            if (s.getHours() >= 7 && s.getTime() < cap.getTime()) {
              const payload: any = {
                start: s.toISOString(),
                created_by: applicant.trim(),
                note: fullNote,
              }
              if (category) payload.category = category
              // 逐筆送出（避免一次爆掉）；若要更快可改為 Promise.all，但失敗比較難提示
              await apiFetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              })
              count++
            }
          }
          const next = new Date(cur); next.setDate(cur.getDate() + 1); next.setHours(0,0,0,0)
          cur = next
        }
        setResultMsg(`已送出 ${count} 筆重複日期申請，等待管理者審核`)
      }
    } catch (e: any) {
      setResultMsg(`送出失敗：${e?.message || 'unknown'}`)
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h2 className="text-2xl font-bold">申請借用</h2>

      {/* 模式切換 */}
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="mode" checked={mode==='single'} onChange={()=>setMode('single')} />
          單日
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="mode" checked={mode==='repeat'} onChange={()=>setMode('repeat')} />
          重複日期（最長 2 週）
        </label>
      </div>

      {/* 必填欄位 */}
      <div className="grid md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">申請者姓名（必填）</span>
          <input value={applicant} onChange={e=>setApplicant(e.target.value)} className="rounded-lg border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">電子郵件（必填）</span>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="rounded-lg border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">聯絡電話（必填）</span>
          <input value={phone} onChange={e=>setPhone(e.target.value)} className="rounded-lg border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">場地（必填）</span>
          <select value={venue} onChange={e=>setVenue(e.target.value as Venue)} className="rounded-lg border px-3 py-2">
            <option value="大會堂">大會堂</option>
            <option value="康樂廳">康樂廳</option>
            <option value="其它教室">其它教室</option>
          </select>
        </label>
      </div>

      {/* 單日 or 重複 日期/時間 */}
      {mode === 'single' ? (
        <div className="grid md:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">開始時間（最早 07:00；週日禁用）</span>
            <input
              type="datetime-local"
              value={startStr}
              onChange={e => setStartStr(e.target.value)}
              className="rounded-lg border px-3 py-2"
              min={`${fmtDate(new Date())}T07:00`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-slate-600">結束時間（唯讀，最多 3 小時且受晚間上限）</span>
            <input type="datetime-local" value={fmtLocal(end)} readOnly className="rounded-lg border px-3 py-2 bg-slate-50" />
          </label>
        </div>
      ) : (
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
            <span className="text-sm text-slate-600">每天開始時間（最早 07:00）</span>
            <input type="time" value={repeatTime} onChange={e=>setRepeatTime(e.target.value)} className="rounded-lg border px-3 py-2" min="07:00" />
          </label>

          <div className="md:col-span-3">
            <div className="text-sm text-slate-600 mb-1">選擇星期（週日禁用）</div>
            <div className="flex flex-wrap gap-3">
              {[1,2,3,4,5,6].map(wd => (
                <label key={wd} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={repeatWds[wd as 1|2|3|4|5|6]} onChange={e=>setRepeatWds(s=>({...s, [wd]: e.target.checked}))} />
                  {['','週一','週二','週三','週四','週五','週六'][wd]}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 其他欄位 */}
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

        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">備註（最多 200 字，可選填）</span>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows={4} className="rounded-lg border px-3 py-2" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitWithTermsGate onSubmit={submit} />
        {submitting && <span className="text-sm text-slate-500">送出中…</span>}
      </div>

      {resultMsg && <div className="text-sm text-emerald-700">{resultMsg}</div>}

      <p className="text-xs text-slate-500">
        規範：每日最早 07:00；週一/週三最晚 18:00；其他至 21:30；週日禁用；每一日最多 3 小時。
        重複日期最長 2 週；單日申請不受 2 週限制。
      </p>
    </div>
  )
}