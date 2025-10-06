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

/* --------------------------- session / 雜項 --------------------------- */
function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}
function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}
function firstIp(req: Request): string | null {
  const raw = req.headers['x-forwarded-for']
  const s = Array.isArray(raw) ? raw[0] : (raw ?? '').toString()
  if (s) return s.split(',')[0].trim()
  // 後備
  return (req.socket?.remoteAddress ?? (req as any).ip ?? null) as string | null
}
function effectiveUserId(req: Request): string | null {
  const uid = getUserId(req)
  if (uid) return uid
  const allowGuest = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'
  if (!allowGuest) return null
  const ip = firstIp(req) || 'unknown'
  return `guest:${ip}`
}

/* --------------------------- schema 幫手 --------------------------- */
// 建「唯一約束」供 ON CONFLICT 使用，避免重複插入
async function ensureBookingsSchema() {
  if (!pool) return
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS client_key TEXT`)
    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'bookings_client_key_uniq'
            AND conrelid = 'public.bookings'::regclass
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
  // 盡量柔性建立所需欄位（不會覆蓋你已經有的結構）
  await c.query(`
    CREATE TABLE IF NOT EXISTS public.terms_acceptances (
      user_id TEXT,
      accepted_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await c.query(`ALTER TABLE public.terms_acceptances ADD COLUMN IF NOT EXISTS user_id TEXT`)
  await c.query(`ALTER TABLE public.terms_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`)
  await c.query(`ALTER TABLE public.terms_acceptances ADD COLUMN IF NOT EXISTS user_email TEXT`)
  await c.query(`ALTER TABLE public.terms_acceptances ADD COLUMN IF NOT EXISTS ip TEXT`)
  await c.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'terms_acceptances_user_id_key'
          AND conrelid = 'public.terms_acceptances'::regclass
      ) THEN
        ALTER TABLE public.terms_acceptances
          ADD CONSTRAINT terms_acceptances_user_id_key UNIQUE (user_id);
      END IF;
    END$$;
  `)

  const found = await c.query(`SELECT 1 FROM public.terms_acceptances WHERE user_id=$1 LIMIT 1`, [userId])
  if (found.rowCount > 0) {
    await c.query(`UPDATE public.terms_acceptances
                   SET accepted_at = COALESCE(accepted_at, now()),
                       ip = COALESCE($2, ip)
                   WHERE user_id = $1`, [userId, ip])
    return
  }
  await c.query(`INSERT INTO public.terms_acceptances (user_id, accepted_at, ip)
                 VALUES ($1, now(), $2)`, [userId, ip])
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
    const ip = firstIp(req)
    const allowGuestTerms = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'

    const has = await c.query(`SELECT 1 FROM public.terms_acceptances WHERE user_id=$1 LIMIT 1`, [uid])
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
        FROM public.bookings
        WHERE status = 'approved'
          AND venue  = $3
          AND tstzrange(start_ts, end_ts, $4)
              && tstzrange($1::timestamptz, $2::timestamptz, $4)
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

    // 冪等鍵：優先 body.client_key / header:x-idempotency-key；否則 5 分鐘桶的哈希
    let clientKey =
      (p.data.client_key && p.data.client_key.length ? p.data.client_key : undefined) ||
      (Array.isArray(req.headers['x-idempotency-key'])
        ? req.headers['x-idempotency-key']![0]
        : (req.headers['x-idempotency-key'] as string | undefined))

    if (!clientKey) {
      const fiveMinBucket = Math.floor(Date.now() / (5 * 60 * 1000))
      const seed = `${uid}|${venue}|${startEff.toISOString()}|${endEff.toISOString()}|${fiveMinBucket}`
      clientKey = createHash('sha256').update(seed).digest('hex').slice(0, 64)
    }

    const id = randomUUID()
    const ins = await c.query(
      `
      INSERT INTO public.bookings
        (id, start_ts, end_ts, created_by, status, category, note, venue, client_key)
      VALUES
        ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      ON CONFLICT ON CONSTRAINT bookings_client_key_uniq DO NOTHING
      `,
      [id, startEff.toISOString(), endEff.toISOString(),
       created_by ?? uid ?? null, category ?? null, note ?? null, venue, clientKey]
    )

    // 插不進去就撈舊的（冪等）
    let row: any
    if (ins.rowCount === 0) {
      const r = await c.query(
        `SELECT id, start_ts, end_ts, created_by, status, category, note, venue
         FROM public.bookings WHERE client_key=$1 LIMIT 1`,
        [clientKey]
      )
      row = r.rows[0]
    } else {
      row = {
        id,
        start_ts: startEff.toISOString(),
        end_ts:   endEff.toISOString(),
        created_by: created_by ?? uid ?? null,
        status: 'pending',
        category: category ?? null,
        note: note ?? null,
        venue
      }
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
    FROM public.bookings
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

// 列表：已核准
bookingsRouter.get('/approved', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_by, category, note, venue
    FROM public.bookings
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
    const f = await c.query(`SELECT id, created_by, status FROM public.bookings WHERE id=$1 LIMIT 1`, [id])
    if (f.rowCount === 0) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }) }
    const b = f.rows[0] as { id: string; created_by: string | null; status: string }
    if (!['pending', 'approved'].includes(b.status)) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'invalid_status' }) }
    const admin = isAdmin(req)
    const owner = (b.created_by ?? '') === uid
    if (!(admin || owner)) { await c.query('ROLLBACK'); return res.status(403).json({ error: 'forbidden' }) }
    await c.query(
      `UPDATE public.bookings
         SET status='cancelled', reviewed_at=now(), reviewed_by=$2
       WHERE id=$1`,
      [id, admin ? uid : b.created_by]
    )
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
  const base = `SELECT id, start_ts, end_ts, created_at, created_by, status, reviewed_at, reviewed_by, rejection_reason, category, note, venue, client_key FROM public.bookings`
  const sql = status ? `${base} WHERE status = $1 ORDER BY start_ts ASC` : `${base} ORDER BY start_ts ASC`
  const params = status ? [status] : []
  const { rows } = await pool.query(sql, params)
  res.json({ items: rows })
})
bookingsRouter.get('/bookings/approved', async (_req, res) => {
  if (!pool) return res.json({ items: [] })
  const { rows } = await pool.query(
    `SELECT id, start_ts, end_ts, created_by, category, note, venue
     FROM public.bookings WHERE status='approved' ORDER BY start_ts ASC`
  )
  res.json({ items: rows })
})
