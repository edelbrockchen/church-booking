// 建立：status 預設 pending
await c.query(
  `INSERT INTO bookings (id,start_ts,end_ts,created_by,status)
   VALUES ($1,$2,$3,$4,'pending')`,
  [id, start.toISOString(), end.toISOString(), null]
);

// 取得「已核准」清單（給行事曆或前端公開檢視）
bookingsRouter.get('/approved', async (_req, res) => {
  if(!pool) return res.json({ items: [] });
  const { rows } = await pool.query(`
    SELECT id, start_ts, end_ts, created_at, created_by
    FROM bookings
    WHERE status = 'approved'
    ORDER BY start_ts ASC
  `);
  res.json({ items: rows });
});