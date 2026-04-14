import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '#/env'
import * as schema from '#/db/schemas'
import { instrumentPgPoolQueries } from '#/db/query-logger'
import { createServiceLogger } from '#/lib/logger'

export function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  })
  const logger = createServiceLogger('database')

  instrumentPgPoolQueries(pool, { logger })

  pool.on('error', (error) => {
    logger.error({
      message: 'PostgreSQL idle client error',
      error,
    })
  })

  return drizzle({ client: pool, schema })
}

export const db = createDb()
