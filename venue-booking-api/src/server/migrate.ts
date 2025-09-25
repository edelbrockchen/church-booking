await c.query('BEGIN');
await c.query('CREATE EXTENSION IF NOT EXISTS btree_gist;');

await c.query(`
  CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY,
    start_ts TIMESTAMPTZ NOT NULL,
    end_ts   TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | rejected
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    rejection_reason TEXT
  );
`);

-- 補欄位（舊表用）
await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';`);
await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`);
await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by TEXT;`);
await c.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejection_reason TEXT;`);

await c.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='no_overlap') THEN
      ALTER TABLE bookings
      ADD CONSTRAINT no_overlap EXCLUDE USING gist (
        tstzrange(start_ts, end_ts, '[)') WITH &&
      );
    END IF;
  END $$;
`);

await c.query('COMMIT');