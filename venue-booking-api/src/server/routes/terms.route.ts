// venue-booking-api/src/server/routes/terms.route.ts
import { Router, type Request, type Response } from 'express'
import type { Pool } from 'pg'

export function createTermsRouter(pool: Pool) {
  const r = Router()

  // 依你實際的 session 結構調整
  function getUserId(req: Request): string | null {
    return (req as any).session?.user?.id ?? null
  }

  // 取得是否已同意
  r.get('/status', async (req: Request, res: Response) => {
    const userId = getUserId(req)
    if (!userId) {
      // 未登入視為未同意（避免暴露任何狀態）
      return res.json({ accepted: false })
    }

    const c = await pool.connect()
    try {
      const q = await c.query(
        'SELECT 1 FROM terms_acceptances WHERE user_id = $1 LIMIT 1',
        [userId]
      )
      return res.json({ accepted: q.rowCount > 0 })
    } catch (e) {
      console.error('[terms][status] db error:', e)
      return res.status(500).json({ error: 'server_error' })
    } finally {
      c.release()
    }
  })

  // 同意條款（建立或更新紀錄）
  r.post('/accept', async (req: Request, res: Response) => {
    const userId = getUserId(req)
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    const c = await pool.connect()
    try {
      await c.query(
        `
        INSERT INTO terms_acceptances (user_id)
        VALUES ($1)
        ON CONFLICT (user_id)
        DO UPDATE SET accepted_at = now(), version = 'v1'
        `,
        [userId]
      )
      return res.json({ ok: true })
    } catch (e) {
      console.error('[terms][accept] db error:', e)
      return res.status(500).json({ error: 'server_error' })
    } finally {
      c.release()
    }
  })

  return r
}