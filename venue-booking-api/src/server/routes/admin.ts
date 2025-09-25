import { Router } from 'express'
import { makePool } from '../db'

export const adminRouter = Router()
const pool = makePool()

function requireAdmin(req: any, res: any, next: any){
  if(req.session?.isAdmin) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

adminRouter.post('/login', (req, res) => {
  const pass = String(req.body?.password || '')
  if(!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'admin_password_not_set' })
  if(pass === process.env.ADMIN_PASSWORD){
    req.session.isAdmin = true
    return res.json({ ok: true })
  }
  return res.status(401).json({ error: 'bad_password' })
})

adminRouter.post('/logout', (req, res)=>{ req.session?.destroy(()=>{}); res.json({ ok: true }) })

adminRouter.get('/bookings', requireAdmin, async (_req, res) => {
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`SELECT id,start_ts,end_ts,created_at,created_by FROM bookings ORDER BY start_ts ASC`)
  res.json({ items: rows })
})

adminRouter.delete('/bookings/:id', requireAdmin, async (req, res) => {
  if(!pool) return res.status(500).json({ error: 'no_database' })
  await pool.query(`DELETE FROM bookings WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})