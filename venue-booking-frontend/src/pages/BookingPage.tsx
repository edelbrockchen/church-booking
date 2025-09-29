// venue-booking-frontend/src/pages/BookingPage.tsx
import React, { useMemo, useState } from 'react'
import SubmitWithTermsGate from '../web/components/SubmitWithTermsGate'
import { apiFetch } from '../web/lib/api'

type Category = '教會聚會' | '婚禮' | '研習' | '其他'

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function fmtLocal(d?: Date | null) {
  if (!d) return ''
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${dd}T${hh}:${mm}`
}
function parseLocal(v: string) { const d = new Date(v); return isNaN(d.getTime()) ? null : d }

function latestEndCap(d: Date) {
  const wd = d.getDay()
  const cap = new Date(d)
  if (wd === 1 || wd === 3) cap.setHours(18, 0, 0, 0)   // 週一/週三最晚 18:00
  else cap.setHours(21, 30, 0, 0)                       // 其他日最晚 21:30
  return cap
}

export default function BookingPage() {
  const now = useMemo(() => {
    const n = new Date()
    const m = n.getMinutes()
    // round to next 30 min
    const rounded = new Date(n)
    rounded.setMinutes(m < 30 ? 30 : 0, 0, 0)
    if (m >= 30) rounded.setHours(n.getHours() + 1)
    return rounded
  }, [])

  const [startStr, setStartStr] = useState(fmtLocal(now))
  const start = parseLocal(startStr) || now
  const end = useMemo(() => {
    const target = addHours(start, 3)
    const cap = latestEndCap(start)
    return new Date(Math.min(target.getTime(), cap.getTime()))
  }, [startStr])

  const [category, setCategory] = useState<Category>('教會聚會')
  const [note, setNote] = useState('')
  const [createdBy, setCreatedBy] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState('')

  async function submit() {
    setSubmitting(true)
    setResultMsg('')
    try {
      const payload = {
        start: new Date(start).toISOString(),
        category,
        note: note.trim() || undefined,
        created_by: createdBy.trim() || undefined,
      }
      await apiFetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      setResultMsg('送出成功，等待管理者審核')
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

      <div className="grid md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">開始時間</span>
          <input
            type="datetime-local"
            value={startStr}
            onChange={e => setStartStr(e.target.value)}
            className="rounded-lg border px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">結束時間（唯讀，伺服器強制 3 小時上限/晚間上限）</span>
          <input
            type="datetime-local"
            value={fmtLocal(end)}
            readOnly
            className="rounded-lg border px-3 py-2 bg-slate-50"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">分類</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            className="rounded-lg border px-3 py-2"
          >
            <option value="教會聚會">教會聚會</option>
            <option value="婚禮">婚禮</option>
            <option value="研習">研習</option>
            <option value="其他">其他</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-slate-600">申請人（可選填）</span>
          <input
            value={createdBy}
            onChange={e => setCreatedBy(e.target.value)}
            placeholder="姓名或單位名稱"
            className="rounded-lg border px-3 py-2"
          />
        </label>

        <label className="md:col-span-2 flex flex-col gap-1">
          <span className="text-sm text-slate-600">備註（最多 200 字，可選填）</span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={4}
            className="rounded-lg border px-3 py-2"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitWithTermsGate onSubmit={submit} />
        {submitting && <span className="text-sm text-slate-500">送出中…</span>}
      </div>

      {resultMsg && <div className="text-sm text-emerald-700">{resultMsg}</div>}

      <p className="text-xs text-slate-500">
        伺服器會最終決定結束時間（3 小時上限；週一/週三最晚 18:00，其餘最晚 21:30）。
      </p>
    </div>
  )
}