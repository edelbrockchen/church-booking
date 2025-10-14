// src/server/routes/terms.ts
import { Router } from 'express'

// 在 Session 中存放是否已同意的旗標
declare module 'express-session' {
  interface SessionData {
    termsAccepted?: boolean
  }
}

const router = Router()

// 提供前端輪詢目前條款狀態（可擴充從 DB 讀取）
router.get('/status', (req, res) => {
  res.json({ enabled: true, accepted: !!req.session?.termsAccepted, updatedAt: new Date().toISOString() })
})

// 使用者主動同意條款（例如在 TermsGate 勾選後呼叫）
router.post('/accept', (req, res) => {
  if (req.session) req.session.termsAccepted = true
  res.json({ ok: true })
})

export default router
