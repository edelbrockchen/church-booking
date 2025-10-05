// src/server/index.ts
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import bookingsRouter from './routes/bookings'           // 你原本的 bookings 檔
import termsRouter from './routes/terms.route'           // 👈 這裡用 terms.route
import adminRouterDefault, { adminRouter as adminNamed } from './routes/admin'

// 相容 default / named export
const adminRouter = (adminNamed || adminRouterDefault) as any

const app = express()

// Render / 反向代理：secure cookie 需要
app.set('trust proxy', 1)

// CORS（跨站 Cookie 必要）
app.use(cors({
  origin: process.env.CORS_ORIGIN, // 例：https://你的前端.onrender.com
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Requested-With'],
}))

app.use(cookieParser())
app.use(express.json())

// Session：SameSite=None + Secure
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'none', secure: true },
}))

// 健康檢查
app.get('/api/health', (_req, res) => res.status(200).send('ok'))
app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

// 路由掛載
app.use('/api/admin', adminRouter)
app.use('/api', bookingsRouter)      // 提供 /api/bookings、/api/bookings/approved…
app.use('/api/terms', termsRouter)   // 提供 /api/terms/status、/api/terms/accept

const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})
