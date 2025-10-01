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
app.set('trust proxy', 1)
app.use(helmet())

/* ------------------------------- CORS ------------------------------- */
/** 設在 Render 環境變數：
 *  CORS_ORIGIN=https://venue-booking-frontend-a3ib.onrender.com,http://localhost:5173
 */
const RAW_ALLOWED = (process.env.CORS_ORIGIN ??
  'https://venue-booking-frontend-a3ib.onrender.com'
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// 正規化：去掉尾端斜線，避免 https://a.com 與 https://a.com/ 比對失敗
const ALLOWED_ORIGINS = RAW_ALLOWED.map(o => o.replace(/\/+$/, ''))
const ALLOWED_SET = new Set(ALLOWED_ORIGINS)

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true) // e.g. curl/Postman 或同源
    const norm = origin.replace(/\/+$/, '')
    if (ALLOWED_SET.has(norm)) return cb(null, true)
    // 不丟錯，回傳 false 讓瀏覽器看見乾淨的 CORS 拒絕
    return cb(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Requested-With', 'Authorization'],
  exposedHeaders: ['X-CSRF-Token'],
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

/* ----------------------------- JSON + Cookie ----------------------------- */
app.use(express.json())
app.use(cookieParser())

/* ----------------------------- Session（Postgres） ----------------------------- */
const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'

let store: session.Store | undefined
if (process.env.DATABASE_URL) {
  const PgStore = connectPgSimple(session)
  const pgPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  store = new PgStore({ pool: pgPool, tableName: 'session' })
  console.log('[api] session store: Postgres')
} else {
  console.warn('[api] session store: MemoryStore (DATABASE_URL 未設定；僅適合開發)')
}

app.use(
  session({
    name: 'vbsid',
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'none', // 前後端不同網域一定要 none
      secure: true,     // Render 一定是 HTTPS
      maxAge: 1000 * 60 * 60 * 4, // 4 小時
    },
  })
)

/* ---------------------- 給未登入者一個 guest 身分 ---------------------- */
app.use((req, _res, next) => {
  const s: any = (req as any).session
  if (!s.user) {
    s.user = { id: `guest:${req.sessionID}`, role: 'guest' }
  }
  next()
})

/* -------------------------- 共用中介層 -------------------------- */
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
app.use(limiter)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' },
})
app.use('/api/admin/login', loginLimiter)

/* ------------------------------ CSRF Token ------------------------------ */
const csrfProtection = csrf({
  cookie: { key: 'vbx-csrf', httpOnly: true, sameSite: 'none', secure: true },
}) as unknown as RequestHandler

app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

/* ------------------------------- 健康/除錯 ------------------------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/debug/session', (req, res) => {
  res.json({
    origin: req.headers.origin,
    cookieNames: Object.keys(req.cookies || {}),
    sessionUser: (req as any).session?.user ?? null,
    hasSession: Boolean((req as any).session),
  })
})
app.get('/api/debug/cookies', (req, res) => {
  res.json({ cookieHeader: req.headers.cookie ?? null })
})
// ✅ CORS 診斷：看目前允許名單與這次請求的 Origin
app.get('/api/debug/cors-allowed', (req, res) => {
  const origin = (req.headers.origin || '').toString().replace(/\/+$/, '')
  res.json({ origin, allowed: ALLOWED_ORIGINS })
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

/* -------- /api 兜底 404（放在所有 /api 路由之後） -------- */
app.use('/api', (_req, res) => res.status(404).json({ error: 'api_not_found' }))

/* ------------------------------- 監聽 ------------------------------- */
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('[api] listening on :' + PORT)
  console.log('[api] CORS allowed origins =', ALLOWED_ORIGINS.join(', '))
})