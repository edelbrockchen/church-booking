// src/server/routes/bookings.ts
import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { makePool } from '../db'

const router = Router()
const pool = makePool()

type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

/* ---------------- 台北時區規則（固定 3 小時） ---------------- */
function getTWParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const parts = fmt.formatToParts(d)
  const byType: Record<string, string> = {}
  parts.forEach((p) => { if (p.type !== 'literal') byType[p.type] = p.value })
  const hour = Number(byType.hour)
  const minute = Number(byType.minute)
  const wkStr = byType.weekday
  const wk = wkStr.includes('日') ? 0
    : wkStr.includes('一') ? 1
    : wkStr.includes('二') ? 2
    : wkStr.includes('三') ? 3
    : wkStr.includes('四') ? 4
    : wkStr.includes('五') ? 5 : 6
  return { hour, minute, wk }
}
function ruleCheckTW(start: Date): { ok: boolean; reason?: string } {
  const { hour, minute, wk } = getTWParts(start)
  if (wk === 0) return { ok: false, reason: '週日不開放借用' }
  if (hour < 7) return { ok: false, reason: '最早可申請 07:00' }
  const endHour = hour + 3
  const endMinute = minute
  const limit = (wk === 1 || wk === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 }
  if (endHour > limit.h || (endHour === limit.h && endMinute > limit.m)) {
    return { ok: false, reason: `該日最晚結束 ${String(limit.h).padStart(2,'0')}:${String(limit.m).padStart(2,'0')}` }
  }
  return { ok: true }
}

/* ---------------- Zod Schema（放寬 & 正規化） ---------------- */
const VenueInput = z.preprocess(
  v => typeof v === 'string' ? v.trim() : v,
  z.union([
    z.literal('大會堂'),
    z.literal('康樂廳'),
    z.literal('其它教室'),
    z.literal('其他教室'), // 同音異字也接受
  ])
).transform(v => (v === '其他教室' ? ('其它教室' as const) : (v as '大會堂'|'康樂廳'|'其它教室')))

const CreateBody = z.object({
  start: z.string().min(10), // ISO 字串；伺服器會 new Date 驗證
  applicantName: z.string().transform(s => s.trim()).min(1),
  email: z.string().transform(s => s.trim()).email(),
  phone: z.string().transform(s => s.trim()).min(5),
  venue: VenueInput,
  category: z.string().transform(s => s.trim()).min(1),
  note: z.string().optional().default(''),
})

/* ---------------- DB 查詢共用 ---------------- */
async function listBookings(days: number, status?: BookingStatus) {
  const p = pool
  if (!p) throw Object.assign(new Error('db_unavailable'), { status: 503 })
  const client = await p.connect()
  try {
    const where: string[] = []
    const params: any[] = []
    params.push(days)
    where.push(`start_ts >= (now() - ($${params.length}::text || ' days')::interval)`)
    if (status && status !== 'pending') { params.push(status); where.push(`status = $${params.length}`) }
    const sql = `
      SELECT id, start_ts, end_ts, status, category, venue, note
      FROM bookings
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY start_ts ASC
      LIMIT 1000
    `
    const rows = (await client.query(sql, params)).rows
    return rows
  } finally {
    client.release()
  }
}

/* ---------------- 建立申請單 ---------------- */
router.post('/', async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) {
    // 讓前端比較好定位錯誤
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
  }

  const { start, applicantName, email, phone, venue, category, note } = parsed.data
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'invalid_start' })

  const rule = ruleCheckTW(startDate)
  if (!rule.ok) return res.status(400).json({ error: 'rule_violation', reason: rule.reason })

  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)

  const p = pool
  if (!p) return res.status(503).json({ error: 'db_unavailable' })

  const client = await p.connect()
  try {
    await client.query('BEGIN')

    const overlapSQL = `
      SELECT 1 FROM bookings
      WHERE venue = $1
        AND tstzrange(start_ts, end_ts, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      LIMIT 1
    `
    const ov = await client.query(overlapSQL, [venue, startDate.toISOString(), endDate.toISOString()])
    if ((ov.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    const insertSQL = `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, venue, note)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
    `
    await client.query(insertSQL, [
      id,
      startDate.toISOString(),
      endDate.toISOString(),
      applicantName,
      category,
      venue, // 已正規化
      `${note ?? ''}\nEmail: ${email}\nPhone: ${phone}`.trim(),
    ])

    await client.query('COMMIT')
    res.status(201).json({ id, start_ts: startDate.toISOString(), end_ts: endDate.toISOString() })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[bookings] create error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

/* ---------------- 舊相容：只取核准 ---------------- */
router.get('/approved', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, Number(req.query.days ?? 60)))
    const rows = await listBookings(days, 'approved')
    res.json({ items: rows })
  } catch (err: any) {
    res.status(typeof err?.status === 'number' ? err.status : 500).json({ error: 'internal_error' })
  }
})

/* ---------------- 清單（可過濾狀態） ---------------- */
router.get('/list', async (req, res) => {
  try {
    const rawDays = Number(req.query.days)
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(180, rawDays)) : 60
    const s = String(req.query.status || '').trim().toLowerCase() as BookingStatus | ''
    const status: BookingStatus | undefined =
      (s === 'approved' || s === 'rejected' || s === 'cancelled' || s === 'pending') ? s : undefined

    const rows = await listBookings(days, status)
    res.json({ items: rows })
  } catch (err: any) {
    res.status(typeof err?.status === 'number' ? err.status : 500).json({ error: 'internal_error' })
  }
})

export default router
