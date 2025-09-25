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

const app = express()

// 在 Render（或任何反向代理）後面，一定要開啟 trust proxy，讓 secure cookie / IP 等判斷正確
app.set('trust proxy', 1)

// 基本安全標頭
app.use(helmet())

// CORS：請把 CORS_ORIGIN 設為你的前端正式網址
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(cors({ origin: CORS_ORIGIN, credentials: true }))

app.use(express.json())
app.use(cookieParser())

// 判斷是否在雲端/生產（影響 cookie.secure）
const isProd = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'

const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'
let sessionMiddleware: ReturnType<typeof session>

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL)
  const store = new RedisStore({ client: redis as any })  // v7 正確用法：用 new
  sessionMiddleware = session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,     // HTTPS 才送出 cookie（Render 會是 true）
    }
  })
  console.log('[api] session store: Redis')
} else {
  sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
    }
  })
  console.log('[api] session store: MemoryStore (not for multi-instance/production)')
}
app.use(sessionMiddleware)

// 全站節流（你原本就有，保留）
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
app.use(limiter)

// 登入加嚴節流：防止暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 10,                  // 同一 IP 最多 10 次嘗試
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_login_attempts' }
})
app.use('/api/admin/login', loginLimiter)

// 用一致的 RequestHandler 型別，避免 TS2769（型別包版本衝突）
const csrfProtection = csrf({ cookie: true }) as unknown as RequestHandler
app.get('/api/csrf', csrfProtection, (req, res) => {
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => { console.log(`[api] listening on :${PORT}`) })