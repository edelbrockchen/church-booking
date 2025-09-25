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

    // 1) extension
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist;')

    // 2) table（新建時就含 created_by / category / note）
    await c.query(
      [
        'CREATE TABLE IF NOT EXISTS bookings (',
        '  id UUID PRIMARY KEY,',
        '  start_ts TIMESTAMPTZ NOT NULL,',
        '  end_ts   TIMESTAMPTZ NOT NULL,',
        '  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),',
        '  created_by TEXT,',
        "  status TEXT NOT NULL DEFAULT 'pending',",
        '  reviewed_at TIMESTAMPTZ,',
        '  reviewed_by TEXT,',
        '  rejection_reason TEXT,',
        '  category TEXT,',
        '  note TEXT',
        ');'
      ].join('\n')
    )

    // 3) columns（既有表補欄位：安全可重複執行）
    await c.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';")
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS category TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS note TEXT;')

    // 4) exclusion constraint（避免時間重疊）
    await c.query(
      [
        'DO $$',
        'BEGIN',
        "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap') THEN",
        '    ALTER TABLE bookings',
        "    ADD CONSTRAINT no_overlap EXCLUDE USING gist (",
        "      tstzrange(start_ts, end_ts, '[)') WITH &&",
        '    );',
        '  END IF;',
        'END',
        '$$;'
      ].join('\n')
    )

    await c.query('COMMIT')
    console.log('[migrate] done')
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('[migrate] failed', e)
    process.exitCode = 1
  } finally {
    c.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })