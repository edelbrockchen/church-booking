// venue-booking-api/src/server/index.ts
import express from 'express'
import cors, { CorsOptions } from 'cors'
import session from 'express-session'
import adminRouter from './routes/admin'

const app = express()

// ── Security/Proxy ──────────────────────────────────────────────────────────────
app.set('trust proxy', 1) // Render/Proxy aware for Secure cookies

// ── CORS ────────────────────────────────────────────────────────────────────────
const ORIGIN = (process.env.CORS_ORIGIN || '').trim() || 'https://venue-booking-frontend-a3ib.onrender.com'

const corsOptions: CorsOptions = {
  origin: ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// ── Parsers ─────────────────────────────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── Session ─────────────────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET || 'change-me'
app.use(
  session({
    name: 'vb.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,     // HTTPS only (Render is HTTPS)
      sameSite: 'none', // cross-site cookie for frontend<->backend different domains
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
)

// ── Healthcheck ─────────────────────────────────────────────────────────────────
app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

// ── API Routes ──────────────────────────────────────────────────────────────────
app.use('/api/admin', adminRouter)

// TODO: mount other routers here, e.g. bookings: app.use('/api/bookings', bookingsRouter)

// ── 404 ─────────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }))

export default app
