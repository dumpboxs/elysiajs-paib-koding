const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'api-key',
  'api_key',
  'apikey',
  'access-token',
  'access_token',
  'refresh-token',
  'refresh_token',
  'id-token',
  'id_token',
  'session',
]

const REDACTED_VALUE = '[REDACTED]'
const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 25
const MAX_OBJECT_KEYS = 50
const MAX_STRING_LENGTH = 2_048

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const shouldRedactKey = (key: string, sensitiveFields: Set<string>) => {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return false

  if (sensitiveFields.has(normalized)) return true
  return normalized.split(/[\s._-]+/g).some((part) => sensitiveFields.has(part))
}

const truncateString = (value: string) => {
  if (value.length <= MAX_STRING_LENGTH) return value

  return `${value.slice(0, MAX_STRING_LENGTH)}... [truncated ${value.length - MAX_STRING_LENGTH} chars]`
}

const toHeadersObject = (headers: Headers) =>
  Object.fromEntries(headers.entries())

const sanitizeInternal = (
  value: unknown,
  sensitiveFields: Set<string>,
  depth: number
): unknown => {
  if (value == null) return value
  if (depth >= MAX_DEPTH) return '[MaxDepth]'

  if (typeof value === 'string') return truncateString(value)
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }

  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.toString()
  if (value instanceof Headers) {
    return sanitizeInternal(toHeadersObject(value), sensitiveFields, depth + 1)
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeInternal(item, sensitiveFields, depth + 1))

    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_ARRAY_ITEMS} more items]`)
    }

    return items
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      ...(value.stack ? { stack: truncateString(value.stack) } : {}),
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (!isPlainObject(value)) return String(value)

  const entries = Object.entries(value)
  const limitedEntries = entries.slice(0, MAX_OBJECT_KEYS)
  const output: Record<string, unknown> = {}

  for (const [key, nestedValue] of limitedEntries) {
    output[key] = shouldRedactKey(key, sensitiveFields)
      ? REDACTED_VALUE
      : sanitizeInternal(nestedValue, sensitiveFields, depth + 1)
  }

  if (entries.length > MAX_OBJECT_KEYS) {
    output['__truncated__'] = `[+${entries.length - MAX_OBJECT_KEYS} more keys]`
  }

  return output
}

export const normalizeSensitiveFields = (
  fields: Iterable<string> = []
): string[] => {
  const merged = new Set<string>(DEFAULT_SENSITIVE_FIELDS)

  for (const field of fields) {
    const normalized = field.trim().toLowerCase()
    if (normalized) merged.add(normalized)
  }

  return [...merged]
}

export const parseSensitiveFieldConfig = (value: string | undefined) =>
  normalizeSensitiveFields((value ?? '').split(','))

export const sanitizeForLogging = (
  value: unknown,
  sensitiveFields: Iterable<string>
): unknown =>
  sanitizeInternal(value, new Set(normalizeSensitiveFields(sensitiveFields)), 0)

export const redactHeaders = (
  headers: Headers | Record<string, string | number | undefined>,
  sensitiveFields: Iterable<string>
) =>
  sanitizeForLogging(
    headers instanceof Headers
      ? headers
      : Object.fromEntries(Object.entries(headers)),
    sensitiveFields
  ) as Record<string, unknown>

export { DEFAULT_SENSITIVE_FIELDS, REDACTED_VALUE }
