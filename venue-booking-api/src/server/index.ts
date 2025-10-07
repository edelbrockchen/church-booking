// src/server/index.ts
import express from 'express'
import cors from 'cors'
import type { CorsOptions } from 'cors'
import session from 'express-session'
import cookieParser from 'cookie-parser'

// 路由
import bookingsRouter from './routes/bookings'
import termsRouter from './routes/terms.route'   // 你的檔名是 terms.route.ts
import { adminRouter } from './routes/admin'     // 命名匯入

const app = express()

/** 在 Proxy（Render、Cloudflare 等）後面務必開啟，讓 secure cookie 正常 */
app.set('trust proxy', 1)

/** CORS 允許的前端來源（用環境變數設定；可多個以逗號分隔） */
const rawOrigins =
  (process.env.CORS_ORIGINS || process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

// 本機開發的預設白名單（沒設環境變數時才會用）
const devFallbacks = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

const allowList = rawOrigins.length ? rawOrigins : devFallbacks

const corsOptions: CorsOptions = {
  // 注意：使用函式以便在預檢時回應正確的 Access-Control-Allow-Origin
  origin(origin, cb) {
    // 無 origin（同源或伺服器互叫）直接放行
    if (!origin) return cb(null, true)
    cb(null, allowList.includes(origin))
  },
  credentials: true, // 讓瀏覽器可以攜帶 / 接受 Cookie（跨網域必開）
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Idempotency-Key'],
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions)) // 預檢請求

app.use(cookieParser())
app.use(express.json())

/** Session 設定：跨網域一定要 SameSite=None + Secure */
app.use(
  session({
    name: process.env.SESSION_NAME || 'vb.sid',
    secret: process.env.SESSION_SECRET || 'please-change-me',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,     // 需跑在 HTTPS（Render 會是 HTTPS）
      sameSite: 'none', // 跨站必要
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
    },
  }),
)

/** 健康檢查（Render 健康檢查路徑可設 /api/health 或 /api/healthz） */
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/healthz', (_req, res) => res.json({ ok: true }))

/** 掛載路由 */
app.use('/api/admin', adminRouter)
app.use('/api', bookingsRouter)     // -> /api/bookings ... 等
app.use('/api/terms', termsRouter)  // -> /api/terms/status, /api/terms/accept

/** 簡單錯誤處理 */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err)
  res.status(500).json({ error: 'server_error' })
})

/** 啟動 */
const PORT = Number(process.env.PORT) || 10000
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
  console.log(`[server] CORS allowlist: ${allowList.join(', ') || '(dev defaults)'}`)
})

export default app
