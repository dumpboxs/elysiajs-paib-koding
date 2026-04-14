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
import { createServiceLogger } from '#/lib/logger'

type CursorPayload = {
  createdAt: string
  id: string
}

const logger = createServiceLogger('postService')

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
    logger.warn({
      message: 'Invalid cursor received',
      metadata: {
        cursor,
      },
    })
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
    const startedAt = performance.now()

    logger.info({
      message: 'Creating new post',
      metadata: {
        authorId,
        slug: data.slug,
        title: data.title,
      },
    })

    try {
      const [post] = await db
        .insert(postTable)
        .values({
          ...data,
          authorId,
        })
        .returning()

      logger.info({
        message: 'Post created successfully',
        metadata: {
          postId: post?.id,
          slug: post?.slug,
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Create post failed',
        metadata: {
          authorId,
          slug: data.slug,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  findPublishedById: async (id: string) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Fetching published post by id',
      metadata: {
        postId: id,
      },
    })

    try {
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

      logger.info({
        message: post ? 'Published post found' : 'Published post not found',
        metadata: {
          postId: id,
          found: Boolean(post),
        },
        duration: performance.now() - startedAt,
      })

      return post
    } catch (error) {
      logger.error({
        message: 'Fetch published post failed',
        metadata: {
          postId: id,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  listPublishedWithCursor: async ({
    cursor,
    limit,
  }: GetPostsQuerySchema) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Listing published posts with cursor',
      metadata: {
        cursorProvided: Boolean(cursor),
        limit,
      },
    })

    try {
      const parsedCursor = cursor ? decodeCursor(cursor) : null
      const cursorDate = parsedCursor
        ? toCursorDate(parsedCursor.createdAt)
        : null

      if (parsedCursor) {
        logger.debug({
          message: 'Decoded posts cursor',
          metadata: {
            cursor: parsedCursor,
          },
        })
      }

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

      if (nextCursor) {
        logger.debug({
          message: 'Encoded posts cursor',
          metadata: {
            nextCursor,
          },
        })
      }

      logger.info({
        message: 'Published posts fetched successfully',
        metadata: {
          count: items.length,
          hasMore,
          nextCursor,
        },
        duration: performance.now() - startedAt,
      })

      return {
        items,
        nextCursor,
        hasMore,
      }
    } catch (error) {
      logger.error({
        message: 'List published posts failed',
        metadata: {
          cursorProvided: Boolean(cursor),
          limit,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },
}
