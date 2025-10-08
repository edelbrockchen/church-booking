// src/server/index.ts — fixed CORS + session cookies (SameSite=None + Partitioned) to stop 401
import express from 'express'
import session from 'express-session'
import cors, { type CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import bookingsRouter from './routes/bookings'
import termsRouter from './routes/terms.route'

const app = express()

// Trust reverse proxies (Render / Nginx / etc.), otherwise secure cookies may be discarded.
app.set('trust proxy', 1)

app.use(express.json())
app.use(cookieParser())

/* ------------------------- CORS ------------------------- */
// 如果前端有把 /api 反代成同源，就不需要嚴格 CORS；否則用白名單。
const ORIGINS_RAW = String(process.env.CORS_ORIGIN || '').trim()
const ORIGIN_LIST = ORIGINS_RAW
  ? ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : []

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // 同源或 CLI（如 curl）時 origin 為 null，直接放行
    if (!origin) return cb(null, true)
    if (ORIGIN_LIST.length === 0) return cb(null, true)
    if (ORIGIN_LIST.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
}
app.use(cors(corsOptions))

/* ----------------------- Session ------------------------ */
const IS_DEV = (process.env.NODE_ENV || 'development') !== 'production' ? true : false
const FRONTEND_PROXY = ['1','true','yes'].includes(String(process.env.FRONTEND_PROXY || process.env.VITE_USE_FRONTEND_PROXY || '0').toLowerCase())
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me'

// 兩種模式：同源（proxy）→ SameSite=Lax；跨站（直連）→ SameSite=None
const cookieOptions: session.CookieOptions = {
  httpOnly: true,
  sameSite: (FRONTEND_PROXY ? 'lax' : 'none'),
  secure: !IS_DEV,                 // 生產環境必須 https
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
}

// CHIPS：在封鎖第三方 Cookie 的瀏覽器中，允許以「分割式 Cookie」存 session
const COOKIE_PARTITIONED = ['1','true','yes'].includes(String(process.env.COOKIE_PARTITIONED || process.env.ENABLE_PARTITIONED_COOKIES || '0').toLowerCase())
if (!FRONTEND_PROXY && COOKIE_PARTITIONED) {
  (cookieOptions as any).partitioned = true
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: cookieOptions,
  name: process.env.SESSION_NAME || 'vb.sid',
}))

// 小工具：檢查目前身份與 Cookie 屬性
app.get('/api/_whoami', (req, res) => {
  const u = (req as any).session?.user || null
  res.json({
    ok: true,
    user: u,
    cookie: {
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      partitioned: Boolean((cookieOptions as any).partitioned || false),
    }
  })
})

/* ------------------------ Routes ------------------------ */
app.use('/api/admin', adminRouter)
app.use('/api', bookingsRouter)
app.use('/api/terms', termsRouter)

// （如有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

/* ------------------------- Listen ----------------------- */
const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})

export default app
