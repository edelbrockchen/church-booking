// venue-booking-api/src/server/index.ts
import 'dotenv/config'
import express, { type RequestHandler } from 'express'
import session from 'express-session'
import Redis from 'ioredis'
import RedisStore from 'connect-redis'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import csrf from 'csurf'

import { bookingsRouter } from './routes/bookings'
import { adminRouter } from './routes/admin'

// ✅ terms 路由與 DB 連線
import { createTermsRouter } from './routes/terms.route'
import { makePool } from './db'

const app = express()

/* ------------------------- 安全/中介層順序很重要 ------------------------- */
// 1) 反向代理（Render 必要）
app.set('trust proxy', 1)

// 2) 安全標頭
app.use(helmet())

// 3) CORS（允許前端網域 + 帶憑證）
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'https://venue-booking-frontend-a3ib.onrender.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, cb) => {
      // 同源（例如 curl/Postman）或在清單內 → 放行
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
      return cb(new Error('Not allowed by CORS'))
    },
    credentials: true,
  })
)

// 4) JSON 解析與 Cookie
app.use(express.json())
app.use(cookieParser())

// 5) Session（跨網域：SameSite=None + Secure=true）
const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'
let store: any = undefined

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL)
  store = new RedisStore({ client: redis as any })
  console.log('[api] session store: Redis')
} else {
  console.log('[api] session store: MemoryStore (single-instance only)')
}

app.use(
  session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'none', // ← 跨網域必須
      secure: true,     // ← Render/HTTPS 必須
      maxAge: 1000 * 60 * 60 * 2, // 2 小時
    },
  })
)

/* ---------------------------- 其餘共用中介層 ---------------------------- */
// 全站節流
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(limiter)

// 登入加嚴節流（防暴力破解）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
})
app.use('/api/admin/login', loginLimiter)

// CSRF：提供前端取得 token（如需）
const csrfProtection = csrf({ cookie: true }) as unknown as RequestHandler
app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

/* --------------------------------- 路由 --------------------------------- */
// ✅ 建立 DB Pool（terms / bookings 共用）
const pool = makePool()

// ✅ 掛載 terms API（與前端「軟式門檻」搭配）
if (pool) {
  app.use('/api/terms', createTermsRouter(pool))
  console.log('[api] /api/terms mounted')
} else {
  console.warn('[api] DATABASE_URL 未設定，/api/terms 未掛載（terms 功能停用）')
  app.use('/api/terms', (_req, res) => res.status(503).json({ error: 'db_unavailable' }))
}

// 既有路由
app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

/* --------------------------------- 監聽 --------------------------------- */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`)
})