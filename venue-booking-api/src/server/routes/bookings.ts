// src/server/routes/bookings.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID, createHash } from 'node:crypto'

export const bookingsRouter = Router()
export default bookingsRouter

const pool = makePool()

/* --------------------------- 常數/型別 --------------------------- */
const AllowedCategories = ['教會聚會', '社團活動', '研習', '其他'] as const
const AllowedVenues     = ['大會堂', '康樂廳', '其它教室'] as const
const BlockedVenuesOnApproved = new Set(['大會堂', '康樂廳']) // 僅核准後要互擋

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

/* --------------------------- schema 幫手 --------------------------- */
// 建「唯一約束」供 ON CONFLICT 使用，避免重複插入
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
          SELECT 1 FROM pg_constraint WHERE conname = 'bookings_client_key_uniq'
        ) THEN
          ALTER TABLE public.bookings
            ADD CONSTRAINT bookings_client_key_uniq UNIQUE (client_key);
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

// 動態相容：不強制固定 terms_acceptances 欄位，能適配舊 schema
async function upsertTermsAcceptance(c: any, userId: string, ip: string | null) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS terms_acceptances (
      user_id TEXT PRIMARY KEY,
      accepted_at TIMESTAMPTZ,
      user_email TEXT,
      ip TEXT
    )
  `)
  const cols = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='terms_acceptances' AND table_schema='public'
  `)
  const set = new Set(cols.rows.map((r: any) => r.column_name as string))
  const hasAcceptedAt = set.has('accepted_at')
  const hasAccepted   = set.has('accepted') // 舊 boolean 欄位
  const hasIp         = set.has('ip')
  const hasEmail      = set.has('user_email')

  const has = await c.query(`SELECT 1 FROM terms_acceptances WHERE user_id=$1 LIMIT 1`, [userId])
  if (has.rowCount > 0) {
    const parts: string[] = []
    const params: any[] = []
    let i = 1
    if (hasAcceptedAt) parts.push(`accepted_at = now()`)
    else if (hasAccepted) parts.push(`accepted = TRUE`)
    if (hasIp) { parts.push(`ip = $${i++}`); params.push(ip) }
    params.push(userId)
    if (parts.length) await c.query(`UPDATE terms_acceptances SET ${parts.join(', ')} WHERE user_id = $${i}`, params)
    return
  }

  const colsArr: string[] = ['user_id']
  const valsArr: string[] = ['$1']
  const params: any[] = [userId]
  let i = 2
  if (hasAcceptedAt) { colsArr.push('accepted_at'); valsArr.push('now()') }
  else if (hasAccepted) { colsArr.push('accepted'); valsArr.push('TRUE') }
  if (hasIp) { colsArr.push('ip'); valsArr.push(`$${i++}`); params.push(ip) }
  if (hasEmail) { colsArr.push('user_email'); valsArr.push(`$${i++}`); params.push(null) }
  await c.query(`INSERT INTO terms_acceptances (${colsArr.join(',')}) VALUES (${valsArr.join(',')})`, params)
}

