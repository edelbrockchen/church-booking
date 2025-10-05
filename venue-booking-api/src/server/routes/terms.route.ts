// src/server/routes/terms.route.ts
import { Router, type Request } from 'express'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

const termsRouter = Router()
export default termsRouter

const pool = makePool()

function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}

// 若沒有登入，也允許以 guest:<IP> 當作 user_id（可用環境變數關閉）
function effectiveUserId(req: Request): string | null {
  const uid = getUserId(req)
  if (uid) return uid
  const allowGuest = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'
  if (!allowGuest) return null
  const ip = (req.headers['x-forwarded-for'] as string) || (req.ip as string) || 'unknown'
  return `guest:${ip}`
}

/** GET /api/terms/status -> { accepted: boolean, accepted_at: string|null } */
termsRouter.get('/status', async (req, res) => {
  const uid = effectiveUserId(req)
  if (!uid) return res.json({ accepted: false, accepted_at: null })

  // 沒有資料庫時，直接當作已同意，避免前端卡住
  if (!pool) return res.json({ accepted: true, accepted_at: new Date().toISOString() })

  try {
    const r = await pool.query(
      `SELECT accepted_at FROM terms_acceptances WHERE user_id = $1 LIMIT 1`,
      [uid]
    )
    if (r.rowCount && r.rows[0]?.accepted_at) {
      return res.json({ accepted: true, accepted_at: r.rows[0].accepted_at })
    }
    return res.json({ accepted: false, accepted_at: null })
  } catch (e) {
    console.error('[terms] status failed', e)
    return res.json({ accepted: false, accepted_at: null })
  }
})

/** POST /api/terms/accept -> { ok: true, accepted_at: string } */
termsRouter.post('/accept', async (req, res) => {
  const uid = effectiveUserId(req)
  if (!uid) return res.status(401).json({ error: 'unauthorized' })

  const email = (req.body?.email as string | undefined) || null
  const nowIso = new Date().toISOString()

  // 沒有資料庫時，直接回成功
  if (!pool) return res.json({ ok: true, accepted_at: nowIso })

  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    const found = await c.query(
      `SELECT id FROM terms_acceptances WHERE user_id = $1 LIMIT 1`,
      [uid]
    )

    if (found.rowCount) {
      await c.query(
        `UPDATE terms_acceptances
           SET accepted_at = now(),
               user_email  = COALESCE($2, user_email)
         WHERE user_id = $1`,
        [uid, email]
      )
    } else {
      await c.query(
        `INSERT INTO terms_acceptances (id, user_id, user_email, accepted_at, ip)
         VALUES ($1, $2, $3, now(), $4)`,
        [randomUUID(), uid, email, (req.headers['x-forwarded-for'] as string) || req.ip || null]
      )
    }

    await c.query('COMMIT')
    return res.json({ ok: true, accepted_at: nowIso })
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[terms] accept failed', e)
    return res.status(500).json({ error: 'server_error' })
  } finally {
    c.release()
  }
})
