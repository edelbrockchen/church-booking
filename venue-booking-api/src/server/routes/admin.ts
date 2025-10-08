// src/server/routes/admin.ts — hardened login + guards + quick whoami
import { Router } from 'express'
import bcrypt from 'bcryptjs'

const router = Router()
export default router

// 讀取環境的管理者帳號（JSON 物件：{ "user": "plainPassword", ... } 或雜湊）
function getUsers(): Record<string, string> {
  try {
    const raw = process.env.ADMIN_USERS_JSON || '{}'
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// 密碼比對：支援明文或 bcrypt 雜湊（以 $2a/$2b/$2y 開頭視為雜湊）
async function verifyPassword(pass: string, target: string): Promise<boolean> {
  if (/^\$2[aby]\$/.test(target)) {
    return await bcrypt.compare(pass, target)
  }
  return pass === target
}

// 保護中介層
function mustLogin(req: any, res: any, next: any) {
  if (req.session?.user?.role === 'admin') return next()
  return res.status(401).json({ error: 'UNAUTHORIZED' })
}

/* ------------------------------ routes ------------------------------ */

// 登入
router.post('/login', async (req: any, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' })

  const users = getUsers()
  const target = users[username]
  if (!target) return res.status(401).json({ error: 'BAD_CREDENTIALS' })

  const ok = await verifyPassword(password, target)
  if (!ok) return res.status(401).json({ error: 'BAD_CREDENTIALS' })

  req.session.regenerate((err: any) => {
    if (err) return res.status(500).json({ error: 'SESSION_REGENERATE_FAILED' })
    req.session.user = { id: username, role: 'admin' }
    req.session.save((err2: any) => {
      if (err2) return res.status(500).json({ error: 'SESSION_SAVE_FAILED' })
      return res.json({ ok: true, user: req.session.user })
    })
  })
})

// 登出
router.post('/logout', (req: any, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// 身分檢查（給前端調試用）
router.get('/whoami', (req: any, res) => {
  res.json({ ok: true, user: req.session?.user || null })
})

// 管理審核清單（示例：實務請改連資料庫）
router.get('/review', mustLogin, async (_req, res) => {
  // 請接資料庫；這裡回空陣列結構
  res.json({ ok: true, items: [] })
})
