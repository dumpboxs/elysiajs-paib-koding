import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export type RequestContext = {
  requestId: string
  startTime: number
  method?: string
  path?: string
  url?: string
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export const isValidRequestId = (value: string | null | undefined) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  REQUEST_ID_PATTERN.test(value)

export const resolveRequestId = (value: string | null | undefined) =>
  typeof value === 'string' && isValidRequestId(value)
    ? value.trim()
    : randomUUID()

export const enterRequestContext = (context: RequestContext) => {
  requestContextStorage.enterWith(context)
  return context
}

export const runWithRequestContext = <T>(
  context: RequestContext,
  callback: () => T
) => requestContextStorage.run(context, callback)

export const getRequestContext = () => requestContextStorage.getStore()

export const getRequestId = () => getRequestContext()?.requestId ?? 'system'

export const updateRequestContext = (partial: Partial<RequestContext>) => {
  const context = getRequestContext()
  if (!context) return undefined

  Object.assign(context, partial)
  return context
}
