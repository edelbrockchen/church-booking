// src/server/routes/bookings.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID, createHash } from 'node:crypto'

export const bookingsRouter = Router()
export default bookingsRouter

const pool = makePool()

/* --------------------------- 常數 --------------------------- */
const AllowedCategories = ['教會聚會', '社團活動', '研習', '其他'] as const
const AllowedVenues     = ['大會堂', '康樂廳', '其它教室'] as const
const BlockedVenuesOnApproved = new Set(['大會堂', '康樂廳'])

const createSchema = z.object({
  start: z.string().datetime(),
  venue: z.enum(AllowedVenues),
  category: z.string().trim().optional()
    .transform(v => (v && v.length ? v : undefined))
    .refine(v => !v || AllowedCategories.includes(v as any), { message: 'invalid_category' }),
  note: z.string().trim().max(200).optional(),
  created_by: z.string().trim().max(100).optional(),
  client_key: z.string().trim().max(80).optional(), // 冪等鍵（可選）
})

/* --------------------------- 工具: 台北時間規範 --------------------------- */
function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }
function tpeKey(d: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d)
}
function earliestOfDayTPE(d: Date) { return new Date(`${tpeKey(d)}T07:00:00+08:00`) }
function latestCapTPE(d: Date) {
  const dow = new Date(`${tpeKey(d)}T12:00:00+08:00`).getUTCDay()
  const hhmm = (dow === 1 || dow === 3) ? '18:00:00' : '21:30:00'
  return new Date(`${tpeKey(d)}T${hhmm}+08:00`)
}
function isSundayTPE(d: Date) { return new Date(`${tpeKey(d)}T12:00:00+08:00`).getUTCDay() === 0 }

/* --------------------------- session helpers --------------------------- */
function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}
function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}
function effectiveUserId(req: Request): string | null {
  const uid = getUserId(req)
  if (uid) return uid
  const allowGuest = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'
  if (!allowGuest) return null
  const ip = (req.headers['x-forwarded-for'] as string) || (req.ip as string) || 'unknown'
  return `guest:${ip}`
}

/* --------------------------- 確保資料表 --------------------------- */
async function ensureTermsSchema() {
  if (!pool) return
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        id UUID PRIMARY KEY,
        user_id TEXT,
        user_email TEXT,
        accepted_at TIMESTAMPTZ DEFAULT now(),
        ip TEXT
      )
    `)
    // 舊欄位 accepted:boolean → 轉到 accepted_at
    const col = await c.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'terms_acceptances' AND column_name = 'accepted' LIMIT 1
    `)
    if (col.rowCount) {
      await c.query(`ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`)
      await c.query(`UPDATE terms_acceptances SET accepted_at = COALESCE(accepted_at, now()) WHERE accepted = TRUE`)
      await c.query(`ALTER TABLE terms_acceptances DROP COLUMN accepted`)
    }
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[bookings] ensureTermsSchema failed:', e)
  } finally {
    c.release()
  }
}

async function ensureBookingsSchema() {
  if (!pool) return
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_key TEXT`)
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'bookings_client_key_uq'
        ) THEN
          CREATE UNIQUE INDEX bookings_client_key_uq ON bookings (client_key) WHERE client_key IS NOT NULL;
        END IF;
      END$$;
    `)
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[bookings] ensureBookingsSchema failed:', e)
  } finally {
    c.release()
  }
}

