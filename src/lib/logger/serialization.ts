import { sanitizeForLogging } from '#/lib/logger/redaction'

export type SerializedError = {
  name: string
  message: string
  stack?: string
  code?: string | number
}

export const serializeError = (
  error: unknown,
  {
    includeStack,
    sensitiveFields,
  }: { includeStack: boolean; sensitiveFields: Iterable<string> }
): SerializedError => {
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code

    return {
      name: error.name,
      message: error.message,
      ...(includeStack && error.stack ? { stack: error.stack } : {}),
      ...(typeof maybeCode === 'string' || typeof maybeCode === 'number'
        ? { code: maybeCode }
        : {}),
    }
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
    }
  }

  const sanitized = sanitizeForLogging(error, sensitiveFields)

  return {
    name: 'UnknownError',
    message:
      typeof sanitized === 'string'
        ? sanitized
        : JSON.stringify(sanitized ?? 'Unknown error'),
  }
}

export const estimatePayloadSize = (value: unknown): number | undefined => {
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (value instanceof Uint8Array) return value.byteLength

  if (value instanceof Response) {
    const contentLength = value.headers.get('content-length')
    if (!contentLength) return undefined

    const parsed = Number(contentLength)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  if (value == null) return 0

  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    return undefined
  }
}

export const toSerializableUrl = (url: string) => {
  const parsed = new URL(url)

  return {
    url: parsed.toString(),
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
  }
}
