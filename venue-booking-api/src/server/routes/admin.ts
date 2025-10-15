// src/server/routes/admin.ts
import { Router, type Request, type Response, type NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { makePool } from '../db'

declare module 'express-session' {
  interface SessionData {
    admin?: { user: string }
  }
}

const router = Router()
const pool = makePool() // connect 於 handler 內進行

/* ---------------- Helpers ---------------- */
function getUsersFromEnv(): Record<string, string> {
  const adminUsersJson = process.env.ADMIN_USERS_JSON
  if (adminUsersJson) {
    try {
      const obj = JSON.parse(adminUsersJson)
      if (obj && typeof obj === 'object') return obj as Record<string, string>
    } catch (err) {
      console.error('[admin] Failed to parse ADMIN_USERS_JSON:', err)
    }
  }
  if (process.env.ADMIN_PASSWORD) return { admin: process.env.ADMIN_PASSWORD }
  return {}
}
function isBcryptHash(s: string) {
  return typeof s === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(s)
}
async function verifyPassword(input: string, expected: string) {
  return isBcryptHash(expected) ? bcrypt.compare(input, expected) : input === expected
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.admin) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

/* ---------------- Auth ---------------- */
const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) })

router.post('/login', async (req, res) => {
  const parsed = LoginBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const username = parsed.data.username.trim()
  const password = parsed.data.password

  const users = getUsersFromEnv()
  const expected = users[username]
  if (!expected) return res.status(401).json({ error: 'invalid_credentials' })

  const ok = await verifyPassword(password, expected)
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })

  req.session.regenerate((err) => {
    if (err) {
      console.error('[admin] session regenerate failed:', err)
      return res.status(500).json({ error: 'session_error' })
    }
    req.session.admin = { user: username }
    req.session.save((err2) => {
      if (err2) {
        console.error('[admin] session save failed:', err2)
        return res.status(500).json({ error: 'session_error' })
      }
      return res.json({ ok: true, user: username })
    })
  })
})

router.get('/me', (req, res) => {
  res.json({ admin: req.session?.admin ?? null })
})

router.post('/logout', (req, res) => {
  const sidName = 'connect.sid'
  req.session?.destroy(() => {})
  res.clearCookie(sidName, { sameSite: 'none', secure: true, path: '/' })
  res.json({ ok: true })
})

