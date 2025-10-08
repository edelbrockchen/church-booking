import express from 'express'
import session from 'express-session'
import cors, { type CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import bookingsRouter from './routes/bookings'   // 若 bookings 是 default export，這行正確
import termsRouter from './routes/terms.route'   // 對應 terms.route.ts

const app = express()

// 在 Render/反向代理之後必開，否則 secure cookie 可能被丟掉
app.set('trust proxy', 1)

app.use(express.json())
app.use(cookieParser())

/* ------------------------- CORS 設定 ------------------------- */
// 前端若做了 /api 反向代理（同源），就不需要嚴格 CORS
const FRONTEND_PROXY = ['1', 'true', 'yes'].includes(
  String(process.env.FRONTEND_PROXY ?? process.env.VITE_USE_FRONTEND_PROXY ?? 'false').toLowerCase()
)

const ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (FRONTEND_PROXY) return cb(null, true)   // 同源：直接放行
    if (!origin) return cb(null, true)          // 同源或 CLI 請求（如 curl）
    if (ORIGINS.length === 0 || ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true, // 允許帶 cookie
}

app.use(cors(corsOptions))

/* ----------------------- Session 設定 ------------------------ */
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me'
const IS_DEV = process.env.NODE_ENV === 'development'

// 兩種模式：同源(Lax) / 跨站(None)
// 跨站可再啟用分割式 Cookie（CHIPS）
const cookieOptions: session.CookieOptions = {
  httpOnly: true,
  sameSite: (FRONTEND_PROXY ? 'lax' : 'none'),
  secure: !IS_DEV, // Render/正式環境為 true；本機開發允許 http
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

const COOKIE_PARTITIONED = ['1', 'true', 'yes'].includes(
  String(process.env.COOKIE_PARTITIONED ?? process.env.ENABLE_PARTITIONED_COOKIES ?? 'false').toLowerCase()
)
if (!FRONTEND_PROXY && COOKIE_PARTITIONED) {
  // 型別尚未收錄 Partitioned，使用斷言
  // @ts-expect-error partitioned 尚未在型別中
  cookieOptions.partitioned = true
}

app.use(session({
  name: 'vb.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: cookieOptions,
}))

/* -------------------------- Routes -------------------------- */
app.use('/api/admin', adminRouter)
app.use('/api/bookings', bookingsRouter)
app.use('/api/terms', termsRouter)

// 健康檢查
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: IS_DEV ? 'dev' : 'prod',
    proxy: FRONTEND_PROXY,
    cookie: {
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      // @ts-ignore 僅用於除錯顯示
      partitioned: Boolean(cookieOptions.partitioned),
    },
  })
})

// （如有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

/* --------------------------- Listen ------------------------- */
const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})

export default app
