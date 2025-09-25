import { Router } from 'express'
import { makePool } from '../db'
import bcrypt from 'bcryptjs'

export const adminRouter = Router()
const pool = makePool()

type Cred = { user: string; pass?: string; hash?: string }

function loadCreds(): Cred[] {
  const raw = process.env.ADMIN_CREDENTIALS_JSON
  if (raw) {
    try {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) {
        // 只接受有 user 欄位的物件
        return list.filter((x: any) => x && typeof x.user === 'string')
      }
    } catch (e) {
      console.error('[admin] ADMIN_CREDENTIALS_JSON parse error:', e)
    }
  }
  // Fallback（不建議）：若未設定 JSON，就退回單一帳密
  const u = process.env.ADMIN_USER
  const p = process.env.ADMIN_PASSWORD
  if (u && p) return [{ user: u, pass: p }]
  return []
}

async function verify(plain: string, cred: Cred): Promise<boolean> {
  // 優先使用雜湊驗證（建議）
  if (cred.hash) {
    try { return await bcrypt.compare(plain, cred.hash) } catch { return false }
  }
  // 退回明文比對（僅為相容）
  if (cred.pass != null) return plain === cred.pass
  return false
}

function requireAdmin(req: any, res: any, next: any){
  if(req.session?.isAdmin) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

adminRouter.post('/login', async (req, res) => {
  const username = String(req.body?.username || '')
  const password = String(req.body?.password || '')

  const creds = loadCreds()
  if (creds.length === 0) {
    return res.status(500).json({ error: 'no_admin_credentials_configured' })
  }

  const cred = creds.find(c => c.user === username)
  if (!cred) return res.status(401).json({ error: 'bad_credentials' })

  const ok = await verify(password, cred)
  if (!ok) return res.status(401).json({ error: 'bad_credentials' })

  req.session.isAdmin = true
  req.session.adminUser = cred.user
  return res.json({ ok: true, user: cred.user })
})

adminRouter.post('/logout', (req, res)=>{ req.session?.destroy(()=>{}); res.json({ ok: true }) })

// 全部（或之後可加上分頁/查詢）
adminRouter.get('/bookings', requireAdmin, async (_req, res) => {
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id,start_ts,end_ts,created_at,created_by,status,reviewed_at,reviewed_by,rejection_reason
    FROM bookings
    ORDER BY start_ts ASC
  `)
  res.json({ items: rows })
})

// 近 60 天申請（審核頁用）
adminRouter.get('/review', requireAdmin, async (_req, res) => {
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by, status, reviewed_at, reviewed_by, rejection_reason
    FROM bookings
    WHERE start_ts >= now() - interval '60 days'
    ORDER BY created_at DESC
  `)
  res.json({ items: rows })
})

// 核准：可把 reviewed_by 記錄為 session.adminUser
adminRouter.post('/bookings/:id/approve', requireAdmin, async (req, res) => {
  if(!pool) return res.status(500).json({ error: 'no_database' })
  const reviewer = req.session?.adminUser || 'admin'
  await pool.query(`
    UPDATE bookings
    SET status='approved', reviewed_at=now(), reviewed_by=$2, rejection_reason=NULL
    WHERE id=$1
  `,[req.params.id, reviewer])
  res.json({ ok:true })
})

// 退件：同樣記錄 reviewer 與理由
adminRouter.post('/bookings/:id/reject', requireAdmin, async (req, res) => {
  if(!pool) return res.status(500).json({ error: 'no_database' })
  const reason = String(req.body?.reason || '')
  const reviewer = req.session?.adminUser || 'admin'
  await pool.query(`
    UPDATE bookings
    SET status='rejected', reviewed_at=now(), reviewed_by=$2, rejection_reason=$3
    WHERE id=$1
  `,[req.params.id, reviewer, reason])
  res.json({ ok:true })
})