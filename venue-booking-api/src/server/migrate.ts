// src/server/migrate.ts
import { makePool } from './db'

async function hasColumn(c: any, table: string, column: string) {
  const sql = `
    select 1
    from information_schema.columns
    where table_name = $1 and column_name = $2
    limit 1
  `
  const r = await c.query(sql, [table, column])
  return r.rowCount > 0
}

async function ensureExtensions(c: any) {
  await c.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`)
}

async function ensureBookings(c: any) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY,
      start_ts TIMESTAMPTZ NOT NULL,
      end_ts   TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT,
      status TEXT DEFAULT 'pending',
      category TEXT,
      note TEXT,
      venue TEXT NOT NULL DEFAULT '大會堂',
      reviewed_at TIMESTAMPTZ,
      reviewed_by TEXT
    );
  `)

  // 你如果有 no_overlap 約束可在這裡補上（有權限時）：
  // await c.query(`
  //   DO $$
  //   BEGIN
  //     IF NOT EXISTS (
  //       SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap'
  //     ) THEN
  //       ALTER TABLE bookings
  //       ADD CONSTRAINT no_overlap EXCLUDE USING gist (
  //         venue WITH =,
  //         tstzrange(start_ts, end_ts) WITH &&
  //       );
  //     END IF;
  //   END $$;
  // `)
}

async function ensureTermsAcceptances(c: any) {
  // 1) 若沒有表就建
  await c.query(`
    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id UUID PRIMARY KEY,
      user_id TEXT,
      user_email TEXT,
      accepted_at TIMESTAMPTZ, -- 允許先為空，後面再補預設
      ip TEXT
    );
  `)

  // 2) 兼容舊欄位：如果存在 boolean 的 "accepted" 欄位，把它轉到 accepted_at，然後移除
  const hasAccepted = await hasColumn(c, 'terms_acceptances', 'accepted')
  const hasAcceptedAt = await hasColumn(c, 'terms_acceptances', 'accepted_at')

  if (hasAccepted && !hasAcceptedAt) {
    await c.query(`ALTER TABLE terms_acceptances ADD COLUMN accepted_at TIMESTAMPTZ;`)
  }
  if (hasAccepted) {
    // 將 accepted=true 的資料補上時間（沒有的就用現在）
    await c.query(`
      UPDATE terms_acceptances
      SET accepted_at = COALESCE(accepted_at, now())
      WHERE accepted = TRUE;
    `)
    // 刪除舊欄位
    await c.query(`ALTER TABLE terms_acceptances DROP COLUMN accepted;`)
  }

  // 3) 補上 not null + 預設
  await c.query(`
    ALTER TABLE terms_acceptances
    ALTER COLUMN accepted_at SET DEFAULT now();
  `)
  await c.query(`
    UPDATE terms_acceptances
    SET accepted_at = now()
    WHERE accepted_at IS NULL;
  `)
  await c.query(`
    ALTER TABLE terms_acceptances
    ALTER COLUMN accepted_at SET NOT NULL;
  `)
}

export default async function main() {
  const pool = makePool()
  if (!pool) {
    console.log('[migrate] skipped (no DATABASE_URL)')
    return
  }
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await ensureExtensions(c)
    await ensureBookings(c)
    await ensureTermsAcceptances(c)
    await c.query('COMMIT')
    console.log('[migrate] done')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[migrate] failed but will continue to start server:', e)
  } finally {
    c.release()
  }
}

// 讓它在啟動時自動執行（若你的 index.ts 會 import 這支檔案）
if (require.main === module) {
  main().catch((e) => {
    console.error('[migrate] fatal:', e)
    // 注意：即便失敗我們也不 throw，避免阻斷啟動；Render 只要健康檢查通過即可
  })
}
