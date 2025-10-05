// src/server/routes/admin.ts
import { Router } from 'express'
import bcrypt from 'bcryptjs'

export const adminRouter = Router()

type AdminMap = Record<string, string> // username -> bcrypt hash

function getAdminMap(): AdminMap {
  try {
    const raw = process.env.ADMIN_USERS_JSON
    if (!raw) return {}
    return JSON.parse(raw)
  } catch (e) {
    console.error('[admin] parse ADMIN_USERS_JSON failed', e)
    return {}
  }
}

// Simple session gate
function requireAdmin(req: any, res: any, next: any) {
  if (req.session?.admin?.user) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

adminRouter.post('/login', async (req: any, res: any) => {
  const { username, password } = req.body || {}
  const admins = getAdminMap()
  const hash = admins?.[username]
  if (!hash) return res.status(401).json({ error: 'invalid' })
  const ok = await bcrypt.compare(password || '', hash)
  if (!ok) return res.status(401).json({ error: 'invalid' })
  req.session.admin = { user: username }
  res.json({ ok: true, user: username })
})

adminRouter.post('/logout', (req: any, res: any) => {
  req.session?.destroy(() => res.json({ ok: true }))
})

adminRouter.get('/me', (req: any, res: any) => {
  const user = req.session?.admin?.user || null
  res.json({ user })
})

// Example protected endpoint (replace with your existing implementation)
adminRouter.get('/review', requireAdmin, async (_req: any, res: any) => {
  // Replace with DB query for pending bookings
  res.json({ items: [] })
})