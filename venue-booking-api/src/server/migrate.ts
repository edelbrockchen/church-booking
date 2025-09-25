import { makePool } from './db'

async function main(){
  const pool = makePool()
  if(!pool){ console.log('[migrate] skipped (no DATABASE_URL)'); return }
  const c = await pool.connect()
  try{
    await c.query('BEGIN')
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist;')
    await c.query(`CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY,
      start_ts TIMESTAMPTZ NOT NULL,
      end_ts   TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by TEXT
    );`)
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='no_overlap') THEN
        ALTER TABLE bookings
        ADD CONSTRAINT no_overlap EXCLUDE USING gist (
          tstzrange(start_ts, end_ts, '[)') WITH &&
        );
      END IF;
    END $$;`)
    await c.query('COMMIT'); console.log('[migrate] done')
  } catch(e){
    await c.query('ROLLBACK'); console.error('[migrate] failed', e); process.exitCode = 1
  } finally {
    c.release(); await pool.end()
  }
}
main().catch(e=>{ console.error(e); process.exitCode = 1 })