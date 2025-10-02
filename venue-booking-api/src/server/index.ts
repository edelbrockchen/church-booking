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

// ★ 具名匯入（修正 build error）
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

// 3) CORS（允許跨網域＋攜帶 Cookie）
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ??
  'https://venue-booking-frontend-a3ib.onrender.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true) // Postman/curl/同源
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error('Not allowed by CORS: ' + origin))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'X-CSRF-Token',
    'X-Requested-With',
    'Authorization',
  ],
  exposedHeaders: ['X-CSRF-Token'],
}

app.use(cors(corsOptions))
// 預檢請求
app.options('*', cors(corsOptions))

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
    tableName: 'session',
    createTableIfMissing: true, // ★ 沒表時自動建立
  })
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
      sameSite: 'none',
      secure: true, // Render 一定是 HTTPS
      maxAge: 1000 * 60 * 60 * 4, // 4 小時
    },
  })
)

/* ---------------------- 保底：給未登入者一個 guest 身分 ---------------------- */
app.use((req, _res, next) => {
  const s: any = (req as any).session
  if (!s.user) {
    s.user = {
      id: `guest:${req.sessionID}`,
      role: 'guest',
    }
  }
  next()
})

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

// CSRF（提供前端索取 Token 的端點；未對所有 API 強制）
const csrfProtection = csrf({
  cookie: {
    key: 'vbx-csrf',
    httpOnly: true,
    sameSite: 'none',
    secure: true,
  },
}) as unknown as RequestHandler

app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Debug：檢視 session
app.get('/api/debug/session', (req, res) => {
  res.json({
    origin: req.headers.origin,
    cookieNames: Object.keys(req.cookies || {}),
    sessionUser: (req as any).session?.user ?? null,
    hasSession: Boolean((req as any).session),
  })
})

// Debug：cookie 標頭
app.get('/api/debug/cookies', (req, res) => {
  res.json({ cookieHeader: req.headers.cookie ?? null })
})

/* ------------------------------- 路由 ------------------------------- */
const pool = makePool()

if (pool) {
  app.use('/api/terms', createTermsRouter(pool))
  console.log('[api] /api/terms mounted')
} else {
  console.warn('[api] DATABASE_URL 未設定，/api/terms 未掛載')
  app.use('/api/terms', (_req, res) =>
    res.status(503).json({ error: 'db_unavailable' })
  )
}

app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

app.get('/api/debug/terms', async (req, res) => {
  const pool = makePool()
  const user = (req as any).session?.user
  let row = null
  try {
    if (pool && user?.id) {
      const r = await pool.query('SELECT accepted_at FROM terms_acceptances WHERE user_id=$1', [user.id])
      row = r.rows[0] || null
    }
  } catch {}
  res.set('Cache-Control','no-store')
  res.json({ user, terms: row })
})

/* -------- /api 兜底 404（放在所有 /api 路由之後） -------- */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'api_not_found' })
})

/* ------------------------------- 監聽 ------------------------------- */
const PORT = Number(process.env.PORT ?? '3000')
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on :${PORT}`)
})
