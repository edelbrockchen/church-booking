// venue-booking-api/src/server/routes/bookings.ts
import { Router, type Request } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

export const bookingsRouter = Router()
export default bookingsRouter

const pool = makePool()

/* --------------------------- 共用設定 / 型別 --------------------------- */

// 可接受的分類
const AllowedCategories = ['教會聚會', '社團活動', '研習', '其他'] as const

// 以台北時間 (UTC+8) 做日界線與上限判斷（避免受伺服器時區影響）
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000
function toTaipei(d: Date): Date { return new Date(d.getTime() + TAIPEI_OFFSET_MS) }
function fromTaipei(d: Date): Date { return new Date(d.getTime() - TAIPEI_OFFSET_MS) }
function taipeiDay(d: Date): number { return toTaipei(d).getDay() }            // 0=週日
function taipeiHour(d: Date): number { return toTaipei(d).getHours() }
function isSunday(d: Date) { return taipeiDay(d) === 0 }

// 依台北時間求「當日最晚結束時間（cap）」：週一/週三 18:00，其餘 21:30
function latestCap(d: Date): Date {
  const local = toTaipei(d)
  const day = local.getDay()
  const capLocal = new Date(local)
  if (day === 1 || day === 3) capLocal.setHours(18, 0, 0, 0)     // 週一、週三 18:00
  else capLocal.setHours(21, 30, 0, 0)                            // 其他日 21:30
  return fromTaipei(capLocal)                                     // 回到 UTC 時間基準
}

const createSchema = z.object({
  start: z.string().datetime(),                  // ISO 字串
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
    // 2025-09-28 10:00–13:00（台北時間）
    start_ts: '2025-09-28T10:00:00+08:00',
    end_ts:   '2025-09-28T13:00:00+08:00',
    created_by: '系統示例',
    category: '教會聚會',
    note: '示例事件 A',
  },
  {
    id: 'demo-2',
    // 2025-09-30 19:00–22:00（台北時間）
    start_ts: '2025-09-30T19:00:00+08:00',
    end_ts:   '2025-09-30T22:00:00+08:00',
    created_by: 'Alice',
    category: '研習',
    note: '示例事件 B',
  },
]

/* --------------------------- 建立預約 --------------------------- */

bookingsRouter.post('/', async (req, res) => {
  // 🔎 debug：觀察 session 使用者
  console.log('[bookings][POST /] userId =', getUserId(req))

  const p = createSchema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload', details: p.error.issues })

  // 解析開始時間（ISO）
  const start = new Date(p.data.start)
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'invalid_start' })

  // 週日禁用（以台北時間判斷）
  if (isSunday(start)) return res.status(409).json({ error: 'sunday_disabled' })

  // 每日最早 07:00（以台北時間判斷）
  if (taipeiHour(start) < 7) return res.status(409).json({ error: 'too_early' })

  // 當日最晚結束時間（以台北時間）
  const cap = latestCap(start)

  // 「最晚可開始」= cap - 3h；允許剛好等於邊界
  const latestStart = addHours(cap, -3)
  if (start.getTime() > latestStart.getTime()) {
    return res.status(409).json({ error: 'too_late' })
  }

  // 預設 3 小時；若超過上限就截斷
  const targetEnd = addHours(start, 3)
  const end = targetEnd.getTime() > cap.getTime() ? cap : targetEnd
  const truncated = end.getTime() < targetEnd.getTime()

  if (end.getTime() <= start.getTime()) {
    // 若被截短到不合理（例如太晚起始），直接拒絕
    return res.status(409).json({ error: 'too_late' })
  }

  const category = (p.data.category as (typeof AllowedCategories)[number] | undefined) ?? undefined
  const note = p.data.note ?? undefined
  const created_by = p.data.created_by ?? undefined

  // 無 DB 的 demo 回覆
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

    // 檢查重疊 —— 與 DB constraint 一致，皆採 '[]'
    const rangeMode = '[]'
    const overlap = await c.query(
      `
      SELECT 1 FROM bookings
      WHERE tstzrange(start_ts, end_ts, $3) && tstzrange($1::timestamptz, $2::timestamptz, $3)
      LIMIT 1
      `,
      [start.toISOString(), end.toISOString(), rangeMode]
    )
    if (overlap.rows.length > 0) {
      await c.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    console.log('[bookings] inserting', { id, start: start.toISOString(), end: end.toISOString(), userId, category, note })

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

    // 與 SQL 約束名稱一致
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
    // 沒有 DB：若開啟 demo，就給示例；否則空陣列
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
    // 有 DB 但目前沒有已核准，且開啟 demo → 回示例，前端先能看到畫面
    return res.json({ items: DEMO_ITEMS })
  }

  res.json({ items: rows })
})

/* --------------------------- 取消預約 --------------------------- */
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
    const b = f.rows[0] as { id: string; created_by: string | null; status: string }

    // 僅允許 pending / approved 轉 cancelled
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