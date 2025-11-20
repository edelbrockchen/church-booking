// src/server/routes/terms.ts
import { Router, type Request, type Response } from 'express'

const router = Router()

// Cookie 名稱（前端不需要讀取，僅由後端判斷）
const TERMS_COOKIE = 'vb_terms'
const TERMS_AT_COOKIE = 'vb_terms_at'

// 小工具：從 Cookie 判斷是否已同意
function isAccepted(req: Request) {
  try {
    return req.cookies?.[TERMS_COOKIE] === '1'
  } catch {
    return false
  }
}

/**
 * GET /api/terms/status
 * 回傳：
 * { enabled: true, accepted: boolean, updatedAt: string }
 */
router.get('/status', (req: Request, res: Response) => {
  const accepted = isAccepted(req)
  const updatedAt =
    (req.cookies?.[TERMS_AT_COOKIE] as string | undefined) ??
    new Date(0).toISOString()

  res.json({
    enabled: true,      // 若未來要關閉同意門檻，可改為 false
    accepted,
    updatedAt,
  })
})

/**
 * POST /api/terms/accept
 * 設定同意 Cookie（一年）
 * 前端不需要讀 Cookie；之後呼叫 /status 就能看到 accepted=true
 */
router.post('/accept', (req: Request, res: Response) => {
  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  const nowIso = new Date().toISOString()

  // 設定 Cookie（建議 httpOnly + SameSite=None + secure=true 以支援跨網域）
  res.cookie(TERMS_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: oneYearMs,
    path: '/',
  })
  res.cookie(TERMS_AT_COOKIE, nowIso, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: oneYearMs,
    path: '/',
  })

  res.json({ ok: true })
})

export default router
