// venue-booking-api/src/server/routes/bookings.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

export const bookingsRouter = Router()
export default bookingsRouter

const pool = makePool()

/* --------------------------- 共用設定 / 型別 --------------------------- */

// 可接受的分類（前端「婚禮」已改為「社團活動」）
const AllowedCategories = ['教會聚會', '社團活動', '研習', '其他'] as const

const createSchema = z.object({
  start: z.string().datetime(),               // ISO 字串（含時區）
  category: z.string().trim().optional()
    .transform(v => (v && v.length ? v : undefined))
    .refine(v => !v || AllowedCategories.includes(v as any), { message: 'invalid_category' }),
  note: z.string().trim().max(200).optional(),
  created_by: z.string().trim().max(100).optional(),
})

function addHours(d: Date, h: number) { return new Date(d.getTime() + h * 3600_000) }

/** ------- 台北時間工具（不靠機器時區；用 +08:00 明確建構） ------- */
function tpeDateKey(d: Date) {
  // 該瞬間在台北的 YYYY-MM-DD
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(d)
}
function earliestOfDayTPE(d: Date) {
  // 台北當天 07:00 對應的絕對時間
  return new Date(`${tpeDateKey(d)}T07:00:00+08:00`)
}
function latestCapTPE(d: Date) {
  // 台北：週一/週三 最晚 18:00；其餘 21:30
  const dow = new Date(`${tpeDateKey(d)}T12:00:00+08:00`).getUTCDay()
  const hhmm = (dow === 1 || dow === 3) ? '18:00:00' : '21:30:00'
  return new Date(`${tpeDateKey(d)}T${hhmm}+08:00`)
}
function isSundayTPE(d: Date) {
  return new Date(`${tpeDateKey(d)}T12:00:00+08:00`).getUTCDay() === 0
}

// 依你實際的 session 結構調整
function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}
function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}

/* --------------------------- Demo 資料（可開關） --------------------------- */

const DEMO_BOOKINGS = (process.env.DEMO_BOOKINGS ?? 'true').toLowerCase() === 'true'
const DEMO_ITEMS = [
  {
    id: 'demo-1',
    start_ts: '2025-09-28T10:00:00+08:00',
    end_ts:   '2025-09-28T13:00:00+08:00',
    created_by: '系統示例',
    category: '教會聚會',
    note: '示例事件 A',
  },
  {
    id: 'demo-2',
    start_ts: '2025-09-30T19:00:00+08:00',
    end_ts:   '2025-09-30T22:00:00+08:00',
    created_by: 'Alice',
    category: '研習',
    note: '示例事件 B',
  },
]

/* --------------------------- 建立預約 --------------------------- */

bookingsRouter.post('/', async (req, res) => {
  console.log('[bookings][POST /] userId =', getUserId(req))

  const p = createSchema.safeParse(req.body)
  if (!p.success) {
    return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })
  }

  // 來自前端的開始時間（ISO，含時區）
  const startRaw = new Date(p.data.start)
  if (isNaN(startRaw.getTime())) return res.status(400).json({ error: 'invalid_start' })

  // 週日禁用（以台北時間判斷）
  if (isSundayTPE(startRaw)) return res.status(400).json({ error: 'sunday_disabled' })

  // ★ 關鍵：若早於當天台北 07:00，直接「上調」到 07:00；不再回 too_early
  const earliest = earliestOfDayTPE(startRaw)
  const startEff = startRaw.getTime() < earliest.getTime() ? earliest : startRaw

  // 3 小時上限 + 當日最晚結束（台北）
  const cap = latestCapTPE(startEff)
  const targetEnd = addHours(startEff, 3)
  const endEff = new Date(Math.min(targetEnd.getTime(), cap.getTime()))
  const truncated = endEff.getTime() < targetEnd.getTime()

  // 若整個窗口都塞不下任何時間（例如當天已經超過上限），回 too_late
  if (endEff.getTime() <= startEff.getTime()) {
    return res.status(409).json({ error: 'too_late' })
  }

  const category = (p.data.category as (typeof AllowedCategories)[number] | undefined) ?? undefined
  const note = p.data.note ?? undefined
  const created_by = p.data.created_by ?? undefined

  // 無 DB（本地測試）就回 demo 結果
  if (!pool) {
    return res.status(201).json({
      id: 'demo-' + Math.random().toString(36).slice(2),
      start: startEff.toISOString(),
      end: endEff.toISOString(),
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
    // ✅ 必須先同意借用規範
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    const has = await c.query('SELECT 1 FROM terms_acceptances WHERE user_id=$1 LIMIT 1', [userId])
    if (has.rowCount === 0) return res.status(403).json({ error: 'must_accept_terms' })

    await c.query('BEGIN')

    // 檢查重疊（與 DB constraint 一致）
    const rangeMode = '[]'
    const overlap = await c.query(
      `
      SELECT 1 FROM bookings
      WHERE tstzrange(start_ts, end_ts, $3) && tstzrange($1::timestamptz, $2::timestamptz, $3)
      LIMIT 1
      `,
      [startEff.toISOString(), endEff.toISOString(), rangeMode]
    )
    if (overlap.rows.length > 0) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    console.log('[bookings] inserting', {
      id,
      start: startEff.toISOString(),
      end: endEff.toISOString(),
      userId,
      category,
      note,
      created_by
    })

    await c.query(
      `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, note)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6)
      `,
      [id, startEff.toISOString(), endEff.toISOString(), created_by ?? userId ?? null, category ?? null, note ?? null]
    )

    await c.query('COMMIT')
    return res.status(201).json({
      id,
      start: startEff.toISOString(),
      end: endEff.toISOString(),
      truncated,
      persisted: true,
      status: 'pending',
      category: category ?? 'default',
      note: note ?? '',
      created_by: created_by ?? userId ?? '',
    })
  } catch (e: any) {
    await c.query('ROLLBACK')
    if (e?.constraint === 'bookings_no_overlap') {
      return res.status(409).json({ error: 'overlap' })
    }
    console.error('[bookings] insert failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})

/* --------------------------- 列表（全部） --------------------------- */

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

/* --------------------------- 列表（已核准） --------------------------- */

bookingsRouter.get('/approved', async (_req, res) => {
  if (!pool) {
    return res.json({ items: DEMO_BOOKINGS ? DEMO_ITEMS : [] })
  }
  const { rows } = await pool.query(
    `
    SELECT id, start_ts, end_ts, created_by, category, note
    FROM bookings
    WHERE status = 'approved'
    ORDER BY start_ts ASC
    `
  )
  if (rows.length === 0 && DEMO_BOOKINGS) {
    return res.json({ items: DEMO_ITEMS })
  }
  res.json({ items: rows })
})

/* --------------------------- 取消預約 --------------------------- */

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
    const b = f.rows[0] as { id: string; created_by: string | null; status: string }

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
      [id, admin ? userId : b.created_by]
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