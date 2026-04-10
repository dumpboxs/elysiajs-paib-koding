import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '#/env'
import * as schema from '#/db/schemas'

export function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  })

  pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL idle client error', error)
  })

  return drizzle({ client: pool, schema })
}

export const db = createDb()
