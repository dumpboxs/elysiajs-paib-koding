import { z } from 'zod'

export const STANDARD_ERROR_STATUS = [400, 401, 403, 404, 422, 429, 500] as const

export type StandardErrorStatus = (typeof STANDARD_ERROR_STATUS)[number]

export const STANDARD_ERROR_CODE: Record<StandardErrorStatus, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

export const STANDARD_ERROR_MESSAGE: Record<StandardErrorStatus, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  422: 'Validation error',
  429: 'Too many requests',
  500: 'Internal server error',
}

export const ApiValidationErrorsSchema = z.record(z.string(), z.string())

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  code: z.string(),
  message: z.string(),
  errors: ApiValidationErrorsSchema.optional(),
})

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    message: z.string(),
    data,
  })

export type ErrorCodeByStatus<S extends StandardErrorStatus> =
  (typeof STANDARD_ERROR_CODE)[S]

export type ApiErrorResponseByStatus<S extends StandardErrorStatus> = {
  success: false
  code: ErrorCodeByStatus<S>
  message: string
  errors?: Record<string, string>
}

export type ApiErrorResponse = ApiErrorResponseByStatus<StandardErrorStatus>

export const standardErrorResponseSchemas: Record<
  StandardErrorStatus,
  z.ZodTypeAny
> = {
  400: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[400]),
  }),
  401: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[401]),
  }),
  403: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[403]),
  }),
  404: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[404]),
  }),
  422: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[422]),
  }),
  429: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[429]),
  }),
  500: ApiErrorSchema.extend({
    code: z.literal(STANDARD_ERROR_CODE[500]),
  }),
}

export const withStandardResponses = <T extends Record<number, z.ZodTypeAny>>(
  responses: T
) =>
  ({
    400: standardErrorResponseSchemas[400],
    401: standardErrorResponseSchemas[401],
    403: standardErrorResponseSchemas[403],
    404: standardErrorResponseSchemas[404],
    422: standardErrorResponseSchemas[422],
    429: standardErrorResponseSchemas[429],
    500: standardErrorResponseSchemas[500],
    ...responses,
  }) as T & Record<StandardErrorStatus, z.ZodTypeAny>

export const isStandardErrorStatus = (
  status: number
): status is StandardErrorStatus =>
  STANDARD_ERROR_STATUS.includes(status as StandardErrorStatus)

type CreateErrorResponseOptions = {
  message?: string
  errors?: Record<string, string>
}

export const createErrorResponse = <S extends StandardErrorStatus>(
  status: S,
  options?: CreateErrorResponseOptions
): ApiErrorResponseByStatus<S> => {
  const response: ApiErrorResponseByStatus<S> = {
    success: false,
    code: STANDARD_ERROR_CODE[status] as ErrorCodeByStatus<S>,
    message: options?.message ?? STANDARD_ERROR_MESSAGE[status],
  }

  if (options?.errors && Object.keys(options.errors).length > 0)
    response.errors = options.errors

  return response
}

const isRecordOfStrings = (value: unknown): value is Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  return Object.values(value).every((item) => typeof item === 'string')
}

const pickValidationErrors = (errors: unknown) => {
  if (isRecordOfStrings(errors)) return errors

  if (Array.isArray(errors)) {
    const mappedErrors = toValidationErrorMap(errors as ValidationIssueLike[])

    if (Object.keys(mappedErrors).length > 0) return mappedErrors
  }

  return undefined
}

export const normalizeErrorResponse = (
  status: StandardErrorStatus,
  response: unknown
): ApiErrorResponse => {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const candidate = response as {
      message?: unknown
      errors?: unknown
    }

    const parsedErrors = pickValidationErrors(candidate.errors)

    return createErrorResponse(status, {
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : STANDARD_ERROR_MESSAGE[status],
      errors:
        status === 422
          ? (parsedErrors ?? { root: 'Invalid request' })
          : parsedErrors,
    })
  }

  if (typeof response === 'string') {
    if (status === 422) {
      return createErrorResponse(status, {
        message: response,
        errors: { root: 'Invalid request' },
      })
    }

    return createErrorResponse(status, { message: response })
  }

  if (status === 422) {
    return createErrorResponse(status, {
      errors: { root: 'Invalid request' },
    })
  }

  return createErrorResponse(status)
}

type ValidationIssueLike = {
  path?: unknown
  message?: unknown
}

const normalizeIssuePath = (path: unknown) => {
  if (Array.isArray(path)) {
    const normalized = path
      .filter((segment) => typeof segment === 'string' || typeof segment === 'number')
      .map((segment) => String(segment))
      .join('.')

    return normalized.length > 0 ? normalized : 'root'
  }

  if (typeof path !== 'string') return 'root'

  const sanitized = path
    .replace(/^\/+/, '')
    .replaceAll('/', '.')
    .replaceAll(/\[(\d+)\]/g, '.$1')

  return sanitized.length > 0 ? sanitized : 'root'
}

export const toValidationErrorMap = (issues: ValidationIssueLike[]) =>
  issues.reduce<Record<string, string>>((acc, issue) => {
    const key = normalizeIssuePath(issue.path)

    acc[key] =
      typeof issue.message === 'string' ? issue.message : 'Invalid request'

    return acc
  }, {})
