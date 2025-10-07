// venue-booking-api/src/server/routes/admin.ts
import { Router } from 'express'
import bcrypt from 'bcryptjs'

const router = Router()

type UserMap = Record<string, string> // username -> bcrypt hash

function loadUserMap(): UserMap {
  // If ADMIN_USERS_JSON exists, use map; else if ADMIN_PASSWORD exists, create fallback user 'admin'
  const raw = process.env.ADMIN_USERS_JSON
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      return parsed
    } catch (e) {
      console.error('[admin] Invalid ADMIN_USERS_JSON:', e)
    }
  }
  const fallbackPwd = process.env.ADMIN_PASSWORD
  if (fallbackPwd) {
    return { admin: fallbackPwd }
  }
  return {}
}

function ensureAuth(req: any, res: any, next: any) {
  if (req.session?.user) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' })
  }

  const users = loadUserMap()
  const hash = users[username]
  if (!hash) {
    return res.status(401).json({ error: '帳號或密碼錯誤，或尚未設定' })
  }
  try {
    const ok = await bcrypt.compare(password, hash)
    if (!ok) return res.status(401).json({ error: '帳號或密碼錯誤，或尚未設定' })

    // store session
    req.session.user = { username }
    return res.json({ ok: true, user: { username } })
  } catch (e) {
    console.error('[admin] login error', e)
    return res.status(500).json({ error: 'internal error' })
  }
})

router.post('/logout', (req, res) => {
  req.session?.destroy(() => {
    res.json({ ok: true })
  })
})

router.get('/me', (req: any, res) => {
  res.json({ user: req.session?.user || null })
})

router.get('/review-list', ensureAuth, async (_req, res) => {
  // placeholder for protected admin list
  res.json({ items: [] })
})

export default router
