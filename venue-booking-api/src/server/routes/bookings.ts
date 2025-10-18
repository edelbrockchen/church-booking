// src/server/routes/bookings.ts
import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { makePool } from '../db'

const router = Router()
const pool = makePool()

type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

// ---- 固定 3.5 小時 ----
const DURATION_MS = 3.5 * 60 * 60 * 1000

/* ---------------- 台北時區規則（固定 3.5 小時） ---------------- */
function getTWParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(d)
  const byType: Record<string, string> = {}
  parts.forEach((p) => {
    if (p.type !== 'literal') byType[p.type] = p.value
  })
  const hour = Number(byType.hour)
  const minute = Number(byType.minute)
  const wkStr = byType.weekday
  const wk =
    wkStr.includes('日') ? 0 :
    wkStr.includes('一') ? 1 :
    wkStr.includes('二') ? 2 :
    wkStr.includes('三') ? 3 :
    wkStr.includes('四') ? 4 :
    wkStr.includes('五') ? 5 : 6
  return { hour, minute, wk }
}

function ruleCheckTW(start: Date): { ok: boolean; reason?: string } {
  const { hour, minute, wk } = getTWParts(start)
  if (wk === 0) return { ok: false, reason: '週日不開放借用' }
  if (hour < 7) return { ok: false, reason: '最早可申請 07:00' }

  // +3.5 小時（多 30 分）
  let endHour = hour + 3
  let endMinute = minute + 30
  if (endMinute >= 60) { endHour += 1; endMinute -= 60 }

  const limit = (wk === 1 || wk === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 }
  const exceed =
    endHour > limit.h ||
    (endHour === limit.h && endMinute > limit.m)

  if (exceed) {
    return {
      ok: false,
      reason: `該日最晚結束 ${String(limit.h).padStart(2, '0')}:${String(limit.m).padStart(2, '0')}`,
    }
  }
  return { ok: true }
}

/* ---------------- Zod Schema（放寬 & 正規化） ---------------- */
const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v)

const VenueInput = z
  .preprocess(trim, z.enum(['大會堂', '康樂廳', '其它教室', '其他教室']))
  .transform((v) => (v === '其他教室' ? ('其它教室' as const) : (v as '大會堂' | '康樂廳' | '其它教室')))

const CreateBody = z.object({
  start: z.preprocess(trim, z.string().min(10)), // ISO 字串
  applicantName: z.preprocess(trim, z.string().optional()),
  email: z.preprocess(trim, z.string().optional()),
  phone: z.preprocess(trim, z.string().optional()),
  venue: VenueInput,
  category: z.preprocess(trim, z.string().min(1)),
  note: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.string()).optional().default(''),
})
type CreateInput = z.infer<typeof CreateBody>

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

    if (status) {
      params.push(status)
      where.push(`status = $${params.length}`)
    }

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
  // 相容舊鍵名 → 映射到新欄位
  const body: any = { ...(req.body ?? {}) }
  if (!body.applicantName) body.applicantName = body.name ?? body.applicant ?? body.applicant_name
  if (!body.email) body.email = body.mail ?? body.emailAddress ?? body.contactEmail
  if (!body.phone) body.phone = body.tel ?? body.mobile ?? body.phoneNumber

  const parsed = CreateBody.safeParse(body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() })
  }

  const data = parsed.data as CreateInput

  // 有填才驗證 email/phone
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return res
      .status(400)
      .json({ error: 'invalid_body', details: { fieldErrors: { email: ['Invalid email'] }, formErrors: [] } })
  }
  if (data.phone && data.phone.length < 5) {
    return res
      .status(400)
      .json({ error: 'invalid_body', details: { fieldErrors: { phone: ['Too short'] }, formErrors: [] } })
  }

  const startDate = new Date(data.start)
  if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'invalid_start' })

  const rule = ruleCheckTW(startDate)
  if (!rule.ok) return res.status(400).json({ error: 'rule_violation', reason: rule.reason })

  // 改為 3.5 小時
  const endDate = new Date(startDate.getTime() + DURATION_MS)

  const p = pool
  if (!p) return res.status(503).json({ error: 'db_unavailable' })

  const client = await p.connect()
  try {
    await client.query('BEGIN')

    // 只把 pending / approved 視為會佔用（rejected/cancelled 不擋）
    const overlapSQL = `
      SELECT id, start_ts, end_ts, venue, status
      FROM bookings
      WHERE venue = $1
        AND status IN ('pending','approved')
        AND tstzrange(start_ts, end_ts, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      LIMIT 1
    `
    const ov = await client.query(overlapSQL, [data.venue, startDate.toISOString(), endDate.toISOString()])
    if ((ov.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: 'overlap',
        conflict: ov.rows[0],
        message: '該時段已有審核中或已核准的申請',
      })
    }

    const id = randomUUID()
    const insertSQL = `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, venue, note)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
    `
    const displayName =
      data.applicantName && data.applicantName !== '' ? data.applicantName : '（未填）'
    const extra =
      `${data.note ?? ''}` +
      `${data.email ? `\nEmail: ${data.email}` : ''}` +
      `${data.phone ? `\nPhone: ${data.phone}` : ''}`

    await client.query(insertSQL, [
      id,
      startDate.toISOString(),
      endDate.toISOString(),
      displayName, // created_by
      data.category,
      data.venue, // 已正規化
      extra.trim(),
    ])

    await client.query('COMMIT')
    res
      .status(201)
      .json({ id, start_ts: startDate.toISOString(), end_ts: endDate.toISOString() })
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
    res
      .status(typeof err?.status === 'number' ? err.status : 500)
      .json({ error: 'internal_error' })
  }
})

/* ---------------- 清單（可過濾狀態） ---------------- */
router.get('/list', async (req, res) => {
  try {
    const rawDays = Number(req.query.days)
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(180, rawDays)) : 60
    const s = String(req.query.status || '').trim().toLowerCase() as BookingStatus | ''
    const status: BookingStatus | undefined =
      s === 'approved' || s === 'rejected' || s === 'cancelled' || s === 'pending'
        ? s
        : undefined

    const rows = await listBookings(days, status)
    res.json({ items: rows })
  } catch (err: any) {
    res
      .status(typeof err?.status === 'number' ? err.status : 500)
      .json({ error: 'internal_error' })
  }
})

export default router
