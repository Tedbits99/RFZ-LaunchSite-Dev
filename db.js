import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize the PostgreSQL client')
}

const sql = postgres(connectionString)

export default sql
