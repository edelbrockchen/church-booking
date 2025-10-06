// src/server/routes/admin.ts
import { Router, type Request } from 'express'
import { makePool } from '../db'
import bcrypt from 'bcryptjs'

export const adminRouter = Router()
const pool = makePool()

/* -------------------- 讀取管理者清單 -------------------- */
type AdminUser = { username: string; passwordHash?: string; displayName?: string; password?: string }
function loadAdmins(): AdminUser[] {
  const raw = process.env.ADMIN_USERS_JSON
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (Array.isArray(v)) return v as AdminUser[]
    if (v && typeof v === 'object') {
      // 也支援 { "admin":"$2a$..." } 這種舊格式
      return Object.entries(v).map(([username, passwordHash]) => ({ username, passwordHash: String(passwordHash) }))
    }
  } catch { /* ignore */ }
  return []
}
const ADMIN_OPEN = (process.env.ADMIN_OPEN ?? 'false').toLowerCase() === 'true' // 預設關閉免登入！
const ADMINS = loadAdmins()

async function verifyPassword(stored: string | undefined, password: string): Promise<boolean> {
  if (!stored) return false
  // bcrypt
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    try { return await bcrypt.compare(password, stored) } catch { return false }
  }
  // 明文（不建議）：允許 "plain:xxx"
  if (stored.startsWith('plain:')) return stored.slice(6) === password
  // 退而求其次：完全相等（不建議）
  return stored === password
}

function isAdmin(req: Request): boolean {
  return (req as any).session?.user?.role === 'admin'
}
function requireAdmin(req: Request, res: any): boolean {
  if (ADMIN_OPEN) {
    // 免登入模式：自動給 admin session（只在你刻意開啟時）
    const sess: any = (req as any).session || ((req as any).session = {})
    if (!sess.user) sess.user = { id: 'admin', role: 'admin', name: 'Open Admin' }
    return true
  }
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
  return true
}

/* -------------------- 登入 / 登出 -------------------- */
// 只回狀態，不自動登入
adminRouter.get('/login', (req, res) => {
  const u = (req as any).session?.user
  res.json({ loggedIn: !!u, user: u ? { id: u.id, role: u.role, name: u.name } : null })
})

// 提交帳密登入：{ username, password }
adminRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' })

  const user = ADMINS.find(u => u.username === String(username))
  if (!user) return res.status(401).json({ error: 'bad_credentials' })

  const ok = await verifyPassword(user.passwordHash || user.password, String(password))
  if (!ok) return res.status(401).json({ error: 'bad_credentials' })

  const sess: any = (req as any).session || ((req as any).session = {})
  sess.user = { id: user.username, role: 'admin', name: user.displayName || user.username }
  res.json({ ok: true, user: sess.user })
})

adminRouter.post('/logout', (req, res) => {
  const s: any = (req as any).session
  if (s?.destroy) s.destroy(() => res.json({ ok: true }))
  else { res.json({ ok: true }) }
})

/* -------------------- 管理清單 -------------------- */
/**
 * GET /api/admin/review?days=60&venue=全部&showFinished=true&q=關鍵字
 * 回 { items:[...], stats:{pending,approved,rejected,cancelled} }
 */
adminRouter.get('/review', async (req, res) => {
  if (!requireAdmin(req, res)) return
  if (!pool) return res.json({ items: [], stats: { pending: 0, approved: 0, rejected: 0, cancelled: 0 } })

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
    SELECT DISTINCT ON (id)
           id, start_ts, end_ts, created_at, created_by, status,
           reviewed_at, reviewed_by, rejection_reason, category, note, venue
    FROM bookings
    WHERE ${where}
    ORDER BY id, start_ts ASC
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
    console.error('[admin/review] failed:', e)
    res.status(500).json({ error: 'server_error' })
  }
})

/* -------------------- 核准 / 退回（相容：review/* 與 bookings/*；GET/POST 都支援） -------------------- */
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
function reviewerId(req: Request): string { return ((req as any).session?.user?.id as string) || 'admin' }
function getReason(req: Request): string | null {
  return (req.body?.reason as string | undefined) ?? (req.query?.reason as string | undefined) ?? null
}
function approveHandler(method: 'GET'|'POST') {
  return async (req: Request, res: any) => {
    if (!requireAdmin(req, res)) return
    const id = req.params.id
    try { await doApprove(id, reviewerId(req)); res.json({ ok: true, id, action: 'approved', via: method }) }
    catch (e) { console.error('[admin/approve] failed:', e); res.status(500).json({ error: 'server_error' }) }
  }
}
function rejectHandler(method: 'GET'|'POST') {
  return async (req: Request, res: any) => {
    if (!requireAdmin(req, res)) return
    const id = req.params.id, reason = getReason(req)
    try { await doReject(id, reviewerId(req), reason); res.json({ ok: true, id, action: 'rejected', reason, via: method }) }
    catch (e) { console.error('[admin/reject] failed:', e); res.status(500).json({ error: 'server_error' }) }
  }
}
// review 路徑
adminRouter.post('/review/:id/approve', approveHandler('POST'))
adminRouter.get('/review/:id/approve', approveHandler('GET'))
adminRouter.post('/review/:id/reject',  rejectHandler('POST'))
adminRouter.get('/review/:id/reject',  rejectHandler('GET'))
// bookings 相容路徑（前端可能用）
adminRouter.post('/bookings/:id/approve', approveHandler('POST'))
adminRouter.get('/bookings/:id/approve', approveHandler('GET'))
adminRouter.post('/bookings/:id/reject',  rejectHandler('POST'))
adminRouter.get('/bookings/:id/reject',  rejectHandler('GET'))
