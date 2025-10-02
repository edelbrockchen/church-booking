// venue-booking-api/src/server/migrate.ts
import { makePool } from './db'

async function main() {
  const pool = makePool()
  if (!pool) { console.log('[migrate] skipped (no DATABASE_URL)'); return }
  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    // extension：能裝就裝；沒權限不要讓整個服務掛掉
    await c.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='btree_gist') THEN
          BEGIN
            CREATE EXTENSION IF NOT EXISTS btree_gist;
          EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'no privilege to install btree_gist, skip';
          END;
        END IF;
      END$$;
    `)

    // bookings 主表
    await c.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id UUID PRIMARY KEY,
        start_ts TIMESTAMPTZ NOT NULL,
        end_ts   TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by TEXT,
        status TEXT DEFAULT 'pending',
        category TEXT,
        note TEXT
      )
    `)

    // 關鍵欄位：venue
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS venue TEXT`)
    await c.query(`UPDATE bookings SET venue = COALESCE(venue, '大會堂')`)
    await c.query(`ALTER TABLE bookings ALTER COLUMN venue SET NOT NULL`)

    // 審核欄位
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`)
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by TEXT`)
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason TEXT`)

    // 同場地時段重疊約束（僅在 extension 裝好時啟用）
    await c.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist') THEN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_no_overlap') THEN
            ALTER TABLE bookings
              ADD CONSTRAINT bookings_no_overlap
              EXCLUDE USING gist (
                venue WITH =,
                tstzrange(start_ts, end_ts, '[]') WITH &&
              );
          END IF;
        END IF;
      END$$;
    `)

    // 條款同意表（補齊 user_id / accepted_at）
    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ip TEXT,
        user_agent TEXT
      )
    `)
    await c.query(`ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS user_id TEXT`)
    await c.query(`ALTER TABLE terms_acceptances ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ`)
    await c.query(`UPDATE terms_acceptances SET accepted_at = COALESCE(accepted_at, created_at)`)
    await c.query(`UPDATE terms_acceptances SET user_id = COALESCE(user_id, 'guest:legacy') WHERE user_id IS NULL`)

    // session 表（connect-pg-simple 用；若你有 createTableIfMissing 也 OK，這裡保險再建一次）
    await c.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    varchar NOT NULL PRIMARY KEY,
        "sess"   json NOT NULL,
        "expire" timestamp(6) NOT NULL
      )
    `)
    await c.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`)

    await c.query('COMMIT')
    console.log('[migrate] done')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[migrate] failed:', e)
    throw e
  } finally {
    c.release()
  }
}

main().catch(() => process.exit(1))
