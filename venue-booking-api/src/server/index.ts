import express, { type Request, type Response, type NextFunction, Router } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import session from 'express-session'

// ------------------------
// Basic app bootstrap
// ------------------------
const app = express()

// Parse CORS_ORIGIN as comma‑separated list; fallback to true (allow any) for local dev
const corsOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors({
  origin: corsOrigins.length > 0 ? corsOrigins : true,
  credentials: true,
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// ------------------------
// Session (non‑blocking, Redis optional)
// ------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-temp-secret-change-me'

// Use MemoryStore by default to avoid boot blocking. If you later wire Redis, do it in the routers, not here.
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 4, // 4h
  },
}))

// ------------------------
// Health endpoints — MUST be fast and DB‑agnostic
// ------------------------
app.get('/healthz', (_req: Request, res: Response) => {
  // Keep it ultra simple: return 200 immediately. Do NOT touch DB/Redis here.
  res.status(200).send('ok')
})

// Optional: simple ping for manual tests
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() })
})

// ------------------------
// Lazy‑mount routers to avoid top‑level DB/Redis connects blocking boot
// ------------------------
function lazyMount(pathPrefix: string, loader: () => Promise<any>) {
  let cached: Router | null = null
  app.use(pathPrefix, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!cached) {
        const mod = await loader()
        // try common default export patterns
        cached = (mod?.default ?? mod?.router ?? mod) as Router
        if (typeof (cached as any) !== 'function') {
          throw new Error(`Lazy router at ${pathPrefix} did not export an express Router`)
        }
      }
      return (cached as any)(req, res, next)
    } catch (err) {
      next(err)
    }
  })
}

// Adjust the import paths to match your project structure
// If these files don’t exist, you can remove or change the lines below.
lazyMount('/api/admin', () => import('./routes/admin'))
lazyMount('/api/bookings', () => import('./routes/bookings'))

// ------------------------
// Error handler (keep last)
// ------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Uncaught error:', err)
  const status = typeof err?.status === 'number' ? err.status : 500
  res.status(status).json({ error: { message: err?.message ?? 'Internal Server Error' } })
})

// ------------------------
// Start server — MUST bind to 0.0.0.0 and use $PORT (Render gives 10000)
// ------------------------
const port = Number(process.env.PORT) || 10000
const host = '0.0.0.0'
app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`)
})
