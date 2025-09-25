import { Pool } from 'pg'

export function makePool(){
  const url = process.env.DATABASE_URL
  if(!url){ console.warn('[db] DATABASE_URL not set. Using in-memory only.'); return null }
  return new Pool({ connectionString: url, max: 5 })
}

export type BookingRow = {
  id: string
  start_ts: string
  end_ts: string
  created_at: string
  created_by: string | null
}