/* --------------------------- 建立申請 --------------------------- */
const createHandler = async (req: Request, res: any) => {
  const p = createSchema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })

  const startRaw = new Date(p.data.start)
  if (isNaN(startRaw.getTime()))   return res.status(400).json({ error: 'invalid_start' })
  if (isSundayTPE(startRaw))       return res.status(400).json({ error: 'sunday_disabled' })

  // 台北規範：每日最早 07:00；晚間上限裁切；一次最多 3 小時
  const earliest = earliestOfDayTPE(startRaw)
  const startEff = startRaw.getTime() < earliest.getTime() ? earliest : startRaw
  const cap = latestCapTPE(startEff)
  const targetEnd = addHours(startEff, 3)
  const endEff = new Date(Math.min(targetEnd.getTime(), cap.getTime()))
  const truncated = endEff.getTime() < targetEnd.getTime()
  if (endEff.getTime() <= startEff.getTime()) {
    return res.status(409).json({ error: 'too_late' })
  }

  const venue = p.data.venue
  const category = (p.data.category as (typeof AllowedCategories)[number] | undefined) ?? undefined
  const note = p.data.note ?? undefined
  const created_by = p.data.created_by ?? undefined

  if (!pool) {
    return res.status(201).json({
      id: 'demo-' + Math.random().toString(36).slice(2),
      start: startEff.toISOString(),
      end:   endEff.toISOString(),
      truncated,
      persisted: false,
      status: 'pending',
      venue,
      category: category ?? 'default',
      note: note ?? '',
      created_by: created_by ?? '',
    })
  }

  // 先確保架構，避免 terms 表不存在造成 500
  await ensureTermsSchema()
  await ensureBookingsSchema()

  const uid = effectiveUserId(req)
  if (!uid) return res.status(401).json({ error: 'unauthorized' })

  // 冪等鍵（同一使用者/時段/場地，5 分鐘內重送不會重複插入）
  let clientKey =
    (p.data.client_key && p.data.client_key.length ? p.data.client_key : undefined) ||
    (req.headers['x-idempotency-key'] as string | undefined)
  if (!clientKey) {
    const seed = `${uid}|${venue}|${startEff.toISOString()}|${endEff.toISOString()}|${Math.floor(Date.now()/ (5*60*1000))}`
    clientKey = createHash('sha256').update(seed).digest('hex').slice(0, 64)
  }

  const c = await pool.connect()
  try {
    // 條款：若尚未同意，且允許訪客，就自動記一筆
    const has = await c.query('SELECT 1 FROM terms_acceptances WHERE user_id=$1 LIMIT 1', [uid])
    if (has.rowCount === 0) {
      const ALLOW_GUEST_TERMS = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'
      if (ALLOW_GUEST_TERMS) {
        await c.query(`
          INSERT INTO terms_acceptances (id, user_id, accepted_at, ip)
          VALUES ($1, $2, now(), $3)
          ON CONFLICT DO NOTHING
        `, [randomUUID(), uid, (req.headers['x-forwarded-for'] as string) || req.ip || null])
      } else {
        return res.status(403).json({ error: 'must_accept_terms' })
      }
    }

    await c.query('BEGIN')

    // 僅在大會堂/康樂廳檢查已核准重疊
    if (BlockedVenuesOnApproved.has(venue)) {
      const rangeMode = '[)'
      const ov = await c.query(
        `
        SELECT id, start_ts, end_ts, venue
        FROM bookings
        WHERE status = 'approved'
          AND venue = $3
          AND tstzrange(start_ts, end_ts, $4) && tstzrange($1::timestamptz, $2::timestamptz, $4)
        LIMIT 1
        `,
        [startEff.toISOString(), endEff.toISOString(), venue, rangeMode]
      )
      if (ov.rows.length > 0) {
        await c.query('ROLLBACK')
        const expose = (process.env.EXPOSE_CONFLICTS ?? 'false').toLowerCase() === 'true'
        return res.status(409).json(
          expose
            ? { error: 'overlap', message: '該場地已被申請', conflict: ov.rows[0] }
            : { error: 'overlap', message: '該場地已被申請' }
        )
      }
    }

    const id = randomUUID()
    const ins = await c.query(
      `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, note, venue, client_key)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      ON CONFLICT (client_key) DO NOTHING
      `,
      [id, startEff.toISOString(), endEff.toISOString(), created_by ?? uid ?? null, category ?? null, note ?? null, venue, clientKey]
    )

    // 冪等：若沒插入，撈舊的
    let row: any
    if (ins.rowCount === 0) {
      const r = await c.query(
        `SELECT id, start_ts, end_ts, created_by, status, category, note, venue FROM bookings WHERE client_key=$1 LIMIT 1`,
        [clientKey]
      )
      row = r.rows[0]
    } else {
      row = { id, start_ts: startEff.toISOString(), end_ts: endEff.toISOString(), created_by: created_by ?? uid ?? null, status: 'pending', category: category ?? null, note: note ?? null, venue }
    }

    await c.query('COMMIT')
    return res.status(ins.rowCount ? 201 : 200).json({
      id: row.id,
      start: new Date(row.start_ts).toISOString(),
      end:   new Date(row.end_ts).toISOString(),
      truncated,
      persisted: true,
      status: row.status,
      venue: row.venue,
      category: row.category ?? 'default',
      note: row.note ?? '',
      created_by: row.created_by ?? '',
      client_key: clientKey,
    })
  } catch (e: any) {
    await c.query('ROLLBACK')
    if (e?.code === '23P01') return res.status(409).json({ error: 'overlap', message: '該場地已被申請' })
    console.error('[bookings] insert failed', e)
    return res.status(500).json({ error: 'server_error', code: e?.code })
  } finally {
    c.release()
  }
}

// 支援 /api/ 及 /api/bookings（相容前端）
bookingsRouter.post('/', createHandler as any)
bookingsRouter.post('/bookings', createHandler as any)

/* --------------------------- 列表（含相容路徑） --------------------------- */
bookingsRouter.get('/', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by, status,
           reviewed_at, reviewed_by, rejection_reason, category, note, venue
    FROM bookings
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

bookingsRouter.get('/approved', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_by, category, note, venue
    FROM bookings
    WHERE status = 'approved'
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

bookingsRouter.post('/:id/cancel', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const uid = effectiveUserId(req)
  if (!uid) return res.status(401).json({ error: 'unauthorized' })
  const id = req.params.id
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const f = await c.query(`SELECT id, created_by, status FROM bookings WHERE id=$1 LIMIT 1`, [id])
    if (f.rowCount === 0) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }) }
    const b = f.rows[0] as { id: string; created_by: string | null; status: string }
    if (!['pending', 'approved'].includes(b.status)) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'invalid_status' }) }
    const admin = isAdmin(req)
    const owner = (b.created_by ?? '') === uid
    if (!(admin || owner)) { await c.query('ROLLBACK'); return res.status(403).json({ error: 'forbidden' }) }
    await c.query(`UPDATE bookings SET status='cancelled', reviewed_at=now(), reviewed_by=$2 WHERE id=$1`, [id, admin ? uid : b.created_by])
    await c.query('COMMIT')
    return res.json({ ok: true })
  } catch (e) {
    await c.query('ROLLBACK'); console.error('[bookings] cancel failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally { c.release() }
})

// 相容清單路由
bookingsRouter.get('/bookings', async (req, res) => {
  if (!pool) return res.json({ items: [] })
  const status = (req.query.status as string | undefined)?.trim()
  const base = `SELECT id, start_ts, end_ts, created_at, created_by, status, reviewed_at, reviewed_by, rejection_reason, category, note, venue FROM bookings`
  const sql = status ? `${base} WHERE status = $1 ORDER BY start_ts ASC` : `${base} ORDER BY start_ts ASC`
  const params = status ? [status] : []
  const { rows } = await pool.query(sql, params)
  res.json({ items: rows })
})
bookingsRouter.get('/bookings/approved', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(
    `SELECT id, start_ts, end_ts, created_by, category, note, venue
     FROM bookings WHERE status='approved' ORDER BY start_ts ASC`
  )
  res.json({ items: rows })
})