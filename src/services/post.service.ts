import {
  and,
  desc,
  eq,
  lt,
  or,
} from 'drizzle-orm'

import {
  type CreatePostBodySchema,
  type GetPostsQuerySchema,
} from '#/schemas/post.schema'

import { db } from '#/db'
import { postTable } from '#/db/schemas'

type CursorPayload = {
  createdAt: string
  id: string
}

const encodeCursor = (payload: CursorPayload) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

const decodeCursor = (cursor: string): CursorPayload => {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as CursorPayload

    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new InvalidCursorError()
    }

    const createdAt = new Date(parsed.createdAt)
    if (Number.isNaN(createdAt.getTime())) throw new InvalidCursorError()

    return parsed
  } catch {
    throw new InvalidCursorError()
  }
}

const toCursorDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value)

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

export const postService = {
  create: async (data: CreatePostBodySchema, authorId: string) => {
    const [post] = await db
      .insert(postTable)
      .values({
        ...data,
        authorId,
      })
      .returning()

    return post
  },

  findPublishedById: async (id: string) => {
    const [post] = await db
      .select()
      .from(postTable)
      .where(
        and(
          eq(postTable.id, id),
          eq(postTable.published, true)
        )
      )
      .limit(1)

    return post
  },

  listPublishedWithCursor: async ({
    cursor,
    limit,
  }: GetPostsQuerySchema) => {
    const parsedCursor = cursor ? decodeCursor(cursor) : null
    const cursorDate = parsedCursor
      ? toCursorDate(parsedCursor.createdAt)
      : null

    const whereCondition = parsedCursor && cursorDate
      ? and(
          eq(postTable.published, true),
          or(
            lt(postTable.createdAt, cursorDate),
            and(
              eq(postTable.createdAt, cursorDate),
              lt(postTable.id, parsedCursor.id)
            )
          )
        )
      : eq(postTable.published, true)

    const rows = await db
      .select()
      .from(postTable)
      .where(whereCondition)
      .orderBy(desc(postTable.createdAt), desc(postTable.id))
      .limit(limit + 1)

    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const lastItem = items.at(-1)

    const nextCursor = hasMore && lastItem
      ? encodeCursor({
          createdAt: toCursorDate(lastItem.createdAt).toISOString(),
          id: lastItem.id,
        })
      : null

    return {
      items,
      nextCursor,
      hasMore,
    }
  },
}
