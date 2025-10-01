// venue-booking-api/src/server/routes/admin.ts
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import * as bcrypt from 'bcryptjs'
import { makePool } from '../db'

export const adminRouter = Router()
const pool = makePool()

/* ───────────────────────── Admin 使用者載入 ────────────────────────── */
/**
 * 方式一（建議）：ADMIN_USERS_JSON（username → bcrypt-hash）
 *   例如：
 *   {
 *     "pastor": "$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "staff":  "$2a$10$yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
 *   }
 */
function loadAdminUsersFromJson(): Record<string, string> {
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
const adminUsersJson = loadAdminUsersFromJson()

/** 方式二：ADMIN_USER + ADMIN_PASS（明文，單一帳號） */
const singleUser = process.env.ADMIN_USER
const singlePass = process.env.ADMIN_PASS

/** 方式三（相容舊版）：ADMIN_PASSWORD（共用密碼，沒有帳號概念） */
const fallbackPassword = process.env.ADMIN_PASSWORD ?? ''

/* ─────────────────────────── 權限保護 ─────────────────────────── */
function ensureAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).session?.user
  if (!user || user.role !== 'admin') {
    console.warn('[admin][ensureAdmin] unauthorized', {
      origin: req.headers.origin,
      hasSession: Boolean((req as any).session),
      hasUser: Boolean(user),
      cookie: req.headers.cookie ? 'present' : 'missing',
    })
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

/* ─────────────────────────── 認證相關 API ─────────────────────────── */
// 目前登入者
adminRouter.get('/me', (req, res) => {
  const user = (req as any).session?.user ?? null
  res.json({ user })
})

// 登入：支援三種配置來源（JSON / 單一帳密 / 共用密碼）
adminRouter.post('/login', async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  const p = schema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' })

  const { username, password } = p.data

  let ok = false
  let displayName = username

  // 1) 先試 JSON（每人一把 bcrypt）
  const hash = adminUsersJson[username]
  if (typeof hash === 'string' && hash.length > 0) {
    try {
      ok = await bcrypt.compare(password, hash)
    } catch (e) {
      console.error('[admin][login] bcrypt compare error:', e)
      return res.status(500).json({ error: 'server_error' })
    }
  }

  // 2) 若 JSON 不存在，再試單一帳密
  if (!ok && singleUser && singlePass) {
    if (username === singleUser && password === singlePass) ok = true
  }

  // 3) 最後回退共用密碼（相容舊版）
  if (!ok && fallbackPassword) {
    ok = password === fallbackPassword
    // 共用密碼沒有帳號概念，固定顯示名稱
    if (ok) displayName = 'admin'
  }

  if (!ok) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }

  // ✅ 重生 session（防固定攻擊）→ 設 user → 保存（讓 Set-Cookie 寫出）
  ;(req as any).session.regenerate((regenErr: any) => {
    if (regenErr) {
      console.error('[admin][login] session regenerate error:', regenErr)
      return res.status(500).json({ error: 'server_error' })
    }
    ;(req as any).session.user = { id: `admin:${displayName}`, role: 'admin', name: displayName }
    ;(req as any).session.save((saveErr: any) => {
      if (saveErr) {
        console.error('[admin][login] session save error:', saveErr)
        return res.status(500).json({ error: 'server_error' })
      }
      return res.json({ ok: true })
    })
  })
})

// 登出
adminRouter.post('/logout', (req, res) => {
  ;(req as any).session?.destroy?.(() => {})
  res.json({ ok: true })
})

/* ─────────────────────────── 審核相關 API ─────────────────────────── */
// 近 60 天申請（可用 ?status=pending|approved|rejected 篩）
adminRouter.get('/review', ensureAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })

  const qStatus = (req.query.status as string | undefined)?.toLowerCase()
  const allowed = new Set(['pending', 'approved', 'rejected'])
  const hasStatus = qStatus && allowed.has(qStatus)

  try {
    const { rows } = await pool.query(
      `
      SELECT id, start_ts, end_ts, created_at, created_by, status,
             reviewed_at, reviewed_by, rejection_reason, category, note, venue
      FROM bookings
      WHERE created_at >= now() - interval '60 days'
        ${hasStatus ? `AND status = $1` : ``}
      ORDER BY created_at DESC
      `,
      hasStatus ? [qStatus] : []
    )
    res.json({ items: rows })
  } catch (e) {
    console.error('[admin][review] query failed:', e)
    res.status(500).json({ error: 'server_error' })
  }
})

// 核准
adminRouter.post('/bookings/:id/approve', ensureAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const reviewer = (req as any).session.user?.name ?? 'admin'

  try {
    const r = await pool.query(
      `
      UPDATE bookings
      SET status = 'approved',
          reviewed_at = now(),
          reviewed_by = $2,
          rejection_reason = NULL
      WHERE id = $1
      `,
      [id, reviewer]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    console.error('[admin][approve] update failed:', e)
    res.status(500).json({ error: 'server_error' })
  }
})

// 退件（可附理由）
adminRouter.post('/bookings/:id/reject', ensureAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'db_unavailable' })
  const id = req.params.id
  const reviewer = (req as any).session.user?.name ?? 'admin'

  const schema = z.object({ reason: z.string().trim().max(200).optional() })
  const p = schema.safeParse(req.body)
  if (!p.success) return res.status(400).json({ error: 'invalid_payload' })

  try {
    const r = await pool.query(
      `
      UPDATE bookings
      SET status = 'rejected',
          reviewed_at = now(),
          reviewed_by = $2,
          rejection_reason = $3
      WHERE id = $1
      `,
      [id, reviewer, p.data.reason ?? null]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    res.json({ ok: true })
  } catch (e) {
    console.error('[admin][reject] update failed:', e)
    res.status(500).json({ error: 'server_error' })
  }
})