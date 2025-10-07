import express from 'express'
import session from 'express-session'
import cors, { CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { adminRouter } from './routes/admin'
import bookingsRouter from './routes/bookings' // 若你的 bookings 是 default export，這行就對了
import termsRouter from './routes/terms'

const app = express()
app.set('trust proxy', 1) // ★ Render/反向代理後面必開，不然 secure cookie 會被丟掉
app.use(express.json())
app.use(cookieParser())
app.use('/api/terms', termsRouter)

// ----- CORS（把你的前端網址放到 CORS_ORIGIN）-----
const ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // 同源/CLI（如 curl）放行
    if (ORIGINS.length === 0 || ORIGINS.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true, // ★ 允許帶 cookie
}
app.use(cors(corsOptions))

// ----- Session（跨網域必須 SameSite=None + Secure）-----
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me'
app.use(session({
  name: 'vb.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',   // ★ 跨站必備
    secure: true,       // ★ HTTPS 必備
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}))

// ----- Routes -----
app.use('/api/admin', adminRouter)
app.use('/api/bookings', bookingsRouter)

// 健康檢查
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// （如有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`))

export default app
