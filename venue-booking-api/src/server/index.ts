import 'dotenv/config'
import express from 'express'
import session from 'express-session'
import Redis from 'ioredis'
import connectRedis from 'connect-redis'
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
  const RedisStore = connectRedis(session)
  const redis = new Redis(process.env.REDIS_URL)
  sessionMiddleware = session({
    store: new RedisStore({ client: redis as any }),
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
app.get('/api/csrf', csrfProtection, (req, res) => { res.json({ csrfToken: req.csrfToken() }) })

app.get('/api/health', (_req, res)=>res.json({ ok: true }))

app.use('/api/bookings', bookingsRouter)
app.use('/api/admin', adminRouter)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => { console.log(`[api] listening on :${PORT}`) })