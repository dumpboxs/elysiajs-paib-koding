import type { Pool, QueryConfig, QueryResult, QueryResultRow } from 'pg'

import { env } from '#/env'
import {
  createServiceLogger,
  type AppLogger,
} from '#/lib/logger/index'
import {
  parseSensitiveFieldConfig,
  sanitizeForLogging,
} from '#/lib/logger/redaction'

type QueryLoggerOptions = {
  logger?: AppLogger
  logQueries?: boolean
  sensitiveFields?: string[]
  slowQueryThresholdMs?: number
}

const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 500

const getQueryText = (input: string | QueryConfig<unknown[]>) =>
  typeof input === 'string' ? input : input.text

const getQueryValues = (
  input: string | QueryConfig<unknown[]>,
  values: unknown[] | undefined
) => (typeof input === 'string' ? values : input.values)

const redactQueryParamsIfNeeded = (
  queryText: string,
  queryValues: unknown[] | undefined,
  sensitiveFields: string[]
) => {
  if (!queryValues) return []

  const normalizedQuery = queryText.toLowerCase()
  const shouldRedact = sensitiveFields.some((field) =>
    normalizedQuery.includes(field.toLowerCase())
  )

  if (shouldRedact) {
    return queryValues.map(() => '[REDACTED]')
  }

  return sanitizeForLogging(queryValues, sensitiveFields)
}

export const instrumentPgPoolQueries = (
  pool: Pool,
  options: QueryLoggerOptions = {}
) => {
  const logger = (options.logger ?? createServiceLogger('database')).child(
    'database'
  )
  const sensitiveFields =
    options.sensitiveFields ??
    parseSensitiveFieldConfig(env.LOG_SENSITIVE_FIELDS)
  const logQueries = options.logQueries ?? env.LOG_INCLUDE_DB_QUERIES
  const slowQueryThresholdMs =
    options.slowQueryThresholdMs ?? DEFAULT_SLOW_QUERY_THRESHOLD_MS

  const originalQuery = pool.query.bind(pool)

  pool.query = (async <T extends QueryResultRow>(
    input: string | QueryConfig<unknown[]>,
    values?: unknown[]
  ): Promise<QueryResult<T>> => {
    const startedAt = performance.now()
    const queryText = getQueryText(input)
    const queryValues = getQueryValues(input, values)

    try {
      const result = await originalQuery<T>(input as never, values as never)
      const duration = performance.now() - startedAt

      if (logQueries) {
        logger.debug({
          message: 'Database Query Executed',
          metadata: {
            query: queryText,
            params: redactQueryParamsIfNeeded(
              queryText,
              queryValues,
              sensitiveFields
            ),
            duration: Math.round(duration),
            rowsAffected: result.rowCount ?? 0,
          },
          duration,
        })
      }

      if (duration > slowQueryThresholdMs) {
        logger.warn({
          message: 'Slow database query detected',
          metadata: {
            query: queryText,
            duration: Math.round(duration),
            rowsAffected: result.rowCount ?? 0,
          },
          duration,
        })
      }

      return result
    } catch (error) {
      const duration = performance.now() - startedAt

      logger.error({
        message: 'Database query failed',
        metadata: {
          query: queryText,
          params: redactQueryParamsIfNeeded(
            queryText,
            queryValues,
            sensitiveFields
          ),
          duration: Math.round(duration),
        },
        error,
        duration,
      })

      throw error
    }
  }) as Pool['query']

  return pool
}
