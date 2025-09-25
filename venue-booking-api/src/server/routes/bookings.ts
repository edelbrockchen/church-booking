import { Router } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

export const bookingsRouter = Router()
const pool = makePool()

const schema = z.object({ start: z.string().datetime() })

function addHours(d: Date, h: number){ return new Date(d.getTime() + h * 3600_000) }
function isSunday(d: Date){ return d.getDay() === 0 }
function latestEnd(d: Date){
  const day = d.getDay()
  // 週一 / 週三 最晚 18:00；其餘 21:30
  return (day === 1 || day === 3) ? { hour: 18, minute: 0 } : { hour: 21, minute: 30 }
}

bookingsRouter.post('/', async (req, res) => {
  const p = schema.safeParse(req.body)
  if(!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })

  const start = new Date(p.data.start)
  if(isNaN(start.getTime())) return res.status(400).json({ error: 'invalid_start' })
  if(isSunday(start)) return res.status(400).json({ error: 'sunday_disabled' })

  // 規則：原則 +3 小時；若超過當日上限則截短
  const targetEnd = addHours(start, 3)
  const { hour, minute } = latestEnd(start)
  const cap = new Date(start); cap.setHours(hour, minute, 0, 0)
  const end = targetEnd.getTime() > cap.getTime() ? cap : targetEnd
  const truncated = end.getTime() < targetEnd.getTime()

  // 無 DB（本機或未設 DATABASE_URL）走記憶體路徑
  if(!pool){
    return res.status(201).json({
      id: 'demo-' + Math.random().toString(36).slice(2),
      start: start.toISOString(),
      end: end.toISOString(),
      truncated,
      persisted: false,
      status: 'pending'
    })
  }

  const c = await pool.connect()
  try{
    await c.query('BEGIN')

    // 檢查重疊
    const overlap = await c.query(
      `SELECT 1 FROM bookings
       WHERE tstzrange(start_ts, end_ts, '[)') && tstzrange($1::timestamptz, $2::timestamptz, '[)')
       LIMIT 1`,
      [start.toISOString(), end.toISOString()]
    )
    if(overlap.rows.length > 0){
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    await c.query(
      `INSERT INTO bookings (id, start_ts, end_ts, created_by, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [id, start.toISOString(), end.toISOString(), null]
    )

    await c.query('COMMIT')
    return res.status(201).json({
      id,
      start: start.toISOString(),
      end: end.toISOString(),
      truncated,
      persisted: true,
      status: 'pending'
    })
  } catch(e: any){
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
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by, status, reviewed_at, reviewed_by, rejection_reason
    FROM bookings
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

bookingsRouter.get('/approved', async (_req, res) => {
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by
    FROM bookings
    WHERE status = 'approved'
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})