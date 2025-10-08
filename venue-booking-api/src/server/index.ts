// src/server/index.ts — fix 401 by enforcing Set-Cookie: SameSite=None; Secure; Partitioned (CHIPS)
// and proper CORS + session wiring.

import express from 'express'
import session from 'express-session'
import cors, { type CorsOptions } from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import adminRouter from './routes/admin'
import bookingsRouter from './routes/bookings'
import termsRouter from './routes/terms.route'

const app = express()

/* -------------------- basic middlewares -------------------- */
app.set('trust proxy', 1) // Render / 反代下需要，否則 secure cookie 可能被丟棄
app.use(express.json())
app.use(cookieParser())

/* --------------------------- CORS --------------------------- */
// 若前端把 /api 反代成同源，可設 FRONTEND_PROXY=1（就不走跨站 Cookie 流程）
const FRONTEND_PROXY = ['1','true','yes'].includes(String(process.env.FRONTEND_PROXY || process.env.VITE_USE_FRONTEND_PROXY || '0').toLowerCase())

// 允許的前端來源（逗號分隔）
const ORIGINS_RAW = String(process.env.CORS_ORIGIN || '').trim()
const ORIGIN_LIST = ORIGINS_RAW ? ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean) : []

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true)                // 同源或非瀏覽器工具
    if (ORIGIN_LIST.length === 0) return cb(null, true)
    if (ORIGIN_LIST.includes(origin)) return cb(null, true)
    return cb(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true, // **一定要**，否則瀏覽器不會帶 Cookie
}
app.use(cors(corsOptions))

/* -------------------------- session ------------------------- */
const IS_PROD = (process.env.NODE_ENV || 'production') === 'production'
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me'

// 同源走 Lax，跨站走 None
const sameSite: session.CookieOptions['sameSite'] = FRONTEND_PROXY ? 'lax' : 'none'

const cookieOptions: session.CookieOptions = {
  httpOnly: true,
  secure: IS_PROD,          // 線上必須 https
  sameSite,                  // 跨站時必須 'none'
  maxAge: 7 * 24 * 60 * 60 * 1000,
  // 注意：舊版 express-session 不會自動序列化 Partitioned；我們改在後續補標頭
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: process.env.SESSION_NAME || 'vb.sid',
  cookie: cookieOptions,
}))

/* ---- 關鍵：補強 Set-Cookie，確保帶上 Partitioned（CHIPS） ---- */
const WANT_PARTITIONED = !FRONTEND_PROXY &&
  ['1','true','yes'].includes(String(process.env.COOKIE_PARTITIONED || process.env.ENABLE_PARTITIONED_COOKIES || '1').toLowerCase())

app.use((req, res, next) => {
  // 只在跨站情境才補；同源（反代）不需要 Partitioned
  if (!WANT_PARTITIONED) return next()

  const setHeader = res.setHeader.bind(res)
  res.setHeader = (name: string, value: number | string | ReadonlyArray<string>) => {
    if (name.toLowerCase() !== 'set-cookie') return setHeader(name, value)
    const values = Array.isArray(value) ? [...value] : [String(value)]

    const patched = values.map(v => {
      let nv = v

      // 若沒 Secure，加上
      if (!/;\s*secure\b/i.test(nv)) nv += '; Secure'
      // 若沒 SameSite=None，加上（避免 SameSite=Lax/Strict 阻擋跨站）
      if (!/;\s*samesite=/i.test(nv)) {
        nv += '; SameSite=None'
      } else {
        nv = nv.replace(/;\s*samesite\s*=\s*Lax/ig, '; SameSite=None')
        nv = nv.replace(/;\s*samesite\s*=\s*Strict/ig, '; SameSite=None')
      }
      // 若沒 Partitioned，加上（Chrome CHIPS）
      if (!/;\s*partitioned\b/i.test(nv)) nv += '; Partitioned'
      return nv
    })

    return setHeader(name, patched as any)
  }

  next()
})

/* --------------------------- routes ------------------------- */
app.use('/api/admin', adminRouter)
app.use('/api', bookingsRouter)
app.use('/api/terms', termsRouter)

// （若有靜態檔）
app.use(express.static(path.join(process.cwd(), 'public')))

/* --------------------------- whoami ------------------------- */
app.get('/api/_whoami', (req, res) => {
  res.json({
    ok: true,
    user: (req.session as any)?.user || null,
    cookie: {
      sameSite,
      secure: IS_PROD,
      wantPartitioned: WANT_PARTITIONED,
      frontendProxy: FRONTEND_PROXY,
    }
  })
})

/* --------------------------- listen ------------------------- */
const PORT = Number(process.env.PORT || 3000)
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`)
})

export default app