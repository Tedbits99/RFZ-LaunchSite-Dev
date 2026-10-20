import postgres from 'postgres'

// Local development, migration inspection, and explicitly approved administrative
// scripts only. Do not import this module from browser, Next.js route, Worker, or
// Edge Function code; privileged production access belongs in Supabase RPCs and
// Edge Functions.
let sql

export function getDb() {
  if (sql) return sql

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create the PostgreSQL client')
  }

  sql = postgres(connectionString)
  return sql
}

export async function closeDb() {
  if (!sql) return

  await sql.end({ timeout: 5 })
  sql = undefined
}

export default getDb
