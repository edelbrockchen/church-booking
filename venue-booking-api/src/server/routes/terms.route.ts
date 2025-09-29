// venue-booking-api/src/server/routes/terms.route.ts
import { Router, type Request, type Response } from 'express'
import type { Pool } from 'pg'

export function createTermsRouter(pool: Pool) {
  const r = Router()

  // 依你實際的 session 結構調整
  function getUserId(req: Request): string | null {
    return (req as any).session?.user?.id ?? null
  }

  // 快取控制（避免 /status 被 cache）
  function noStore(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
  }

  // 目前同意記錄的資料表結構（請確認與 DB 一致）
  // CREATE TABLE IF NOT EXISTS terms_acceptances (
  //   user_id VARCHAR(100) PRIMARY KEY,
  //   accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  // );

  /** GET /api/terms/status：查詢是否已同意 */
  r.get('/status', async (req: Request, res: Response) => {
    noStore(res)

    const userId = getUserId(req)
    if (!userId) {
      // 未登入/無 userId → 視為未同意（讓前端出現彈窗）
      return res.json({ accepted: false })
    }

    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM terms_acceptances WHERE user_id = $1 LIMIT 1',
        [userId]
      )
      const accepted = (rows?.length ?? 0) > 0
      return res.json({ accepted })
    } catch (e) {
      console.error('[terms][status] db error:', e)
      // 容錯：不要 500 擋住 UI；回未同意即可
      return res.json({ accepted: false, degraded: true })
    }
  })

  /** POST /api/terms/accept：同意條款（upsert） */
  r.post('/accept', async (req: Request, res: Response) => {
    noStore(res)

    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    try {
      await pool.query(
        `
        INSERT INTO terms_acceptances (user_id)
        VALUES ($1)
        ON CONFLICT (user_id)
        DO UPDATE SET accepted_at = now()
        `,
        [userId]
      )
      return res.json({ ok: true, accepted: true })
    } catch (e) {
      console.error('[terms][accept] db error:', e)
      // 容錯：回 200 讓前端流程可繼續（前端已在 localStorage 標記）
      return res.json({ ok: true, accepted: true, degraded: true })
    }
  })

  return r
}