import { Router } from 'express'
import { z } from 'zod'

export const adminRouter = Router()

// 讀環境變數：支援 per-user JSON；沒有就回退到單一 ADMIN_PASSWORD（相容舊版）
function loadAdminUsers(): Record<string, string> {
  const raw = process.env.ADMIN_USERS_JSON
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as Record<string, string>
  } catch (e) {
    console.error('[admin] ADMIN_USERS_JSON parse error:', e)
  }
  return {}
}

const adminUsers = loadAdminUsers()
const fallbackPassword = process.env.ADMIN_PASSWORD ?? ''

function checkLogin(username: string, password: string): boolean {
  const perUser = adminUsers[username]
  if (typeof perUser === 'string') {
    return password === perUser
  }
  // 相容：不在清單中的帳號，若有設定 ADMIN_PASSWORD，仍可用舊的共用密碼
  if (fallbackPassword) return password === fallbackPassword
  return false
}

// 目前登入者
adminRouter.get('/me', (req, res) => {
  const user = (req as any).session?.user ?? null
  res.json({ user })
})

// 登入：帳密來自 JSON（或回退共用密碼）
adminRouter.post('/login', (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  const p = schema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' })

  const { username, password } = p.data
  const ok = checkLogin(username, password)
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })

  ;(req as any).session.user = {
    id: `admin:${username}`,
    role: 'admin',
    name: username,
  }
  res.json({ ok: true })
})

// 登出
adminRouter.post('/logout', (req, res) => {
  (req as any).session?.destroy?.(() => {})
  res.json({ ok: true })
})