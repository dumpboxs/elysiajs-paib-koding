import 'dotenv/config'
import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const booleanFlagSchema = z.preprocess(
  (value) => (typeof value === 'boolean' ? String(value) : value),
  z.enum(['true', 'false']).transform((value) => value === 'true')
)

const defaultLogFormat =
  process.env.NODE_ENV === 'production' ? 'json' : 'pretty'

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    PORT: z.coerce.number().int().min(0).max(65535),
    CORS_ORIGIN: z.url(),
    BETTER_AUTH_SECRET: z.string().trim().min(32),
    BETTER_AUTH_URL: z.url(),
    VIEWER_IP_HASH_SALT: z.string().trim().min(16).optional(),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
      .default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default(defaultLogFormat),
    LOG_INCLUDE_DB_QUERIES: booleanFlagSchema.default(false),
    LOG_INCLUDE_AUTH_EVENTS: booleanFlagSchema.default(true),
    LOG_INCLUDE_REQUEST_BODY: booleanFlagSchema.default(false),
    LOG_INCLUDE_RESPONSE_BODY: booleanFlagSchema.default(false),
    LOG_SENSITIVE_FIELDS: z
      .string()
      .default('password,token,secret,authorization,cookie'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
