// venue-booking-api/src/server/routes/admin.ts
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { makePool } from '../db'

export const adminRouter = Router()
const pool = makePool()

/** 只有管理員才可通過 */
function requireAdmin(req: any, res: any, next: any) {
  const u = req.session?.user
  if (!u || u.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  next()
}

/* ---- 身分查詢 ---- */
adminRouter.get('/me', (req, res) => {
  const u = (req as any).session?.user
  res.json({ authenticated: !!u && u.role === 'admin', user: u?.role === 'admin' ? u : null })
})

/* ---- 登入 ----
   建議用環境變數：
   ADMIN_USER=admin
   ADMIN_PASS_HASH=<bcrypt雜湊>      // 推薦
   （或開發用）ADMIN_PASS=<純文字密碼> */
adminRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  const U = process.env.ADMIN_USER ?? 'admin'
  const HASH = process.env.ADMIN_PASS_HASH ?? ''
  const PLAIN = process.env.ADMIN_PASS ?? ''

  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' })
  if (username !== U)          return res.status(401).json({ error: 'invalid_credentials' })

  let ok = false
  if (HASH) ok = await bcrypt.compare(password, HASH)
  else if (PLAIN) ok = password === PLAIN
  else return res.status(500).json({ error: 'server_not_configured' })

  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })

  ;(req as any).session.user = { id: `admin:${U}`, name: U, role: 'admin' }
  res.json({ ok: true })
})

/* ---- 登出 ---- */
adminRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('vbsid', { sameSite: 'none', secure: true })
    res.json({ ok: true })
  })
})

/* ---- 管理動作：核准 / 退回 ---- */
adminRouter.post('/bookings/:id/approve', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const reviewer = (req as any).session.user?.id
  await pool.query(
    `UPDATE bookings
       SET status='approved', reviewed_at=now(), reviewed_by=$2, rejection_reason=NULL
     WHERE id=$1`,
    [id, reviewer]
  )
  res.json({ ok: true })
})

adminRouter.post('/bookings/:id/reject', requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const { reason } = req.body ?? {}
  const reviewer = (req as any).session.user?.id
  await pool.query(
    `UPDATE bookings
       SET status='rejected', reviewed_at=now(), reviewed_by=$2, rejection_reason=$3
     WHERE id=$1`,
    [id, reviewer, String(reason ?? '不符合借用規範')]
  )
  res.json({ ok: true })
})