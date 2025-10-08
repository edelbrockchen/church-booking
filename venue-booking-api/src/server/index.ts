import express from 'express'
import session from 'express-session'
import cors, { CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import bookingsRouter from './routes/bookings'   // 若你的 bookings 是 default export，這行 OK
import termsRouter from './routes/terms.route'   // 對應 terms.route.ts

const app = express()

// 在 Render/反向代理之後，必開，否則 secure cookie 可能被丟掉
app.set('trust proxy', 1)

app.use(express.json())
app.use(cookieParser())

/* ------------------------- CORS 設定 ------------------------- */
/** 若採「前端 /api 反代」(FRONTEND_PROXY=true)，請求是同源，不需要嚴格 CORS。 */
const FRONTEND_PROXY = ['1', 'true', 'yes'].includes(
  (process.env.FRONTEND_PROXY ?? process.env.VITE_USE_FRONTEND_PROXY ?? 'false').toLowerCase()
)
const ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (FRONTEND_PROXY) return cb(null, true) // 同源情境：放行
    if (!origin) return cb(null, true)        // 同源或 CLI（curl）
    if (ORIGINS.length === 0 || ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true, // 允許帶 cookie
}
app.use(cors(corsOptions))

/* ----------------------- Session 設定 ------------------------ */
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me'
const IS_DEV = process.env.NODE_ENV === 'development'

// 兩種模式：同源(Lax) / 跨站(None)；跨站可選 Partitioned（CHIPS）
const cookieOptions: session.CookieOptions = {
  httpOnly: true,
  sameSite: (FRONTEND_PROXY ? 'lax' : 'none'),
  secure: !IS_DEV, // Render/正式環境必為 true；本機開發允許 http
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

// 若是跨站直連，且希望在封鎖第三方 Cookie 下仍可用 → 啟用 Partitioned
const COOKIE_PARTITIONED = ['1', 'true', 'yes'].includes(
  (process.env.COOKIE_PARTITIONED ?? process.env.ENABLE_PARTITIONED_COOKIES ?? 'false').toLowerCase()
)
if (!FRONTEND_PROXY && COOKIE_PARTITIONED) {
  // express-session 的型別尚未完全涵蓋 Partitioned，故以 any 斷言
  ;(cookieOptions as any).partitioned = true
}

app.use(session({
 app.use(session({
  name: 'vb.sid',
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',      // 同源/同站用 Lax：不受第三方 Cookie 封鎖
    secure: true,         // Render 走 HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000,
}))

/* -------------------------- Routes -------------------------- */
app.use('/api/admin', adminRouter)
app.use('/api/bookings', bookingsRouter)
app.use('/api/terms', termsRouter)

// 健康檢查（可留用於除錯）
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: IS_DEV ? 'dev' : 'prod',
    proxy: FRONTEND_PROXY,
    cookie: {
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      partitioned: Boolean((cookieOptions as any).partitioned),
    },
  })
})

// （如有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

/* --------------------------- Listen ------------------------- */
const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`))

export default app
