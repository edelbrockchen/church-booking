// src/server/routes/bookings.ts
import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { makePool } from '../db'

const router = Router()
const pool = makePool()

// ---------------------------
// Helpers: TW time checks without extra libs
// ---------------------------
function getTWParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short'
  })
  const parts = fmt.formatToParts(d)
  const byType: Record<string,string> = {}
  parts.forEach(p => { if (p.type !== 'literal') byType[p.type] = p.value })
  const hour = Number(byType.hour)
  const minute = Number(byType.minute)
  // weekday: 週一..週日（短字），我們轉成 0..6（0=Sun）
  const wkStr = byType.weekday
  const wk = wkStr.includes('日') ? 0 : wkStr.includes('一') ? 1 : wkStr.includes('二') ? 2 : wkStr.includes('三') ? 3 : wkStr.includes('四') ? 4 : wkStr.includes('五') ? 5 : 6
  return { hour, minute, wk }
}

function ruleCheckTW(start: Date): { ok: boolean; reason?: string } {
  const { hour, minute, wk } = getTWParts(start)
  // 週日禁用
  if (wk === 0) return { ok: false, reason: '週日不開放借用' }
  // 最早 07:00
  if (hour < 7) return { ok: false, reason: '最早可申請 07:00' }
  // 最晚結束時間：週一/週三 18:00，其它日 21:30
  // 申請單固定 3 小時，因此檢查「start + 3h」不得超過上限
  const endHour = hour + 3
  const endMinute = minute
  const limit = (wk === 1 || wk === 3) ? { h: 18, m: 0 } : { h: 21, m: 30 }
  if (endHour > limit.h || (endHour === limit.h && endMinute > limit.m)) {
    return { ok: false, reason: `該日最晚結束 ${String(limit.h).padStart(2,'0')}:${String(limit.m).padStart(2,'0')}` }
  }
  return { ok: true }
}

// ---------------------------
// Schema：前端只需要送 start，其他欄位照需求擴充
// ---------------------------
const CreateBody = z.object({
  start: z.string().datetime().or(z.string().min(10)), // ISO 文字；伺服器會轉 Date
  applicantName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  venue: z.enum(['大會堂','康樂廳','其它教室']),
  category: z.string().min(1),
  note: z.string().optional().default(''),
})

// ---------------------------
// POST /api/bookings  建立申請單：僅接受 start，伺服器自動 end = start + 3h
// ---------------------------
router.post('/', async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body' })

  const { start, applicantName, email, phone, venue, category, note } = parsed.data
  const startDate = new Date(start)
  if (Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'invalid_start' })

  // 規則檢查（台北時區）
  const rule = ruleCheckTW(startDate)
  if (!rule.ok) return res.status(400).json({ error: 'rule_violation', reason: rule.reason })

  const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 重疊檢查：同一場地不得重疊
    const overlapSQL = `
      SELECT 1 FROM bookings
      WHERE venue = $1
        AND tstzrange(start_ts, end_ts, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
      LIMIT 1
    `
    const ov = await client.query(overlapSQL, [venue, startDate.toISOString(), endDate.toISOString()])
    if (ov.rowCount > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'overlap' })
    }

    const id = randomUUID()
    const insertSQL = `
      INSERT INTO bookings (id, start_ts, end_ts, created_by, status, category, venue, note)
      VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
    `
    await client.query(insertSQL, [
      id,
      startDate.toISOString(),
      endDate.toISOString(),
      applicantName, // created_by 放申請者姓名
      category,
      venue,
      `${note ?? ''}\nEmail: ${email}\nPhone: ${phone}`.trim(),
    ])

    await client.query('COMMIT')
    res.status(201).json({ id, start_ts: startDate.toISOString(), end_ts: endDate.toISOString() })
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('[bookings] create error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

// （可選）取得某段期間的清單，供行事曆顯示
router.get('/list', async (req, res) => {
  const days = Math.max(1, Math.min(180, Number(req.query.days ?? 60)))
  const client = await pool.connect()
  try {
    const sql = `
      SELECT id, start_ts, end_ts, status, category, venue, note
      FROM bookings
      WHERE start_ts >= (now() - ($1::text || ' days')::interval)
      ORDER BY start_ts ASC
      LIMIT 1000
    `
    const { rows } = await client.query(sql, [days])
    res.json({ items: rows })
  } catch (err) {
    console.error('[bookings] list error:', err)
    res.status(500).json({ error: 'internal_error' })
  } finally {
    client.release()
  }
})

export default router
