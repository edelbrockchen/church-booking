// src/server/routes/admin.ts
import { Router, type Request } from 'express'
import { makePool } from '../db'

export const adminRouter = Router()
const pool = makePool()

/* -------------------- utils -------------------- */

function ensureAdmin(req: Request): boolean {
  // 開放式管理（無登入也可）：預設 true，若要強制登入可把環境變數設為 'false'
  const open = (process.env.ADMIN_OPEN ?? 'true').toLowerCase() === 'true'
  if (open) {
    const sess: any = (req as any).session || ((req as any).session = {})
    sess.user = sess.user || { id: 'admin', role: 'admin' }
    return true
  }
  return (req as any).session?.user?.role === 'admin'
}

function reviewerId(req: Request): string {
  return ((req as any).session?.user?.id as string) || 'admin'
}

/* -------------------- login -------------------- */

// GET/POST /api/admin/login  → 建立 admin session
adminRouter.get('/login', (req, res) => {
  const sess: any = (req as any).session || ((req as any).session = {})
  sess.user = { id: 'admin', role: 'admin' }
  res.json({ ok: true, role: 'admin' })
})

adminRouter.post('/login', (req, res) => {
  const sess: any = (req as any).session || ((req as any).session = {})
  sess.user = { id: 'admin', role: 'admin' }
  res.json({ ok: true, role: 'admin' })
})

/* -------------------- 管理清單 -------------------- */
/**
 * GET /api/admin/review?days=60&venue=全部&showFinished=true&q=關鍵字
 * 回傳 { items:[...], stats:{pending,approved,rejected,cancelled} }
 */
adminRouter.get('/review', async (req, res) => {
  if (!pool) return res.json({ items: [], stats: { pending: 0, approved: 0, rejected: 0, cancelled: 0 } })
  if (!ensureAdmin(req)) return res.status(401).json({ error: 'unauthorized' })

  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 60)))
  const now = new Date()
  const startRange = new Date(now.getTime() - days * 86400_000).toISOString()
  const endRange   = new Date(now.getTime() + days * 86400_000).toISOString()

  const showFinished = String(req.query.showFinished ?? 'true').toLowerCase() === 'true' || String(req.query.showFinished ?? '') === '1'
  const venue = (req.query.venue as string | undefined)?.trim()
  const q = (req.query.q as string | undefined)?.trim()

  let where = `start_ts >= $1 AND start_ts <= $2`
  const params: any[] = [startRange, endRange]
  let p = 3

  if (!showFinished) { where += ` AND end_ts > now()` }
  if (venue && venue !== '全部' && venue !== 'all') { where += ` AND venue = $${p++}`; params.push(venue) }
  if (q && q.length) {
    where += ` AND (coalesce(created_by,'') ILIKE $${p} OR coalesce(venue,'') ILIKE $${p} OR coalesce(note,'') ILIKE $${p} OR coalesce(category,'') ILIKE $${p})`
    params.push(`%${q}%`); p++
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
      const [list, stat] = await Promise.all([c.query(listSQL, params), c.query(statSQL, params)])
      const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0 }
      for (const r of stat.rows) { const k = String(r.status); if (stats[k] !== undefined) stats[k] = Number(r.n) || 0 }
      res.json({ items: list.rows, stats })
    } finally { c.release() }
  } catch (e) {
    console.error('[admin/review] query failed:', e)
    res.status(500).json({ error: 'server_error' })
  }
})

/* -------------------- 核准 / 退回（相容多路徑 + GET/POST） -------------------- */

async function doApprove(id: string, reviewer: string) {
  if (!pool) throw new Error('db_unavailable')
  await pool.query(
    `UPDATE bookings SET status='approved', reviewed_at=now(), reviewed_by=$2, rejection_reason=NULL WHERE id=$1`,
    [id, reviewer]
  )
}
async function doReject(id: string, reviewer: string, reason: string | null) {
  if (!pool) throw new Error('db_unavailable')
  await pool.query(
    `UPDATE bookings SET status='rejected', reviewed_at=now(), reviewed_by=$2, rejection_reason=$3 WHERE id=$1`,
    [id, reviewer, reason]
  )
}

function getReason(req: Request): string | null {
  // 允許從 body.reason 或 query.reason 帶入原因
  return (req.body?.reason as string | undefined)
      ?? (req.query?.reason as string | undefined)
      ?? null
}

function approveHandler(method: 'GET'|'POST') {
  return async (req: Request, res: any) => {
    if (!ensureAdmin(req)) return res.status(401).json({ error: 'unauthorized' })
    const id = req.params.id
    try {
      await doApprove(id, reviewerId(req))
      // 若是 GET 由按鈕觸發，也回 JSON，前端會自動重抓列表
      return res.json({ ok: true, id, action: 'approved', via: method })
    } catch (e) {
      console.error('[admin/approve] failed:', e)
      return res.status(500).json({ error: 'server_error' })
    }
  }
}
function rejectHandler(method: 'GET'|'POST') {
  return async (req: Request, res: any) => {
    if (!ensureAdmin(req)) return res.status(401).json({ error: 'unauthorized' })
    const id = req.params.id
    const reason = getReason(req)
    try {
      await doReject(id, reviewerId(req), reason)
      return res.json({ ok: true, id, action: 'rejected', reason, via: method })
    } catch (e) {
      console.error('[admin/reject] failed:', e)
      return res.status(500).json({ error: 'server_error' })
    }
  }
}

// 既有路徑（review）
adminRouter.post('/review/:id/approve', approveHandler('POST'))
adminRouter.get('/review/:id/approve', approveHandler('GET'))
adminRouter.post('/review/:id/reject',  rejectHandler('POST'))
adminRouter.get('/review/:id/reject',  rejectHandler('GET'))

// 相容路徑（bookings）← 你的前端現在在用
adminRouter.post('/bookings/:id/approve', approveHandler('POST'))
adminRouter.get('/bookings/:id/approve', approveHandler('GET'))
adminRouter.post('/bookings/:id/reject',  rejectHandler('POST'))
adminRouter.get('/bookings/:id/reject',  rejectHandler('GET'))