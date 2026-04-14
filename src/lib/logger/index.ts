import pino from 'pino'
import type {
  DestinationStream,
  Logger as PinoLogger,
  LoggerOptions,
} from 'pino'
import pretty from 'pino-pretty'

import { env } from '#/env'
import { getRequestId } from '#/lib/logger/context'
import {
  parseSensitiveFieldConfig,
  sanitizeForLogging,
} from '#/lib/logger/redaction'
import {
  serializeError,
  type SerializedError,
} from '#/lib/logger/serialization'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogContext {
  requestId: string
  timestamp: string
  service: string
  [key: string]: unknown
}

export interface LogEntry {
  message: string
  context?: Partial<LogContext>
  metadata?: Record<string, unknown>
  error?: unknown
  duration?: number
}

type CreateLoggerOptions = {
  destination?: DestinationStream
  enabled?: boolean
  format?: 'json' | 'pretty'
  includeStack?: boolean
  level?: LogLevel
  sensitiveFields?: string[]
}

export type AppLogger = {
  raw: PinoLogger
  child: (
    service: string,
    defaultContext?: Record<string, unknown>
  ) => AppLogger
} & Record<LogLevel, (entry: LogEntry) => void>

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

const buildPinoOptions = ({
  enabled = !isTest,
  format = env.LOG_FORMAT,
  level = env.LOG_LEVEL,
}: CreateLoggerOptions): LoggerOptions => ({
  enabled,
  level,
  base: undefined,
  messageKey: 'message',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport:
    format === 'pretty'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
})

const buildContext = (
  service: string,
  defaultContext: Record<string, unknown>,
  entryContext: Partial<LogContext> | undefined
): LogContext => {
  const requestId = entryContext?.requestId ?? getRequestId()
  const timestamp = entryContext?.timestamp ?? new Date().toISOString()
  const resolvedService = entryContext?.service ?? service

  return {
    requestId,
    timestamp,
    service: resolvedService,
    ...defaultContext,
    ...entryContext,
  }
}

const serializeLogPayload = (
  service: string,
  defaultContext: Record<string, unknown>,
  entry: LogEntry,
  includeStack: boolean,
  sensitiveFields: string[]
) => {
  const payload: {
    message: string
    context: LogContext
    metadata?: Record<string, unknown>
    error?: SerializedError
    duration?: number
  } = {
    message: entry.message,
    context: sanitizeForLogging(
      buildContext(service, defaultContext, entry.context),
      sensitiveFields
    ) as LogContext,
  }

  if (entry.metadata) {
    payload.metadata = sanitizeForLogging(
      entry.metadata,
      sensitiveFields
    ) as Record<string, unknown>
  }

  if (entry.error) {
    payload.error = serializeError(entry.error, {
      includeStack,
      sensitiveFields,
    })
  }

  if (typeof entry.duration === 'number') {
    payload.duration = Math.round(entry.duration)
  }

  return payload
}

const createLoggerInstance = (
  raw: PinoLogger,
  {
    service = 'app',
    defaultContext = {},
    includeStack = !isProduction,
    sensitiveFields = parseSensitiveFieldConfig(env.LOG_SENSITIVE_FIELDS),
  }: {
    service?: string
    defaultContext?: Record<string, unknown>
    includeStack?: boolean
    sensitiveFields?: string[]
  } = {}
): AppLogger => {
  const logAtLevel = (level: LogLevel) => (entry: LogEntry) => {
    raw[level](
      serializeLogPayload(
        service,
        defaultContext,
        entry,
        includeStack,
        sensitiveFields
      )
    )
  }

  return {
    raw,
    trace: logAtLevel('trace'),
    debug: logAtLevel('debug'),
    info: logAtLevel('info'),
    warn: logAtLevel('warn'),
    error: logAtLevel('error'),
    fatal: logAtLevel('fatal'),
    child: (nextService, nextContext = {}) =>
      createLoggerInstance(raw, {
        service: nextService,
        defaultContext: {
          ...defaultContext,
          ...nextContext,
        },
        includeStack,
        sensitiveFields,
      }),
  }
}

export const createLogger = (options: CreateLoggerOptions = {}): AppLogger => {
  const shouldUsePrettyStream =
    options.format === 'pretty' && options.destination !== undefined

  const raw = shouldUsePrettyStream
    ? pino(
        buildPinoOptions({
          ...options,
          format: 'json',
        }),
        pretty({
          colorize: false,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
          destination: options.destination as never,
        })
      )
    : pino(buildPinoOptions(options), options.destination)

  return createLoggerInstance(raw, {
    includeStack: options.includeStack,
    sensitiveFields:
      options.sensitiveFields ??
      parseSensitiveFieldConfig(env.LOG_SENSITIVE_FIELDS),
  })
}

export const logger = createLogger()
export const baseLogger = logger.raw
export const createServiceLogger = (
  service: string,
  defaultContext?: Record<string, unknown>
) => logger.child(service, defaultContext)
