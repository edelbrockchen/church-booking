import React, { useMemo, useState } from 'react'
import { bookingsApi, type BookingCreateInput } from '../web/lib/api'
import RepeatTwoWeeksPicker from '../web/components/RepeatTwoWeeksPicker'

/** ISO -> <input type="datetime-local"> 需要的本地時區字串 (YYYY-MM-DDTHH:mm) */
function isoToLocalInput(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}

/** <input type="datetime-local"> 的值 -> ISO 字串 */
function localInputToIso(v: string) {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

const VENUES: Array<BookingCreateInput['venue'] | '其他教室'> = [
  '大會堂',
  '康樂廳',
  '其它教室',
  '其他教室', // 後端會正規化為「其它教室」
]

export default function BookingPage() {
  // 表單狀態（start 以 ISO 保存，轉給 input 才做本地格式）
  const [form, setForm] = useState<BookingCreateInput>({
    start: new Date().toISOString(),
    applicantName: '',
    email: '',
    phone: '',
    venue: '大會堂',
    category: '',
    note: '',
  })

  // 由「連續 2 週」元件回拋的起始時間清單（預設包含第一筆）
  const [startsFromPicker, setStartsFromPicker] = useState<string[]>([form.start])

  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string>('')

  const localStart = useMemo(() => isoToLocalInput(form.start), [form.start])

  function set<K extends keyof BookingCreateInput>(key: K, val: BookingCreateInput[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage('')

    try {
      const starts = (startsFromPicker?.length ?? 0) > 0 ? startsFromPicker : [form.start]

      // 基本驗證（避免空白類別/無效時間）
      if (!starts[0]) throw new Error('請選擇開始時間')
      if (!form.category?.trim()) throw new Error('請填寫用途/類別')

      if (starts.length === 1) {
        await bookingsApi.create(form)
        setMessage('已成功送出 1 筆申請')
      } else {
        const { start: _ignored, ...base } = form
        const { ok, fail } = await bookingsApi.createMany(base, starts)
        setMessage(`批次送出完成：成功 ${ok.length} 筆，失敗 ${fail.length} 筆`)
      }
    } catch (err: any) {
      setMessage(err?.message ?? '送出失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">申請借用</h2>

      <form onSubmit={onSubmit} className="space-y-4 max-w-xl">
        {/* 開始時間（本地） */}
        <div className="flex items-center gap-3">
          <label className="w-24">開始時間</label>
          <input
            type="datetime-local"
            value={localStart}
            onChange={(e) => set('start', localInputToIso(e.target.value))}
            className="border rounded px-3 py-2 w-full"
            required
          />
        </div>

        {/* 場地 */}
        <div className="flex items-center gap-3">
          <label className="w-24">場地</label>
          <select
            value={form.venue}
            onChange={(e) => set('venue', e.target.value as any)}
            className="border rounded px-3 py-2 w-full"
          >
            {VENUES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* 用途/類別 */}
        <div className="flex items-center gap-3">
          <label className="w-24">用途/類別</label>
          <input
            type="text"
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            className="border rounded px-3 py-2 w-full"
            placeholder="例如：小組聚會 / 試唱 / 課程"
            required
          />
        </div>

        {/* 申請人資訊（選填，後端已寬鬆） */}
        <div className="flex items-center gap-3">
          <label className="w-24">申請人</label>
          <input
            type="text"
            value={form.applicantName}
            onChange={(e) => set('applicantName', e.target.value)}
            className="border rounded px-3 py-2 w-full"
            placeholder="（可留空）"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="w-24">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            className="border rounded px-3 py-2 w-full"
            placeholder="（可留空）"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="w-24">電話</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            className="border rounded px-3 py-2 w-full"
            placeholder="（可留空）"
          />
        </div>

        {/* 備註（選填） */}
        <div className="flex items-start gap-3">
          <label className="w-24 pt-2">備註</label>
          <textarea
            value={form.note ?? ''}
            onChange={(e) => set('note', e.target.value)}
            className="border rounded px-3 py-2 w-full"
            rows={3}
          />
        </div>

        {/* 連續 2 週（自選星期） */}
        <div className="border rounded p-3">
          <RepeatTwoWeeksPicker
            firstStartISO={form.start}
            onStartsPreview={setStartsFromPicker}
          />
        </div>

        {/* 預覽與提交 */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-500">
            將建立：{startsFromPicker.length} 筆（每筆固定 3 小時）
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg border bg-zinc-800 text-white disabled:opacity-60"
          >
            {submitting ? '送出中…' : '送出申請'}
          </button>
        </div>

        {message && <div className="text-sm text-zinc-700">{message}</div>}
      </form>
    </div>
  )
}
