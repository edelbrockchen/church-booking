// venue-booking-api/src/server/routes/admin.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'

export const adminRouter = Router()
const pool = makePool()

function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}
function requireAdmin(req: Request, res: any, next: any) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' })
  next()
}

const rejectSchema = z.object({
  reason: z.string().trim().max(200).optional(),
})

adminRouter.post('/bookings/:id/approve', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const reviewer = (req as any).session?.user?.id ?? null

  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    const f = await c.query(`SELECT id, status FROM bookings WHERE id=$1 LIMIT 1`, [id])
    if (f.rowCount === 0) {
      await c.query('ROLLBACK')
      return res.status(404).json({ error: 'not_found' })
    }
    const b = f.rows[0]
    if (!['pending'].includes(b.status)) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'invalid_status' })
    }

    await c.query(
      `UPDATE bookings
       SET status='approved', reviewed_at=now(), reviewed_by=$2, rejection_reason=NULL
       WHERE id=$1`,
      [id, reviewer]
    )

    await c.query('COMMIT')
    return res.json({ ok: true })
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[admin] approve failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})

adminRouter.post('/bookings/:id/reject', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const reviewer = (req as any).session?.user?.id ?? null

  const p = rejectSchema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })
  const reason = p.data.reason ?? null

  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    const f = await c.query(`SELECT id, status FROM bookings WHERE id=$1 LIMIT 1`, [id])
    if (f.rowCount === 0) {
      await c.query('ROLLBACK')
      return res.status(404).json({ error: 'not_found' })
    }
    const b = f.rows[0]
    if (!['pending', 'approved'].includes(b.status)) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'invalid_status' })
    }

    await c.query(
      `UPDATE bookings
       SET status='rejected', reviewed_at=now(), reviewed_by=$2, rejection_reason=$3
       WHERE id=$1`,
      [id, reviewer, reason]
    )

    await c.query('COMMIT')
    return res.json({ ok: true })
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[admin] reject failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})