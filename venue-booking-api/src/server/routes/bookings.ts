// venue-booking-api/src/server/routes/bookings.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

export const bookingsRouter = Router()
const pool = makePool()

// 可接受的分類（也可放寬為任意字串）
const AllowedCategories = ['教會聚會', '婚禮', '研習', '其他'] as const

const createSchema = z.object({
  start: z.string().datetime(),
  // 下列皆為選填；若前端沒傳，後端也會給預設值
  category: z
    .string()
    .trim()
    .optional()
    .transform(v => (v && v.length ? v : undefined))
    .refine(v => !v || AllowedCategories.includes(v as any), { message: 'invalid_category' }),
  note: z.string().trim().max(200).optional(),
  created_by: z.string().trim().max(100).optional(),
})

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function isSunday(d: Date) { return d.getDay() === 0 }
function latestEnd(d: Date) {
  const day = d.getDay()
  // 週一 / 週三 最晚 18:00；其餘 21:30
  return day === 1 || day === 3 ? { hour: 18, minute: 0 } : { hour: 21, minute: 30 }
}

// 依你實際的 session 結構調整
function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}
function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}

bookingsRouter.post('/', async (req, res) => {
  const p = createSchema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })

  const start = new Date(p.data.start)
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'invalid_start' })
  if (isSunday(start)) return res.status(400).json({ error: 'sunday_disabled' })

  // 3 小時原則；一/三最晚 18:00，其餘 21:30，超過則截短
  const targetEnd = addHours(start, 3)
  const { hour, minute } = latestEnd(start)
  const cap = new Date(start); cap.setHours(hour, minute, 0, 0)
  const end = targetEnd.getTime() > cap.getTime() ? cap : targetEnd
  const truncated = end.getTime() < targetEnd.getTime()

  const category = (p.data.category as (typeof AllowedCategories)[number] | undefined) ?? undefined
  const note = p.data.note ?? undefined
  const created_by = p.data.created_by ?? undefined

  // 無 DB 的 demo 回覆（保留你的原行為）
  if (!pool) {
    return res.status(201).json({
      id: 'demo-' + Math.random().toString(36).slice(2),
      start: start.toISOString(),
      end: end.toISOString(),
      truncated,
      persisted: false,
      status: 'pending',
      category: category ?? 'default',
      note: note ?? '',
      created_by: created_by ?? '',
    })
  }

  const c = await pool.connect()
  try {
    // ✅ 最終把關：必須先同意借用規範
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    const has = await c.query('SELECT 1 FROM terms_acceptances WHERE user_id=$1 LIMIT 1', [userId])
    if (has.rowCount === 0) return res.status(403).json({ error: 'must_accept_terms' })

    await c.query('BEGIN')

    // 檢查重疊（半開區間 [) 避免尾端貼齊判定為重疊）
    const overlap = await c.query(
      `
      SELECT 1 FROM bookings
      WHERE tstzrange(start_ts, end_ts, '[)') && tstzrange($1::timestamptz, $2::timestamptz, '[)')
      LIMIT 1
      `,
      [start.toISOString(), end.toISOString()]
    )
    if (overlap.rows.length > 0) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    await c.query(
      `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, note)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6)
      `,
      [id, start.toISOString(), end.toISOString(), created_by ?? userId ?? null, category ?? null, note ?? null]
    )

    await c.query('COMMIT')
    return res.status(201).json({
      id,
      start: start.toISOString(),
      end: end.toISOString(),
      truncated,
      persisted: true,
      status: 'pending',
      category: category ?? 'default',
      note: note ?? '',
      created_by: created_by ?? userId ?? '',
    })
  } catch (e: any) {
    await c.query('ROLLBACK')
    if (e?.constraint === 'no_overlap') {
      return res.status(409).json({ error: 'overlap' })
    }
    console.error('[bookings] insert failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})

bookingsRouter.get('/', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(
    `
    SELECT id, start_ts, end_ts, created_at, created_by, status,
           reviewed_at, reviewed_by, rejection_reason, category, note
    FROM bookings
    ORDER BY start_ts ASC
  `
  )
  res.json({ items: rows })
})

bookingsRouter.get('/approved', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(
    `
    SELECT id, start_ts, end_ts, created_by, category, note
    FROM bookings
    WHERE status = 'approved'
    ORDER BY start_ts ASC
  `
  )
  res.json({ items: rows })
})

/**
 * ✅ 取消預約：本人或管理員可取消
 * POST /api/bookings/:id/cancel
 * 回傳：{ ok: true } 或相對應錯誤碼
 */
bookingsRouter.post('/:id/cancel', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })

  const userId = getUserId(req)
  if (!userId) return res.status(401).json({ error: 'unauthorized' })

  const id = req.params.id
  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    const f = await c.query(
      `SELECT id, created_by, status FROM bookings WHERE id=$1 LIMIT 1`,
      [id]
    )
    if (f.rowCount === 0) {
      await c.query('ROLLBACK')
      return res.status(404).json({ error: 'not_found' })
    }
    const b = f.rows[0]

    // 僅允許 pending / approved 轉 cancelled（若你還有其他狀態可再擴充）
    if (!['pending', 'approved'].includes(b.status)) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'invalid_status' })
    }

    const admin = isAdmin(req)
    const owner = (b.created_by ?? '') === userId
    if (!(admin || owner)) {
      await c.query('ROLLBACK')
      return res.status(403).json({ error: 'forbidden' })
    }

    await c.query(
      `UPDATE bookings
       SET status='cancelled', reviewed_at=now(), reviewed_by=$2
       WHERE id=$1`,
      [id, admin ? userId : b.created_by] // 若本人取消，reviewed_by 可寫成本人或保留 null
    )

    await c.query('COMMIT')
    return res.json({ ok: true })
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[bookings] cancel failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})