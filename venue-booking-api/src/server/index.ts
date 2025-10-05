// src/server/index.ts
import express from 'express'
import session from 'express-session'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import bodyParser from 'body-parser'
import { adminRouter } from './routes/admin'

const app = express()

// Read envs
const ORIGIN = process.env.CORS_ORIGIN || '*'
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret'

// Render/Proxies: trust the proxy so 'secure' cookies work when HTTPS is terminated upstream
app.set('trust proxy', 1)

app.use(cors({
  origin: ORIGIN,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Requested-With']
}))

app.use(cookieParser())
app.use(bodyParser.json())

// Sessions: cookie must be SameSite=None + Secure for cross-site front-end (separate domains)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}))

// Routes
app.use('/api/admin', adminRouter)

app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})