import express from 'express'
import session from 'express-session'
import cors, { CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import bookingsRouter from './routes/bookings'   // 你的檔案若是 default export，這行 OK
import termsRouter from './routes/terms.route'   // ← 修正：對應 terms.route.ts

const app = express()
app.set('trust proxy', 1) // Render/反向代理後面必開，不然 secure cookie 可能被丟掉
app.use(express.json())
app.use(cookieParser())

// ----- CORS（把你的前端網址放到 CORS_ORIGIN，逗號分隔可多個）-----
const ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // 同源或 CLI（curl）放行
    if (ORIGINS.length === 0 || ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true, // ★ 允許帶 cookie
}
app.use(cors(corsOptions))

// ----- Session（跨網域必須 SameSite=None + Secure）-----
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me'
const IS_DEV = process.env.NODE_ENV === 'development'

app.use(session({
  name: 'vb.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // 在 Render（HTTPS + 跨網域）必須如下；本機開發才放寬
    sameSite: IS_DEV ? 'lax' : 'none',
    secure: !IS_DEV,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}))

// ----- Routes -----
app.use('/api/admin', adminRouter)
app.use('/api/bookings', bookingsRouter)
app.use('/api/terms', termsRouter) // ← 掛上 terms 路由

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// （如有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`))

export default app
