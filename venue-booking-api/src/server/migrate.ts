// src/server/migrate.ts
import { makePool } from './db'

async function main() {
  const pool = makePool()
  if (!pool) {
    console.log('[migrate] skipped (no DATABASE_URL)')
    return
  }

  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    // 1) extensions
    await c.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`)

    // 2) bookings table
    await c.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id          UUID PRIMARY KEY,
        start_ts    TIMESTAMPTZ NOT NULL,
        end_ts      TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by  VARCHAR(100),
        reviewed_at TIMESTAMPTZ,
        reviewed_by VARCHAR(100),
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        category    VARCHAR(50)  NOT NULL DEFAULT '其他',
        note        TEXT,
        venue       VARCHAR(50)  NOT NULL
      );
    `)

    // 3) terms_acceptances table
    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        user_id     VARCHAR(100) PRIMARY KEY,
        accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)

    // 4) helpful indexes
    await c.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_range
        ON bookings USING gist (tstzrange(start_ts, end_ts, '[)'));
    `)
    await c.query(\`
      CREATE INDEX IF NOT EXISTS idx_bookings_venue_range
        ON bookings USING gist (venue, tstzrange(start_ts, end_ts, '[)'));
    \`)
    await c.query(\`
      CREATE INDEX IF NOT EXISTS idx_bookings_created_at
        ON bookings (created_at DESC);
    \`)

    // 5) try to add overlap exclusion constraint (approved + 特定場地)
    await c.query(\`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap') THEN
          BEGIN
            ALTER TABLE bookings
              ADD CONSTRAINT no_overlap
              EXCLUDE USING gist (
                venue WITH =,
                tstzrange(start_ts, end_ts, '[)') WITH &&
              )
              WHERE (status = 'approved' AND venue IN ('大會堂','康樂廳'))
              DEFERRABLE INITIALLY IMMEDIATE;
          EXCEPTION WHEN others THEN
            RAISE NOTICE 'skip creating no_overlap due to existing rows: %', SQLERRM;
          END;
        END IF;
      END$$;
    \`)

    await c.query('COMMIT')
    console.log('[migrate] done')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[migrate] failed', e as any)
    process.exitCode = 1
  } finally {
    c.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
