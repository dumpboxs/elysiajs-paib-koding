import { Writable } from 'node:stream'

import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import type { Pool } from 'pg'
import { z } from 'zod'

import { instrumentPgPoolQueries } from '#/db/query-logger'
import { enterRequestContext } from '#/lib/logger/context'
import { createLogger } from '#/lib/logger/index'
import { hashViewerIp } from '#/lib/viewer-ip'
import { createApiErrorPlugin } from '#/plugins/api-error.plugin'
import { createRequestLoggerPlugin } from '#/plugins/request-logger.plugin'

const waitForLogs = () => new Promise((resolve) => setTimeout(resolve, 20))

const createLogCapture = (format: 'json' | 'pretty' = 'json') => {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk))
      callback()
    },
  })

  const logger = createLogger({
    destination,
    enabled: true,
    format,
    level: 'trace',
  })

  return {
    logger,
    async flush() {
      await waitForLogs()
    },
    records() {
      return chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    },
    text() {
      return chunks.join('')
    },
  }
}

describe('logger infrastructure', () => {
  it('redacts sensitive data and propagates request context', async () => {
    const capture = createLogCapture()
    const logger = capture.logger.child('auth')

    enterRequestContext({
      requestId: 'req-redaction-test',
      startTime: 0,
      method: 'POST',
      path: '/auth/sign-in',
      url: 'http://localhost/auth/sign-in',
    })

    logger.info({
      message: 'Authentication payload received',
      metadata: {
        password: 'super-secret',
        nested: {
          authorization: 'Bearer token',
        },
      },
    })

    await capture.flush()

    const [record] = capture.records()
    expect(record).toBeDefined()
    expect((record!['context'] as Record<string, unknown>)['requestId']).toBe(
      'req-redaction-test'
    )
    expect(
      ((record!['metadata'] as Record<string, unknown>)['password'] as string)
    ).toBe('[REDACTED]')
    expect(
      (
        ((record!['metadata'] as Record<string, unknown>)['nested'] as Record<
          string,
          unknown
        >)['authorization'] as string
      )
    ).toBe('[REDACTED]')
  })

  it('filters messages below the configured log level', async () => {
    const chunks: string[] = []
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk))
        callback()
      },
    })
    const logger = createLogger({
      destination,
      enabled: true,
      format: 'json',
      level: 'warn',
    }).child('test')

    logger.info({
      message: 'This should be filtered',
    })
    logger.error({
      message: 'This should be logged',
    })

    await waitForLogs()

    const records = chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(records).toHaveLength(1)
    expect(records[0]?.['message']).toBe('This should be logged')
  })

  it('supports pretty formatted output for development logs', async () => {
    const capture = createLogCapture('pretty')

    capture.logger.child('pretty').info({
      message: 'Pretty formatted log',
    })

    await capture.flush()

    const text = capture.text()
    expect(text).toContain('Pretty formatted log')
    expect(text.trim().startsWith('{')).toBe(false)
  })

  it('logs request lifecycle and validation errors with a shared requestId', async () => {
    const capture = createLogCapture()
    const app = new Elysia()
      .use(
        createRequestLoggerPlugin({
          logger: capture.logger.child('http'),
        })
      )
      .use(
        createApiErrorPlugin({
          logger: capture.logger.child('apiError'),
        })
      )
      .post(
        '/posts',
        ({ body }) => body,
        {
          body: z.object({
            title: z.string().min(3),
          }),
        }
      )

    const response = await app.handle(
      new Request('http://localhost/posts?token=secret', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
          'x-forwarded-for': '203.0.113.10, 10.0.0.1',
          'x-request-id': 'req-request-logger',
        },
        body: JSON.stringify({
          title: 'a',
        }),
      })
    )

    await capture.flush()

    const records = capture.records()
    const requestStart = records.find(
      (record) => record['message'] === 'HTTP Request Started'
    )
    const apiError = records.find(
      (record) => record['message'] === 'API Error: VALIDATION'
    )
    const requestCompleted = records.find(
      (record) => record['message'] === 'HTTP Request Completed'
    )

    expect(response.status).toBe(422)
    expect(response.headers.get('x-request-id')).toBe('req-request-logger')
    expect(requestStart).toBeDefined()
    expect(apiError).toBeDefined()
    expect(requestCompleted).toBeDefined()
    expect(
      (requestStart?.['context'] as Record<string, unknown>)['requestId']
    ).toBe('req-request-logger')
    expect(
      ((requestStart?.['metadata'] as Record<string, unknown>)['headers'] as Record<
        string,
        unknown
      >)['authorization']
    ).toBe('[REDACTED]')
    expect(
      ((requestStart?.['metadata'] as Record<string, unknown>)['query'] as Record<
        string,
        unknown
      >)['token']
    ).toBe('[REDACTED]')
    expect(
      (requestStart?.['metadata'] as Record<string, unknown>)['clientIp']
    ).toBe(hashViewerIp('203.0.113.10'))
    expect(
      (
        (apiError?.['metadata'] as Record<string, unknown>)['validationErrors'] as Record<
          string,
          unknown
        >
      )['title']
    ).toBeDefined()
  })

  it('logs database queries, failures, and slow query warnings', async () => {
    const capture = createLogCapture()
    const fakePool = {
      query: async () => {
        await waitForLogs()
        return {
          rowCount: 1,
          rows: [{ id: 1 }],
        }
      },
    } as unknown as Pool

    instrumentPgPoolQueries(fakePool, {
      logger: capture.logger.child('database'),
      logQueries: true,
      slowQueryThresholdMs: 0,
      sensitiveFields: ['password'],
    })

    await fakePool.query('select * from users where password = $1', ['secret'])

    await capture.flush()

    const records = capture.records()
    const queryRecord = records.find(
      (record) => record['message'] === 'Database Query Executed'
    )
    const slowRecord = records.find(
      (record) => record['message'] === 'Slow database query detected'
    )

    expect(queryRecord).toBeDefined()
    expect(slowRecord).toBeDefined()
    expect(
      ((queryRecord?.['metadata'] as Record<string, unknown>)['params'] as string[])[0]
    ).toBe('[REDACTED]')
  })
})
