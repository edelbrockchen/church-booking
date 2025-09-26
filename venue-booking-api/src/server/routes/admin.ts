import { Router } from 'express'
import { z } from 'zod'
import * as bcrypt from 'bcryptjs' // 若 TS 提示型別，安裝 @types/bcryptjs

export const adminRouter = Router()

// 從環境變數載入「使用者 -> bcrypt 雜湊密碼」的對照
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
console.log('[admin] loaded admins:', Object.keys(adminUsers))

// （可選）相容舊版的共用明文密碼；若不想保留可把 ADMIN_PASSWORD 從 env 拔除
const fallbackPassword = process.env.ADMIN_PASSWORD ?? ''

// 目前登入者
adminRouter.get('/me', (req, res) => {
  const user = (req as any).session?.user ?? null
  res.json({ user })
})

// 登入（使用 bcrypt.compare）
adminRouter.post('/login', async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  const p = schema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' })

  const { username, password } = p.data

  const hash = adminUsers[username]
  let ok = false

  if (typeof hash === 'string' && hash.length > 0) {
    // ✅ 有設定該帳號的 bcrypt 雜湊 → 使用 bcrypt 驗證
    try {
      ok = await bcrypt.compare(password, hash)
    } catch (e) {
      console.error('[admin][login] bcrypt error:', e)
      return res.status(500).json({ error: 'server_error' })
    }
  } else if (fallbackPassword) {
    // 相容：若該帳號未在 JSON 內，且仍有舊的共用密碼，允許用共用密碼登入
    ok = password === fallbackPassword
  }

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