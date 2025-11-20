// src/server/index.ts
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import pg from 'pg'
import connectPgSimple from 'connect-pg-simple'
import rateLimit from 'express-rate-limit'

import termsRouter from './routes/terms.route'
import bookingsRouter from './routes/bookings'
import adminRouter from './routes/admin'
import { makePool } from './db'

/**
 * ----------------------------------------------------------------
 * 基本設定
 * ----------------------------------------------------------------
 */
const app = express()
app.set('trust proxy', 1) // 在 Render/反向代理後面，確保 secure cookies 正常

const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT || 3000)

/**
 * ----------------------------------------------------------------
 * CORS（一定要在任何路由之前）
 * ----------------------------------------------------------------
 *
 * 說明：
 * - 允許帶憑證（Cookie / Session）→ credentials: true
 * - allowlist 來源（可用環境變數 CORS_ORIGINS 自訂，多個以逗號分隔）
 * - 預設已包含本機、staging 與典型的 Render 網域
 */
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://venue-booking-frontend.onrender.com',
  'https://venue-booking-frontend-staging.onrender.com',
  'https://venue-booking-frontend-a3ib.onrender.com', // 你之前貼過的前端域名
]

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const allowlist = [...new Set([...defaultOrigins, ...envOrigins])]

app.use(
  cors({
    origin(origin, cb) {
      // 無 Origin（例如 curl/健康檢查）直接允許
      if (!origin) return cb(null, true)
      if (allowlist.includes(origin)) return cb(null, true)
      return cb(new Error(`CORS blocked for origin: ${origin}`))
    },
    credentials: true, // 允許帶 Cookie
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'Accept'],
  })
)

// 額外處理預檢（可選，但保險）
app.options('*', cors())

/**
 * ----------------------------------------------------------------
 * 安全性 & 解析
 * ----------------------------------------------------------------
 */
app.use(helmet())
app.use(express.json())
app.use(cookieParser())

/**
 * ----------------------------------------------------------------
 * Session（Postgres Store）
 * ----------------------------------------------------------------
 */
const PgSession = connectPgSimple(session)
const pool = makePool() // 你專案既有的 pg Pool 建立器
if (!pool) {
  // 若資料庫連不到，至少不要讓服務啟不來
  console.warn('[server] WARN: Postgres pool is null; session will use MemoryStore (not for prod).')
}

app.use(
  session({
    store: pool ? new PgSession({
      // connect-pg-simple 允許傳入 pg.Pool 或連線字串
      pool: (pool as unknown as pg.Pool),
      tableName: 'session',
      createTableIfMissing: true,
    }) : undefined,
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'none',   // 跨網域前後端需要 SameSite=None
      secure: true,       // 在 https/反向代理後建議一律 true
      maxAge: 7 * 24 * 3600 * 1000, // 7 天
    },
    name: 'vb.sid', // 自訂 cookie 名稱
  })
)

/**
 * ----------------------------------------------------------------
 * Rate Limit（基礎防刷）
 * ----------------------------------------------------------------
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', apiLimiter)

/**
 * ----------------------------------------------------------------
 * 健康檢查
 * ----------------------------------------------------------------
 */
app.get('/healthz', (_req, res) => res.json({ ok: true }))

/**
 * ----------------------------------------------------------------
 * 路由（注意：一定在 CORS/Session 之後）
 * ----------------------------------------------------------------
 */
app.use('/api/terms', termsRouter)
app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

/**
 * ----------------------------------------------------------------
 * 啟動
 * ----------------------------------------------------------------
 */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`)
    console.log(`[server] CORS allowlist:`, allowlist)
  })
}

export default app
