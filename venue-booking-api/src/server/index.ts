// src/server/index.ts
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import cookieParser from 'cookie-parser'

// 路由
import bookingsRouter from './routes/bookings'
import termsRouter from './routes/terms.route' // 你的檔名是 terms.route.ts
import { adminRouter } from './routes/admin'   // 👈 改成命名匯入

const app = express()

// 反向代理（Render）：讓 secure cookie 正常
app.set('trust proxy', 1)

// CORS：允許前端網域，並啟用 credentials（跨站 Cookie 必要）
app.use(cors({
  origin: process.env.CORS_ORIGIN, // 例：https://你的前端.onrender.com（尾端不要 /）
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
}))

app.use(cookieParser())
app.use(express.json())

// Session：跨網域一定要 SameSite=None + Secure
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'none', secure: true },
}))

// 健康檢查（Render Health Check Path 可設 /api/health 或 /api/healthz）
app.get('/api/health', (_req, res) => res.status(200).send('ok'))
app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

// 掛載路由
app.use('/api/admin', adminRouter)
app.use('/api', bookingsRouter)       // /api/bookings、/api/bookings/approved…
app.use('/api/terms', termsRouter)    // /api/terms/status、/api/terms/accept

// 啟動
const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})