/* --------------------------- 建立申請 --------------------------- */
const createHandler = async (req: Request, res: any) => {
  const p = createSchema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })

  const startRaw = new Date(p.data.start)
  if (isNaN(startRaw.getTime()))   return res.status(400).json({ error: 'invalid_start' })
  if (isSundayTPE(startRaw))       return res.status(400).json({ error: 'sunday_disabled' })

  const earliest = earliestOfDayTPE(startRaw)
  const startEff = startRaw.getTime() < earliest.getTime() ? earliest : startRaw
  const cap = latestCapTPE(startEff)
  const targetEnd = addHours(startEff, 3)
  const endEff = new Date(Math.min(targetEnd.getTime(), cap.getTime()))
  const truncated = endEff.getTime() < targetEnd.getTime()
  if (endEff.getTime() <= startEff.getTime()) return res.status(409).json({ error: 'too_late' })

  const venue = p.data.venue
  const category = (p.data.category as (typeof AllowedCategories)[number] | undefined) ?? undefined
  const note = p.data.note ?? undefined
  const created_by = p.data.created_by ?? undefined

  if (!pool) {
    // 無 DB 模式（demo）
    return res.status(201).json({
      id: 'demo-' + Math.random().toString(36).slice(2),
      start: startEff.toISOString(),
      end:   endEff.toISOString(),
      truncated, persisted: false, status: 'pending',
      venue, category: category ?? 'default', note: note ?? '', created_by: created_by ?? '',
    })
  }

  await ensureBookingsSchema()

  const uid = effectiveUserId(req)
  if (!uid) return res.status(401).json({ error: 'unauthorized' })

  const c = await pool.connect()
  try {
    const ip = (req.headers['x-forwarded-for'] as string) || (req.ip as string) || null
    const allowGuestTerms = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'

    const has = await c.query(`SELECT 1 FROM terms_acceptances WHERE user_id=$1 LIMIT 1`, [uid])
    if (has.rowCount === 0) {
      if (allowGuestTerms) await upsertTermsAcceptance(c, uid, ip)
      else return res.status(403).json({ error: 'must_accept_terms' })
    }

    await c.query('BEGIN')

    // 僅在「大會堂／康樂廳」檢查已核准的重疊（半開區間 [)）
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
          expose ? { error: 'overlap', message: '該場地已被申請', conflict: ov.rows[0] }
                 : { error: 'overlap', message: '該場地已被申請' }
        )
      }
    }

    // 冪等鍵：同 user/場地/時段，5 分鐘視為同一鍵
    let clientKey =
      (p.data.client_key && p.data.client_key.length ? p.data.client_key : undefined) ||
      (req.headers['x-idempotency-key'] as string | undefined)
    if (!clientKey) {
      const seed = `${uid}|${venue}|${startEff.toISOString()}|${endEff.toISOString()}|${Math.floor(Date.now()/(5*60*1000))}`
      clientKey = createHash('sha256').update(seed).digest('hex').slice(0, 64)
    }

    const id = randomUUID()
    const ins = await c.query(
      `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, note, venue, client_key)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      ON CONFLICT ON CONSTRAINT bookings_client_key_uniq DO NOTHING
      `,
      [id, startEff.toISOString(), endEff.toISOString(),
       created_by ?? uid ?? null, category ?? null, note ?? null, venue, clientKey]
    )

    // 插不進去就撈舊的（冪等）
    let row: any
    if (ins.rowCount === 0) {
      const r = await c.query(
        `SELECT id, start_ts, end_ts, created_by, status, category, note, venue FROM bookings WHERE client_key=$1 LIMIT 1`,
        [clientKey]
      )
      row = r.rows[0]
    } else {
      row = { id, start_ts: startEff.toISOString(), end_ts: endEff.toISOString(),
        created_by: created_by ?? uid ?? null, status: 'pending', category: category ?? null, note: note ?? null, venue }
    }

    await c.query('COMMIT')
    return res.status(ins.rowCount ? 201 : 200).json({
      id: row.id,
      start: new Date(row.start_ts).toISOString(),
      end:   new Date(row.end_ts).toISOString(),
      truncated, persisted: true, status: row.status,
      venue: row.venue, category: row.category ?? 'default', note: row.note ?? '', created_by: row.created_by ?? '',
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

/* --------------------------- 路由 --------------------------- */
// 申請
bookingsRouter.post('/', createHandler as any)
bookingsRouter.post('/bookings', createHandler as any) // 相容

// 列表：全部
bookingsRouter.get('/', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by, status,
           reviewed_at, reviewed_by, rejection_reason, category, note, venue, client_key
    FROM bookings
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

// 列表：已核准
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

// 取消
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
  const base = `SELECT id, start_ts, end_ts, created_at, created_by, status, reviewed_at, reviewed_by, rejection_reason, category, note, venue, client_key FROM bookings`
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
