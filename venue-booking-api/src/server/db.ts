// venue-booking-api/src/server/db.ts
import { Pool } from 'pg'

let pool: Pool | null = null

export function makePool(): Pool | null {
  if (pool) return pool

  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('[db] DATABASE_URL not set → skip DB pool')
    return null
  }

  // 安全解析，避免奇怪字串
  let u: URL
  try {
    u = new URL(url)
  } catch (e) {
    console.error('[db] Invalid DATABASE_URL format:', e)
    return null
  }

  // 快速顯示目標（隱去帳密）
  const safeHost = u.hostname
  const safeDb = u.pathname?.replace(/^\//, '') || '(none)'
  console.log(`[db] connecting to host=${safeHost} db=${safeDb} ssl=${u.search?.includes('sslmode=require') ? 'require' : 'default'}`)

  // 建 pool
  pool = new Pool({
    connectionString: url,
    // 多數雲端 Postgres 需要 SSL；Neon 也建議啟用
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // 試探性連一次（可抓早期錯誤）
  pool.connect()
    .then(c => c.release())
    .catch(err => {
      console.error('[db] initial connect failed:', err?.message || err)
    })

  return pool
}