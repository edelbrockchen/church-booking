// venue-booking-api/src/server/migrate.ts
import { makePool } from './db'

async function main() {
  const pool = makePool()
  if (!pool) { console.log('[migrate] skipped (no DATABASE_URL)'); return }
  const c = await pool.connect()
  try {
    await c.query('BEGIN')

    await c.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

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
      );
    `);

    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS venue TEXT;`);
    await c.query(`UPDATE bookings SET venue = COALESCE(venue, '大會堂');`);
    await c.query(`ALTER TABLE bookings ALTER COLUMN venue SET NOT NULL;`);

    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`);
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by TEXT;`);
    await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);

    await c.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
          ALTER TABLE bookings
            ADD CONSTRAINT bookings_no_overlap
            EXCLUDE USING gist (
              venue WITH =,
              tstzrange(start_ts, end_ts, '[]') WITH &&
            );
        END IF;
      END$$;
    `);

    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ip TEXT,
        user_agent TEXT
      );
    `);

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