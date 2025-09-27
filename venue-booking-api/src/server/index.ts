// venue-booking-api/src/server/index.ts
import 'dotenv/config'
import express, { type RequestHandler } from 'express'
import session from 'express-session'
import pg from 'pg'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import csrf from 'csurf'

import { bookingsRouter } from './routes/bookings'
import { adminRouter } from './routes/admin'
import { createTermsRouter } from './routes/terms.route'
import { makePool } from './db'

const app = express()

/* ------------------------- 安全/中介層順序 ------------------------- */
// 1) 信任反向代理（Render / Proxy 後面）
app.set('trust proxy', 1)

// 2) 安全標頭
app.use(helmet())

// 3) CORS
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'https://venue-booking-frontend-a3ib.onrender.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true) // Postman/curl
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
      return cb(new Error('Not allowed by CORS'))
    },
    credentials: true,
  })
)

// 4) JSON + Cookie
app.use(express.json())
app.use(cookieParser())

/* ----------------------------- Session（Postgres） ----------------------------- */
const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'

let store: session.Store | undefined
if (process.env.DATABASE_URL) {
  const PgStore = connectPgSimple(session)
  const pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  store = new PgStore({
    pool: pgPool,
    tableName: 'session', // 你已在 Neon 建好此表
  })
  console.log('[api] session store: Postgres')
} else {
  console.warn('[api] session store: MemoryStore (DATABASE_URL 未設定；僅適合開發)')
}

app.use(
  session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'none', // 跨網域（前端/後端不同網域）
      secure: true,     // 必須 HTTPS（Render 會是 HTTPS）
      maxAge: 1000 * 60 * 60 * 2, // 2 小時
    },
  })
)

/* -------------------------- 共用中介層 -------------------------- */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(limiter)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
})
app.use('/api/admin/login', loginLimiter)

// CSRF
const csrfProtection = csrf({ cookie: true }) as unknown as RequestHandler
app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Debug Session（除錯用；穩定後可移除）
app.get('/api/debug/session', (req, res) => {
  res.json({
    origin: req.headers.origin,
    cookieNames: Object.keys(req.cookies || {}),
    sessionUser: (req as any).session?.user ?? null,
    hasSession: Boolean((req as any).session),
  })
})

/* ------------------------------- 路由 ------------------------------- */
const pool = makePool()

if (pool) {
  app.use('/api/terms', createTermsRouter(pool))
  console.log('[api] /api/terms mounted')
} else {
  console.warn('[api] DATABASE_URL 未設定，/api/terms 未掛載')
  app.use('/api/terms', (_req, res) => res.status(503).json({ error: 'db_unavailable' }))
}

app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

/* ------------------------------- 監聽 ------------------------------- */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`)
})