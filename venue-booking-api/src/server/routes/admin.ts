// src/server/routes/admin.ts
import { Router, type Request } from 'express'
import { makePool } from '../db'

export const adminRouter = Router()

const pool = makePool()

function isAdmin(req: Request): boolean {
  // 你的專案若有登入機制，可改成檢查 session
  // return (req as any).session?.user?.role === 'admin'
  // 先開放（避免因為未登入而看不到清單）
  return true
}

/**
 * GET /api/admin/review
 * 參數（全部可選）：
 *   days: number         近幾天（預設 60，會抓 [now - days, now + days]）
 *   venue: string        場地（'全部' / '大會堂' / '康樂廳' / '其它教室'）
 *   showFinished: '1'|'true' 是否顯示已結束（預設 true）
 *   q: string            關鍵字（申請人/場地/備註/分類）
 *
 * 回傳：
 * {
 *   items: Array<{
 *     id, start_ts, end_ts, created_at, created_by, status,
 *     reviewed_at, reviewed_by, rejection_reason, category, note, venue
 *   }>,
 *   stats: { pending: number, approved: number, rejected: number, cancelled: number }
 * }
 */
adminRouter.get('/review', async (req, res) => {
  if (!pool) return res.json({ items: [], stats: { pending: 0, approved: 0, rejected: 0, cancelled: 0 } })
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' })

  // 參數解析（寬鬆相容）
  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 60)))
  const now = new Date()
  const startRange = new Date(now.getTime() - days * 24 * 3600_000).toISOString()
  const endRange   = new Date(now.getTime() + days * 24 * 3600_000).toISOString()

  const showFinished = String(req.query.showFinished ?? 'true').toLowerCase() === 'true' || String(req.query.showFinished ?? '') === '1'
  const venue = (req.query.venue as string | undefined)?.trim()
  const q = (req.query.q as string | undefined)?.trim()

  // 動態 where
  let where = `start_ts >= $1 AND start_ts <= $2`
  const params: any[] = [startRange, endRange]
  let p = 3

  if (!showFinished) {
    where += ` AND end_ts > now()`
  }
  if (venue && venue !== '全部' && venue !== 'all') {
    where += ` AND venue = $${p++}`
    params.push(venue)
  }
  if (q && q.length) {
    where += ` AND (coalesce(created_by,'') ILIKE $${p} OR coalesce(venue,'') ILIKE $${p} OR coalesce(note,'') ILIKE $${p} OR coalesce(category,'') ILIKE $${p})`
    params.push(`%${q}%`)
    p++
  }

  const listSQL = `
    SELECT id, start_ts, end_ts, created_at, created_by, status,
           reviewed_at, reviewed_by, rejection_reason, category, note, venue
    FROM bookings
    WHERE ${where}
    ORDER BY start_ts ASC
  `

  const statSQL = `
    SELECT status, COUNT(*)::int AS n
    FROM bookings
    WHERE ${where}
    GROUP BY status
  `

  try {
    const c = await pool.connect()
    try {
      const [list, stat] = await Promise.all([
        c.query(listSQL, params),
        c.query(statSQL, params),
      ])

      const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
      for (const r of stat.rows) {
        const k = String(r.status)
        if (stats[k] !== undefined) stats[k] = Number(r.n) || 0
      }

      return res.json({ items: list.rows, stats })
    } finally {
      c.release()
    }
  } catch (e) {
    console.error('[admin/review] query failed:', e)
    return res.status(500).json({ error: 'server_error' })
  }
})

/** （可選）核准：POST /api/admin/review/:id/approve  */
adminRouter.post('/review/:id/approve', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' })
  const id = req.params.id
  try {
    await pool.query(`UPDATE bookings SET status='approved', reviewed_at=now(), reviewed_by='admin' WHERE id=$1`, [id])
    return res.json({ ok: true })
  } catch (e) {
    console.error('[admin/approve] failed:', e)
    return res.status(500).json({ error: 'server_error' })
  }
})

/** （可選）退回：POST /api/admin/review/:id/reject  body: { reason?: string } */
adminRouter.post('/review/:id/reject', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' })
  const id = req.params.id
  const reason = (req.body?.reason as string | undefined) ?? null
  try {
    await pool.query(
      `UPDATE bookings SET status='rejected', reviewed_at=now(), reviewed_by='admin', rejection_reason=$2 WHERE id=$1`,
      [id, reason]
    )
    return res.json({ ok: true })
  } catch (e) {
    console.error('[admin/reject] failed:', e)
    return res.status(500).json({ error: 'server_error' })
  }
})