/* ---------------- Review list ---------------- */
// /api/admin/review?days=60&venue=...&includeEnded=true&q=...
router.get('/review', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })

  const rawDays = Number(req.query.days)
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, rawDays)) : 60
  const venue = typeof req.query.venue === 'string' && req.query.venue.trim() !== '' ? req.query.venue.trim() : null
  const includeEnded = String((req.query as any).includeEnded ?? (req.query as any).showFinished ?? 'false') === 'true'
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().toLowerCase() : null

  const client = await pool.connect()
  try {
    const where: string[] = []
    const params: any[] = []

    params.push(days)
    where.push(`start_ts >= (now() - ($${params.length}::text || ' days')::interval)`)
    if (!includeEnded) where.push('end_ts >= now()')
    if (venue) { params.push(venue); where.push(`venue = $${params.length}`) }
    if (q) { params.push(`%${q}%`); const p = `$${params.length}`; where.push(`(lower(coalesce(note,'')||' '||coalesce(category,'')||' '||coalesce(venue,'')||' '||coalesce(created_by,''))) like ${p}`) }

    const sql = `
      SELECT id, start_ts, end_ts, created_at, created_by, status, category, venue, note
      FROM bookings
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY start_ts DESC
      LIMIT 500
    `
    const { rows } = await client.query(sql, params)
    res.json({ items: rows })
  } catch (err) {
    console.error('[admin] review error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

router.get('/review.csv', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const rawDays = Number(req.query.days)
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, rawDays)) : 60
  const venue = typeof req.query.venue === 'string' && req.query.venue.trim() !== '' ? req.query.venue.trim() : null
  const includeEnded = String((req.query as any).includeEnded ?? (req.query as any).showFinished ?? 'false') === 'true'
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().toLowerCase() : null

  const client = await pool.connect()
  try {
    const where: string[] = []
    const params: any[] = []

    params.push(days)
    where.push(`start_ts >= (now() - ($${params.length}::text || ' days')::interval)`)
    if (!includeEnded) where.push('end_ts >= now()')
    if (venue) { params.push(venue); where.push(`venue = $${params.length}`) }
    if (q) { params.push(`%${q}%`); const p = `$${params.length}`; where.push(`(lower(coalesce(note,'')||' '||coalesce(category,'')||' '||coalesce(venue,'')||' '||coalesce(created_by,''))) like ${p}`) }

    const sql = `
      SELECT id, start_ts, end_ts, created_at, created_by, status, category, venue, note
      FROM bookings
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY start_ts DESC
      LIMIT 2000
    `
    const { rows } = await client.query(sql, params)
    const header = ['id','start_ts','end_ts','created_at','created_by','status','category','venue','note']
    const csv = [header.join(',')]
    for (const r of rows) {
      const line = [
        r.id,
        new Date(r.start_ts).toISOString(),
        new Date(r.end_ts).toISOString(),
        new Date(r.created_at).toISOString(),
        r.created_by ?? '',
        r.status ?? '',
        r.category ?? '',
        r.venue ?? '',
        String(r.note ?? '').replaceAll('\n', ' ').replaceAll('"', '""'),
      ].map((v) => `"${String(v ?? '')}"`).join(',')
      csv.push(line)
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="review.csv"')
    res.send(csv.join('\n'))
  } catch (err) {
    console.error('[admin] review.csv error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

/* ---------------- Actions: approve / reject / cancel ---------------- */
// 前端呼叫：POST /api/admin/bookings/:id/approve|reject|cancel
// body: { reason?: string }
const ActionBody = z.object({ reason: z.string().max(500).optional().nullable() }).optional()
const IdParam = z.object({ id: z.string().uuid().or(z.string().min(8)) })

type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

// 明確定義 setStatus 回傳型別，避免 out.status 被視為可能 undefined
type SetStatusOk = { ok: true; row: any }
type SetStatusErr = { ok: false; error: string; status: number; current?: BookingStatus }

async function setStatus(id: string, newStatus: BookingStatus, actor: string, reason?: string): Promise<SetStatusOk | SetStatusErr> {
  if (!pool) return { ok: false, error: 'db_unavailable', status: 503 }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: curRows } = await client.query(
      'SELECT id, status FROM bookings WHERE id = $1 LIMIT 1',
      [id],
    )
    if (curRows.length === 0) {
      await client.query('ROLLBACK')
      return { ok: false, error: 'not_found', status: 404 }
    }
    const cur: BookingStatus = curRows[0].status

    // 預設允許：pending -> approved|rejected|cancelled, approved -> cancelled, rejected -> approved
    const allowed = new Set<string>([
      'pending:approved', 'pending:rejected', 'pending:cancelled',
      'approved:cancelled', 'rejected:approved',
    ])
    if (!allowed.has(`${cur}:${newStatus}`) && cur !== newStatus) {
      await client.query('ROLLBACK')
      return { ok: false, error: 'invalid_transition', status: 409, current: cur }
    }

    const notePatch = reason ? `\n[${newStatus.toUpperCase()}] ${actor}: ${reason}` : ''
    const { rows } = await client.query(
      `
      UPDATE bookings
      SET status = $2,
          note   = coalesce(note,'') || $3
      WHERE id = $1
      RETURNING id, status, note
      `,
      [id, newStatus, notePatch],
    )

    await client.query('COMMIT')
    return { ok: true, row: rows[0] }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('[admin] setStatus error:', e)
    return { ok: false, error: 'internal_error', status: 500 }
  } finally {
    client.release()
  }
}

function actionRoute(newStatus: BookingStatus) {
  return async (req: Request, res: Response) => {
    const pid = IdParam.safeParse(req.params)
    const body = ActionBody.safeParse(req.body)
    if (!pid.success) return res.status(400).json({ error: 'invalid_id' })
    if (!body.success) return res.status(400).json({ error: 'invalid_body' })

    const actor = req.session?.admin?.user ?? 'admin'
    const out = await setStatus(pid.data.id, newStatus, actor, body.data?.reason ?? undefined)
    if (out.ok !== true) {
      return res.status(out.status).json({ error: out.error, current: out.current })
    }
    return res.json({ ok: true, booking: out.row })
  }
}

router.post('/bookings/:id/approve', requireAdmin, actionRoute('approved'))
router.post('/bookings/:id/reject',  requireAdmin, actionRoute('rejected'))
router.post('/bookings/:id/cancel',  requireAdmin, actionRoute('cancelled'))

export default router
