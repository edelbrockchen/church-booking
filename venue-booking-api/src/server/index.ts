// venue-booking-api/src/server/index.ts
import 'dotenv/config'
import express from 'express'
import type { RequestHandler } from 'express'
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

// 在 Render（或任何反向代理）後面，一定要開啟 trust proxy，讓 secure cookie / IP 等判斷正確
app.set('trust proxy', 1)

// 基本安全標頭
app.use(helmet())

// ---- CORS ----
// 支援多個來源（以逗號分隔），例如：
// CORS_ORIGIN="https://your-frontend.onrender.com,http://localhost:5173"
const ORIGINS =
  (process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean)) ??
  ['http://localhost:5173']

app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
)
// ----------------

app.use(express.json())
app.use(cookieParser())

// 判斷是否在雲端/生產（影響 cookie.secure）
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'

const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'
let sessionMiddleware: ReturnType<typeof session>

// Redis Session（優先）
if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL)
  const store = new RedisStore({ client: redis as any }) // v7：用 new 建立
  sessionMiddleware = session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // HTTPS 才送出 cookie（Render 會是 true）
    },
  })
  console.log('[api] session store: Redis')
} else {
  // MemoryStore 僅適合單節點/開發環境
  sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
    },
  })
  console.log('[api] session store: MemoryStore (not for multi-instance/production)')
}
app.use(sessionMiddleware)

// 全站節流（保留）
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(limiter)

// 登入加嚴節流：防止暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 10, // 同一 IP 最多 10 次嘗試
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
})
app.use('/api/admin/login', loginLimiter)

// CSRF：提供前端取得 token（若你在 /api/* 使用 csurf，保留即可）
const csrfProtection = csrf({ cookie: true }) as unknown as RequestHandler
app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// ✅ 建立 DB Pool（供 terms 路由使用；bookings 也可共用）
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

// 監聽
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`)
})