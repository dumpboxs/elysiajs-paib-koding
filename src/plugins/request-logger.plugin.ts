import { Elysia } from 'elysia'

import { env } from '#/env'
import {
  enterRequestContext,
  getRequestContext,
  resolveRequestId,
} from '#/lib/logger/context'
import {
  createServiceLogger,
  type AppLogger,
} from '#/lib/logger/index'
import {
  parseSensitiveFieldConfig,
  redactHeaders,
  sanitizeForLogging,
} from '#/lib/logger/redaction'
import {
  estimatePayloadSize,
  toSerializableUrl,
} from '#/lib/logger/serialization'
import { hashViewerIp } from '#/lib/viewer-ip'

type CreateRequestLoggerPluginOptions = {
  logger?: AppLogger
  sensitiveFields?: string[]
}

const parseStatusCode = (value: unknown, fallback = 200) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return fallback
}

const getClientIp = (request: Request) => {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    const [first] = forwardedFor.split(',')
    if (first?.trim()) return first.trim()
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp?.trim()) return realIp.trim()

  return undefined
}

const getResponseStatus = (responseValue: unknown, setStatus: unknown) => {
  if (responseValue instanceof Response) return responseValue.status
  return parseStatusCode(setStatus, 200)
}

export const createRequestLoggerPlugin = (
  options: CreateRequestLoggerPluginOptions = {}
) => {
  const sensitiveFields =
    options.sensitiveFields ??
    parseSensitiveFieldConfig(env.LOG_SENSITIVE_FIELDS)
  const logger = (options.logger ?? createServiceLogger('http')).child('http')

  return new Elysia({ name: 'request-logger-plugin' })
    .onRequest(({ request, set }) => {
      const requestId = resolveRequestId(request.headers.get('x-request-id'))
      const requestUrl = toSerializableUrl(request.url)

      enterRequestContext({
        requestId,
        startTime: performance.now(),
        method: request.method,
        path: requestUrl.path,
        url: requestUrl.url,
      })

      set.headers['x-request-id'] = requestId

      logger.info({
        message: 'HTTP Request Started',
        context: {
          requestId,
        },
        metadata: {
          method: request.method,
          url: requestUrl.url,
          path: requestUrl.path,
          query: requestUrl.query,
          headers: redactHeaders(request.headers, sensitiveFields),
          clientIp: hashViewerIp(getClientIp(request) ?? ''),
          userAgent: request.headers.get('user-agent') ?? undefined,
        },
      })
    })
    .onBeforeHandle(({ body, request }) => {
      if (!env.LOG_INCLUDE_REQUEST_BODY || body == null) return

      logger.debug({
        message: 'HTTP Request Body',
        metadata: {
          method: request.method,
          path: new URL(request.url).pathname,
          body: sanitizeForLogging(body, sensitiveFields),
        },
      })
    })
    .mapResponse({ as: 'global' }, ({ request, response, set }) => {
      const requestContext = getRequestContext()
      const duration = requestContext
        ? performance.now() - requestContext.startTime
        : undefined
      const statusCode = getResponseStatus(response, set.status)
      const responseSize =
        estimatePayloadSize(response) ??
        estimatePayloadSize(response instanceof Response ? response.clone() : response)

      logger.info({
        message:
          statusCode >= 500 ? 'HTTP Request Failed' : 'HTTP Request Completed',
        metadata: {
          method: request.method,
          path: new URL(request.url).pathname,
          statusCode,
          responseSize,
          ...(env.LOG_INCLUDE_RESPONSE_BODY
            ? {
                responseBody: sanitizeForLogging(response, sensitiveFields),
              }
            : {}),
        },
        duration,
      })

      if (response instanceof Response) return response
    })
}

export const requestLoggerPlugin = createRequestLoggerPlugin()
