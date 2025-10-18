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
const pool = makePool() // Pool | null

/* ---------------- Helpers ---------------- */
function getUsersFromEnv(): Record<string, string> {
  // Preferred: ADMIN_USERS_JSON = { "user": "$2b$10$hash..." }
  const adminUsersJson = process.env.ADMIN_USERS_JSON
  if (adminUsersJson) {
    try {
      const obj = JSON.parse(adminUsersJson)
      if (obj && typeof obj === 'object') return obj as Record<string, string>
    } catch (err) {
      console.error('[admin] Failed to parse ADMIN_USERS_JSON:', err)
    }
  }
  // Legacy: ADMIN_PASSWORD=plain or bcrypt hash for default user "admin"
  if (process.env.ADMIN_PASSWORD) return { admin: process.env.ADMIN_PASSWORD }
  return {}
}

function isBcryptHash(str: string): boolean {
  return typeof str === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(str)
}

async function verifyPassword(input: string, expected: string): Promise<boolean> {
  if (isBcryptHash(expected)) return await bcrypt.compare(input, expected)
  return input === expected
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.admin) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

/* ---------------- Auth ---------------- */
const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

router.post('/login', async (req, res) => {
  const parsed = LoginBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { username, password } = parsed.data

  const users = getUsersFromEnv()
  const expected = users[username]
  if (!expected) return res.status(401).json({ error: 'invalid_credentials' })

  const ok = await verifyPassword(password, expected)
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })

  req.session.admin = { user: username }
  return res.json({ ok: true, user: username })
})

router.get('/me', (req, res) => {
  res.json({ admin: req.session?.admin ?? null })
})

router.post('/logout', (req, res) => {
  req.session?.destroy(() => {})
  res.json({ ok: true })
})

/* ---------------- Review list ---------------- */
// Query params:
// - days: number (default 60)
// - venue: string
// - includeEnded: 'true' | 'false' (default false)
// - q: string (fuzzy search)
router.get('/review', requireAdmin, async (req, res) => {
  const p = pool
  if (!p) return res.status(503).json({ error: 'db_unavailable' })

  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 60)))
  const venue = typeof req.query.venue === 'string' && req.query.venue.trim() !== '' ? req.query.venue.trim() : null
  const includeEnded = String(req.query.includeEnded ?? 'false') === 'true'
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().toLowerCase() : null

  const client = await p.connect()
  try {
    const where: string[] = []
    const params: any[] = []

    // 時間窗（從現在往回 N 天）
    params.push(days)
    where.push(`start_ts >= (now() - ($${params.length}::text || ' days')::interval)`)

    // 預設不含已結束的
    if (!includeEnded) where.push('end_ts >= now()')

    if (venue) {
      params.push(venue)
      where.push(`venue = $${params.length}`)
    }

    if (q) {
      params.push(`%${q}%`)
      const pidx = `$${params.length}`
      where.push(
        `(lower(coalesce(note,'')||' '||coalesce(category,'')||' '||coalesce(venue,'')||' '||coalesce(created_by,''))) like ${pidx}`
      )
    }

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

/* ---------------- Review CSV export ---------------- */
router.get('/review.csv', requireAdmin, async (req, res) => {
  const p = pool
  if (!p) return res.status(503).json({ error: 'db_unavailable' })

  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 60)))
  const venue = typeof req.query.venue === 'string' && req.query.venue.trim() !== '' ? req.query.venue.trim() : null
  const includeEnded = String(req.query.includeEnded ?? 'false') === 'true'
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim().toLowerCase() : null

  const client = await p.connect()
  try {
    const where: string[] = []
    const params: any[] = []

    params.push(days)
    where.push(`start_ts >= (now() - ($${params.length}::text || ' days')::interval)`)
    if (!includeEnded) where.push('end_ts >= now()')
    if (venue) { params.push(venue); where.push(`venue = $${params.length}`) }
    if (q) { params.push(`%${q}%`); const pidx = `$${params.length}`; where.push(`(lower(coalesce(note,'')||' '||coalesce(category,'')||' '||coalesce(venue,'')||' '||coalesce(created_by,''))) like ${pidx}`) }

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
        (r.note ?? '').replaceAll('\n', ' ').replaceAll('"', '""'),
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

/* ---------------- Decision: approve / reject / cancel ---------------- */
const DecisionBody = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
})

router.post('/review/:id/decision', requireAdmin, async (req, res) => {
  const p = pool
  if (!p) return res.status(503).json({ error: 'db_unavailable' })

  const parsed = DecisionBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })
  const { action } = parsed.data
  const id = String(req.params.id)

  const client = await p.connect()
  try {
    await client.query('BEGIN')

    if (action === 'approve') {
      // 核准前檢查與有效狀態是否重疊（排除自己）
      const overlapSQL = `
        SELECT b2.id, b2.start_ts, b2.end_ts, b2.venue
        FROM bookings b1
        JOIN bookings b2
          ON b2.id <> b1.id
         AND b2.venue = b1.venue
         AND (b2.status IS NULL OR b2.status IN ('pending','approved'))
         AND tstzrange(b2.start_ts, b2.end_ts, '[)') && tstzrange(b1.start_ts, b1.end_ts, '[)')
        WHERE b1.id = $1
        LIMIT 1
      `
      const ov = await client.query(overlapSQL, [id])
      if ((ov.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'overlap', conflict: ov.rows[0] })
      }
      await client.query(`UPDATE bookings SET status = 'approved' WHERE id = $1`, [id])
    } else if (action === 'reject') {
      await client.query(`UPDATE bookings SET status = 'rejected' WHERE id = $1`, [id])
    } else {
      await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [id])
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[admin] decision error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

export default router
