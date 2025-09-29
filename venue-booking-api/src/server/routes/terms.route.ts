// src/server/routes/terms.route.ts
import { Router, type Request, type Response } from 'express'
import type { Pool } from 'pg'

export function createTermsRouter(pool: Pool) {
  const r = Router()

  // 是否允許 guest 同意條款（預設 true）
  const ALLOW_GUEST_TERMS =
    (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'

  // 依你實際 session 結構調整
  // ✅ 修復法 A：允許 guest:... 也當作有效使用者（可寫入 terms）
  function getUserId(req: Request): string | null {
    const u = (req as any).session?.user
    if (!u) return null
    if (!ALLOW_GUEST_TERMS && u.role === 'guest') return null
    return u.id
  }

  // 避免被快取
  function noStore(res: Response) {
    res.setHeader('Cache-Control', 'no-store')
  }

  // -- Schema 參考（請確認 DB 內已建立）
  // CREATE TABLE IF NOT EXISTS terms_acceptances (
  //   user_id     VARCHAR(100) PRIMARY KEY,
  //   accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  // );

  /** GET /api/terms/status：查詢是否已同意 */
  r.get('/status', async (req: Request, res: Response) => {
    noStore(res)

    const userId = getUserId(req)
    if (!userId) {
      // 沒有任何 session/user（理論上不會發生，保底）
      return res.status(200).json({
        accepted: false,
        acceptedAt: null,
        reason: 'unauthenticated',
      })
    }

    try {
      const { rows } = await pool.query<{ accepted_at: string }>(
        'SELECT accepted_at FROM terms_acceptances WHERE user_id = $1 LIMIT 1',
        [userId]
      )
      const accepted = rows.length > 0
      return res.json({
        accepted,
        acceptedAt: accepted ? rows[0].accepted_at : null,
      })
    } catch (e) {
      console.error('[terms][status] db error:', e)
      // 不中斷前端流程：標示 degraded，仍視為未同意
      return res.status(200).json({
        accepted: false,
        acceptedAt: null,
        degraded: true,
      })
    }
  })

  /** POST /api/terms/accept：同意條款（upsert） */
  r.post('/accept', async (req: Request, res: Response) => {
    noStore(res)

    const userId = getUserId(req)
    if (!userId) {
      return res.status(401).json({ message: 'Unauthenticated' })
    }

    try {
      const { rows } = await pool.query<{ accepted_at: string }>(
        `
        INSERT INTO terms_acceptances (user_id, accepted_at)
        VALUES ($1, now())
        ON CONFLICT (user_id)
        DO UPDATE SET accepted_at = EXCLUDED.accepted_at
        RETURNING accepted_at
        `,
        [userId]
      )
      return res.json({
        ok: true,
        accepted: true,
        acceptedAt: rows[0]?.accepted_at ?? null,
      })
    } catch (e) {
      console.error('[terms][accept] db error:', e)
      // 不中斷：讓前端可在 localStorage 做權宜標記
      return res.status(200).json({
        ok: true,
        accepted: true,
        acceptedAt: null,
        degraded: true,
      })
    }
  })

  return r
}