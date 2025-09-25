import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import Redis from 'ioredis'
import RedisStore from 'connect-redis'   // ← 這裡改成預設匯入 class
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import csrf from 'csurf'
import { bookingsRouter } from './routes/bookings'
import { adminRouter } from './routes/admin'

const app = express()

app.use(helmet())

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(cors({ origin: CORS_ORIGIN, credentials: true }))

app.use(express.json())
app.use(cookieParser())

const sessionSecret = process.env.SESSION_SECRET || 'please-change-me'
let sessionMiddleware: ReturnType<typeof session>

if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL)
  const store = new RedisStore({ client: redis as any })  // ← 以 new 建立 store
  sessionMiddleware = session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false }
  })
  console.log('[api] session store: Redis')
} else {
  sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false }
  })
  console.log('[api] session store: MemoryStore (not for multi-instance/production)')
}
app.use(sessionMiddleware)

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 })
app.use(limiter)

const csrfProtection = csrf({ cookie: true })
app.get('/api/csrf', csrfProtection, (req, res) => {
  // 型別上加個保護，避免 TS 抱怨
  const token = (req as any).csrfToken?.() ?? ''
  res.json({ csrfToken: token })
})

app.get('/api/health', (_req, res)=>res.json({ ok: true }))

app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => { console.log(`[api] listening on :${PORT}`) })