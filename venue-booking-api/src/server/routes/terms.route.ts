// src/server/routes/terms.ts
import { Router } from 'express'

// 將是否已同意條款存進 Session
declare module 'express-session' {
  interface SessionData {
    termsAccepted?: boolean
  }
}

const router = Router()

// 前端會輪詢這支；保持快速、不要碰 DB
router.get('/status', (req, res) => {
  res.json({ enabled: true, accepted: !!req.session?.termsAccepted, updatedAt: new Date().toISOString() })
})

// 使用者（或管理者）同意條款
router.post('/accept', (req, res) => {
  if (req.session) req.session.termsAccepted = true
  res.json({ ok: true })
})

export default router
