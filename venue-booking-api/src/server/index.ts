// src/server/index.ts
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import bodyParser from 'body-parser'

// 如果你的專案有 admin 路由，就保留這兩行；沒有的話可以刪掉
import { adminRouter } from './routes/admin'

const app = express()

// ✅ 代理環境（Render）必備，否則 secure cookie 可能被丟掉
app.set('trust proxy', 1)

// ✅ CORS：允許你的前端網域，並開啟憑證（Cookie）
app.use(cors({
  origin: process.env.CORS_ORIGIN, // 例： https://venue-booking-frontend-a3ib.onrender.com
  credentials: true,
}))

app.use(cookieParser())
app.use(bodyParser.json())

// ✅ Session：跨網域一定要 SameSite=None + Secure
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
  },
}))

// ✅ 健康檢查：同時提供 /api/health 與 /api/healthz（避免設定不一致）
app.get('/api/health', (_req, res) => res.status(200).send('ok'))
app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

// 你的既有路由（有就保留）
app.use('/api/admin', adminRouter)

// 啟動（Render 會把埠號放在 process.env.PORT）
const PORT = Number(process.env.PORT) || 3000
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})
