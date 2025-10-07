// src/server/routes/terms.route.ts
import { Router, type Request } from 'express'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

const termsRouter = Router()
export default termsRouter

const pool = makePool()

// 可用環境變數控制條款開關/版本/連結（前端好判斷）
const TERMS_ENABLED = (process.env.TERMS_ENABLED ?? 'true').toLowerCase() === 'true'
const TERMS_VERSION = process.env.TERMS_VERSION ?? 'v1'
const TERMS_URL     = process.env.TERMS_URL ?? ''

function getUserId(req: Request): string | null {
  return (req as any).session?.user?.id ?? null
}

// 允許訪客同意條款（以 guest:<IP> 當 user_id），可用環境變數關閉
function effectiveUserId(req: Request): string | null {
  const uid = getUserId(req)
  if (uid) return uid
  const allowGuest = (process.env.ALLOW_GUEST_TERMS ?? 'true').toLowerCase() === 'true'
  if (!allowGuest) return null
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
  const ip = xff || (req.ip as string) || 'unknown'
  return `guest:${ip}`
}

/** 工具：檢查資料表/欄位並修復成我們要的結構 */
async function ensureSchema() {
  if (!pool) return
  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    // 建表（若不存在）
    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        id UUID PRIMARY KEY,
        user_id TEXT,
        user_email TEXT,
        accepted_at TIMESTAMPTZ,
        ip TEXT
      )
    `)

    // 若舊專案有 boolean 的 accepted 欄位 → 轉到 accepted_at 後移除
    const col = await c.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'terms_acceptances' AND column_name = 'accepted'
      LIMIT 1
    `)
    if (col.rowCount) {
      await c.query(`ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;`)
      await c.query(`UPDATE terms_acceptances SET accepted_at = COALESCE(accepted_at, now()) WHERE accepted = TRUE;`)
      await c.query(`ALTER TABLE terms_acceptances DROP COLUMN accepted;`)
    }

    // 補預設值並清除 NULL
    await c.query(`ALTER TABLE terms_acceptances ALTER COLUMN accepted_at SET DEFAULT now();`)
    await c.query(`UPDATE terms_acceptances SET accepted_at = now() WHERE accepted_at IS NULL;`)

    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[terms] ensureSchema failed:', e)
    // 不中斷；路由會以 fallback 方式回應
  } finally {
    c.release()
  }
}

/** GET /api/terms/status -> { ok, enabled, version, url, accepted, accepted_at } */
termsRouter.get('/status', async (req, res) => {
  const uid = effectiveUserId(req)
  // 若不允許訪客且未登入，或整體關閉，直接回未同意
  if (!TERMS_ENABLED) {
    return res.json({ ok: true, enabled: false, version: TERMS_VERSION, url: TERMS_URL || null, accepted: true, accepted_at: null })
  }
  if (!uid) {
    return res.json({ ok: true, enabled: true, version: TERMS_VERSION, url: TERMS_URL || null, accepted: false, accepted_at: null })
  }

  // 沒有 DB：直接回「已同意」（避免前端流程卡住），沿用你原本的精神
  if (!pool) {
    return res.json({
      ok: true, enabled: true, version: TERMS_VERSION, url: TERMS_URL || null,
      accepted: true, accepted_at: new Date().toISOString()
    })
  }

  try {
    await ensureSchema()
    const r = await pool.query(
      `SELECT accepted_at FROM terms_acceptances WHERE user_id = $1 LIMIT 1`,
      [uid]
    )
    if (r.rowCount && r.rows[0]?.accepted_at) {
      return res.json({
        ok: true, enabled: true, version: TERMS_VERSION, url: TERMS_URL || null,
        accepted: true, accepted_at: r.rows[0].accepted_at
      })
    }
    return res.json({ ok: true, enabled: true, version: TERMS_VERSION, url: TERMS_URL || null, accepted: false, accepted_at: null })
  } catch (e) {
    console.error('[terms] status failed:', (e as any)?.code, (e as any)?.message)
    // 安全回覆（避免前端陷入 500）：視為尚未同意
    return res.json({ ok: true, enabled: true, version: TERMS_VERSION, url: TERMS_URL || null, accepted: false, accepted_at: null })
  }
})

/** POST /api/terms/accept -> { ok: true, accepted_at } */
termsRouter.post('/accept', async (req, res) => {
  if (!TERMS_ENABLED) return res.json({ ok: true, accepted_at: null })
  const uid = effectiveUserId(req)
  if (!uid) return res.status(401).json({ error: 'unauthorized' })

  const email = (req.body?.email as string | undefined) || null
  const nowIso = new Date().toISOString()

  // 沒有 DB：直接回成功
  if (!pool) return res.json({ ok: true, accepted_at: nowIso })

  const c = await pool.connect()
  try {
    await ensureSchema()
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
      const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      const ip = xff || (req.ip as string) || null
      await c.query(
        `INSERT INTO terms_acceptances (id, user_id, user_email, accepted_at, ip)
         VALUES ($1, $2, $3, now(), $4)`,
        [randomUUID(), uid, email, ip]
      )
    }

    await c.query('COMMIT')
    return res.json({ ok: true, accepted_at: nowIso })
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[terms] accept failed:', (e as any)?.code, (e as any)?.message)
    // 安全回覆：即使 DB 出錯，也不讓前端壞掉
    return res.json({ ok: true, accepted_at: nowIso })
  } finally {
    c.release()
  }
})
