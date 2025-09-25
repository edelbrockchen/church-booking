import { Router } from 'express'
import { z } from 'zod'
import { makePool } from '../db'
import { randomUUID } from 'node:crypto'

export const bookingsRouter = Router()
const pool = makePool()

const schema = z.object({ start: z.string().datetime() })

function addHours(d: Date, h: number){ return new Date(d.getTime()+h*3600_000) }
function isSunday(d: Date){ return d.getDay()===0 }
function latestEnd(d: Date){ const day = d.getDay(); return (day===1||day===3)?{hour:18,minute:0}:{hour:21,minute:30} }

bookingsRouter.post('/', async (req, res) => {
  const p = schema.safeParse(req.body)
  if(!p.success) return res.status(400).json({ error: 'invalid payload', details: p.error.issues })

  const start = new Date(p.data.start)
  if(isNaN(start.getTime())) return res.status(400).json({ error: 'invalid start' })
  if(isSunday(start)) return res.status(400).json({ error: 'sunday disabled' })

  const targetEnd = addHours(start, 3)
  const latest = latestEnd(start)
  const cap = new Date(start); cap.setHours(latest.hour, latest.minute, 0, 0)
  const end = targetEnd.getTime() > cap.getTime() ? cap : targetEnd
  const truncated = end.getTime() < targetEnd.getTime()

  if(!pool){
    return res.status(201).json({ id:'demo-'+Math.random().toString(36).slice(2), start:start.toISOString(), end:end.toISOString(), truncated, persisted:false })
  }

  const c = await pool.connect()
  try{
    await c.query('BEGIN')
    const rows = (await c.query(
      `SELECT 1 FROM bookings
       WHERE tstzrange(start_ts,end_ts,'[)') && tstzrange($1::timestamptz,$2::timestamptz,'[)') LIMIT 1`,
      [start.toISOString(), end.toISOString()]
    )).rows
    if(rows.length>0){ await c.query('ROLLBACK'); return res.status(409).json({ error:'overlap' }) }

    const id = randomUUID()
    await c.query(`INSERT INTO bookings (id,start_ts,end_ts,created_by) VALUES ($1,$2,$3,$4)`,
      [id, start.toISOString(), end.toISOString(), null])
    await c.query('COMMIT')
    return res.status(201).json({ id, start:start.toISOString(), end:end.toISOString(), truncated, persisted:true })
  } catch(e){
    await c.query('ROLLBACK')
    // @ts-ignore
    if(e?.constraint==='no_overlap') return res.status(409).json({ error:'overlap' })
    console.error('[bookings] failed', e)
    return res.status(500).json({ error:'server_error' })
  } finally { c.release() }
})

bookingsRouter.get('/', async (_req, res) => {
  if(!pool) return res.json({ items: [] })
  const { rows } = await pool.query(`SELECT id,start_ts,end_ts,created_at,created_by FROM bookings ORDER BY start_ts ASC`)
  res.json({ items: rows })
})