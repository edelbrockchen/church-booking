// venue-booking-api/src/server/index.ts
import 'dotenv/config'
import express from 'express'
import type { RequestHandler } from 'express'
import session from 'express-session'
import Redis from 'ioredis'
import RedisStore from 'connect-redis'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import csrf from 'csurf'

import { bookingsRouter } from './routes/bookings'
import { adminRouter } from './routes/admin'

// ✅ terms 路由與 DB 連線
import { createTermsRouter } from './routes/terms.route'
import { makePool } from './db'

const app = express()

// 在 Render（或任何反向代理）後面，一定要開啟 trust proxy，讓 secure cookie / IP 等判斷正確
app.set('trust proxy', 1)

// 基本安全標頭
app.use(helmet())

// ---- CORS ----
// 支援多個來源（以逗號分隔），例如：
// CORS_ORIGIN="https://your-frontend.onrender.com,http://localhost:5173"
const ORIGINS =
  (process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean)) ??
  ['http://localhost:5173']

app.use(
  cors({
    origin: ORIGINS,
    credentials: true,
  })
)
// ----------------

app.use(express.json())
app.use(cookieParser())

// 判斷是否在雲端/生產（影響 cookie.secure）
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'

const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'
let sessionMiddleware: ReturnType<typeof session>

// Redis Session（優先）
if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL)
  const store = new RedisStore({ client: redis as any }) // v7：用 new 建立
  sessionMiddleware = session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd, // HTTPS 才送出 cookie（Render 會是 true）
    },
  })
  console.log('[api] session st