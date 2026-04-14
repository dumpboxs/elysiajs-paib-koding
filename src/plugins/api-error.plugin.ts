import { Elysia } from 'elysia'

import { getRequestContext } from '#/lib/logger/context'
import {
  createServiceLogger,
  type AppLogger,
} from '#/lib/logger/index'
import {
  createErrorResponse,
  isStandardErrorStatus,
  normalizeErrorResponse,
  toValidationErrorMap,
} from '#/schemas/api-response.schema'

const parseStatusCode = (value: unknown) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)

  return Number.NaN
}

const isValidHttpStatusCode = (value: number) =>
  Number.isInteger(value) && value >= 100 && value <= 599

const isStatusWrapperInstance = (
  value: unknown
): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || value instanceof Response)
    return false

  const prototype = Object.getPrototypeOf(value)
  if (!prototype || prototype === Object.prototype) return false

  return prototype.constructor?.name === 'ElysiaCustomStatusResponse'
}

const getStatusWrapper = (
  value: unknown
): { code: number; payload: unknown } | null => {
  if (!isStatusWrapperInstance(value)) return null

  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > 2) return null
  if (!keys.includes('code')) return null
  if (keys.some((key) => key !== 'code' && key !== 'response')) return null

  const candidate = value as Record<string, unknown>

  const code = parseStatusCode(candidate['code'])
  if (!isValidHttpStatusCode(code)) return null

  return {
    code,
    payload: Object.hasOwn(candidate, 'response')
      ? candidate['response']
      : undefined,
  }
}

type CreateApiErrorPluginOptions = {
  logger?: AppLogger
}

const resolveStatusCode = (code: string | number) => {
  if (typeof code === 'number') return code
  if (code === 'VALIDATION') return 422
  if (
    code === 'PARSE' ||
    code === 'INVALID_FILE_TYPE' ||
    code === 'INVALID_COOKIE_SIGNATURE'
  ) {
    return 400
  }
  if (code === 'NOT_FOUND') return 404
  if (code === 'INTERNAL_SERVER_ERROR') return 500

  return 500
}

export const createApiErrorPlugin = (
  options: CreateApiErrorPluginOptions = {}
) => {
  const logger = (options.logger ?? createServiceLogger('apiError')).child(
    'apiError'
  )

  return new Elysia({ name: 'api-error-plugin' })
    .onError({ as: 'global' }, ({ code, error, request, status }) => {
      const requestContext = getRequestContext()
      const normalizedStatusCode = resolveStatusCode(code)
      const validationErrors =
        code === 'VALIDATION' ? toValidationErrorMap(error.all) : undefined

      logger[normalizedStatusCode >= 500 ? 'error' : 'warn']({
        message: `API Error: ${String(code)}`,
        context: {
          requestId: requestContext?.requestId,
        },
        metadata: {
          errorCode: code,
          statusCode: normalizedStatusCode,
          method: request.method,
          path: new URL(request.url).pathname,
          ...(validationErrors && Object.keys(validationErrors).length > 0
            ? { validationErrors }
            : {}),
        },
        error,
      })

    if (code === 'VALIDATION') {
      const errors = toValidationErrorMap(error.all)

      if (Object.keys(errors).length === 0) {
        errors['root'] = 'Invalid request'
      }

      return status(
        422,
        createErrorResponse(422, {
          message: 'Validation error',
          errors,
        })
      )
    }

    if (
      code === 'PARSE' ||
      code === 'INVALID_FILE_TYPE' ||
      code === 'INVALID_COOKIE_SIGNATURE'
    ) {
      return status(400, createErrorResponse(400))
    }

    if (code === 'NOT_FOUND') {
      return status(404, createErrorResponse(404))
    }

    if (typeof code === 'number' && isStandardErrorStatus(code)) {
      const customError = error as { response?: unknown }

      return status(code, normalizeErrorResponse(code, customError.response))
    }

    if (code === 'INTERNAL_SERVER_ERROR') {
      return status(500, createErrorResponse(500))
    }

    return status(500, createErrorResponse(500))
  })
    .mapResponse({ as: 'global' }, ({ response, set }) => {
      const wrappedStatusResponse = getStatusWrapper(response)

      if (
        wrappedStatusResponse &&
        isStandardErrorStatus(wrappedStatusResponse.code)
      ) {
        return Response.json(
          normalizeErrorResponse(
            wrappedStatusResponse.code,
            wrappedStatusResponse.payload
          ),
          {
            status: wrappedStatusResponse.code,
          }
        )
      }

      const responseStatus =
        response instanceof Response ? response.status : undefined

      const statusCode = parseStatusCode(set.status ?? responseStatus)

      if (!Number.isFinite(statusCode) || !isStandardErrorStatus(statusCode))
        return

      if (response instanceof Response) {
        return Response.json(createErrorResponse(statusCode), {
          status: statusCode,
        })
      }

      return Response.json(normalizeErrorResponse(statusCode, response), {
        status: statusCode,
      })
    })
}

export const apiErrorPlugin = createApiErrorPlugin()
