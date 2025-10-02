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

    // 1) extension
    await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist;')

    // 3) terms_acceptances（記錄同意條款）
    await c.query(`
      CREATE TABLE IF NOT EXISTS terms_acceptances (
        user_id     VARCHAR(100) PRIMARY KEY,
        accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)


    // 2) bookings 表（含完整欄位）
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

    // 3) bookings 欄位補強（可重複執行）
    await c.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';")
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS category TEXT;')
    await c.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS note TEXT;')

    // 4) bookings 不允許時間重疊
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

    // 5) terms_accept 表（記錄誰同意規範）
    await c.query(
      [
        'CREATE TABLE IF NOT EXISTS terms_accept (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  user_id TEXT NOT NULL,',
        '  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()',
        ');'
      ].join('\n')
    )

    // 6) session 表（給 connect-pg-simple 使用）
    await c.query(
      [
        'CREATE TABLE IF NOT EXISTS "session" (',
        '  sid varchar NOT NULL COLLATE "default",',
        '  sess json NOT NULL,',
        '  expire timestamp(6) NOT NULL',
        ');',
        'ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");'
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