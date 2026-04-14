import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
} from 'drizzle-orm'

import { db } from '#/db'
import {
  commentTable,
  likeTable,
  postTable,
  userTable,
  viewTable,
} from '#/db/schemas'
import { createServiceLogger } from '#/lib/logger'
import type {
  CreateCommentBodySchema,
  ToggleLikeBodySchema,
  UpdateCommentBodySchema,
} from '#/schemas/engagement.schema'

const logger = createServiceLogger('engagementService')

type PublicCommentUser = {
  id: string
  username: string | null
  displayName: string | null
}

type CommentRow = {
  id: string
  content: string
  parentId: string | null
  createdAt: Date
  updatedAt: Date | null
  user: PublicCommentUser
}

export type CommentTreeNode = CommentRow & {
  replies: CommentTreeNode[]
  repliesCount: number
}

const toNumber = (value: unknown) => {
  const normalized = Number(value)

  return Number.isNaN(normalized) ? 0 : normalized
}

const byNewestFirst = (left: { createdAt: Date; id: string }, right: {
  createdAt: Date
  id: string
}) => {
  const dateDiff = right.createdAt.getTime() - left.createdAt.getTime()
  if (dateDiff !== 0) return dateDiff

  return right.id.localeCompare(left.id)
}

const isUniqueConstraintError = (
  error: unknown
): error is {
  code: '23505'
} => {
  if (!error || typeof error !== 'object') return false

  return (error as { code?: unknown }).code === '23505'
}

const mapCommentUser = (row: {
  user:
    | {
        id: string | null
        username: string | null
        displayUsername: string | null
        name: string | null
      }
    | null
}) => ({
  id: row.user?.id ?? '',
  username: row.user?.username ?? null,
  displayName: row.user?.displayUsername ?? row.user?.name ?? null,
})

const selectCommentFields = {
  id: commentTable.id,
  content: commentTable.content,
  parentId: commentTable.parentId,
  createdAt: commentTable.createdAt,
  updatedAt: commentTable.updatedAt,
  user: {
    id: userTable.id,
    username: userTable.username,
    displayUsername: userTable.displayUsername,
    name: userTable.name,
  },
} as const

const mapCommentRow = (row: {
  id: string
  content: string
  parentId: string | null
  createdAt: Date
  updatedAt: Date | null
  user:
    | {
        id: string | null
        username: string | null
        displayUsername: string | null
        name: string | null
      }
    | null
}): CommentRow => ({
  id: row.id,
  content: row.content,
  parentId: row.parentId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  user: mapCommentUser(row),
})

const buildCommentTree = (rootRows: CommentRow[], replyRows: CommentRow[]) => {
  const nodes = new Map<string, CommentTreeNode>()

  for (const row of [...rootRows, ...replyRows]) {
    nodes.set(row.id, {
      ...row,
      replies: [],
      repliesCount: 0,
    })
  }

  const childrenByParent = new Map<string, CommentTreeNode[]>()

  for (const row of replyRows) {
    if (!row.parentId) continue

    const child = nodes.get(row.id)
    if (!child) continue

    const children = childrenByParent.get(row.parentId) ?? []
    children.push(child)
    childrenByParent.set(row.parentId, children)
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    const parent = nodes.get(parentId)
    if (!parent) continue

    children.sort(byNewestFirst)
    parent.replies = children
    parent.repliesCount = children.length
  }

  return rootRows
    .map((row) => nodes.get(row.id))
    .filter((row): row is CommentTreeNode => Boolean(row))
}

export class PostNotFoundError extends Error {
  constructor() {
    super('Post not found')
    this.name = 'PostNotFoundError'
  }
}

export class ParentCommentNotFoundError extends Error {
  constructor() {
    super('Parent comment not found')
    this.name = 'ParentCommentNotFoundError'
  }
}

export class InvalidCommentParentError extends Error {
  constructor() {
    super('Parent comment does not belong to this post')
    this.name = 'InvalidCommentParentError'
  }
}

const assertPublishedPost = async (postId: string) => {
  logger.debug({
    message: 'Verifying published post for engagement',
    metadata: {
      postId,
    },
  })

  const post = await db
    .select({ id: postTable.id })
    .from(postTable)
    .where(
      and(
        eq(postTable.id, postId),
        eq(postTable.published, true)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!post) {
    logger.warn({
      message: 'Engagement target post not found',
      metadata: {
        postId,
      },
    })
    throw new PostNotFoundError()
  }

  return post
}

export const engagementService = {
  toggleLike: async (data: ToggleLikeBodySchema, userId: string) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Toggling post like',
      metadata: {
        postId: data.postId,
        userId,
      },
    })

    try {
      await assertPublishedPost(data.postId)

      const existingLike = await db
        .select({ id: likeTable.id })
        .from(likeTable)
        .where(
          and(
            eq(likeTable.postId, data.postId),
            eq(likeTable.userId, userId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (existingLike) {
        await db.delete(likeTable).where(eq(likeTable.id, existingLike.id))

        const result = {
          liked: false,
          likesCount: await engagementService.getLikesCount(data.postId),
        }

        logger.info({
          message: 'Post like toggled',
          metadata: {
            postId: data.postId,
            userId,
            action: 'unlike',
            likesCount: result.likesCount,
          },
          duration: performance.now() - startedAt,
        })

        return result
      }

      try {
        await db.insert(likeTable).values({
          postId: data.postId,
          userId,
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
      }

      const result = {
        liked: true,
        likesCount: await engagementService.getLikesCount(data.postId),
      }

      logger.info({
        message: 'Post like toggled',
        metadata: {
          postId: data.postId,
          userId,
          action: 'like',
          likesCount: result.likesCount,
        },
        duration: performance.now() - startedAt,
      })

      return result
    } catch (error) {
      logger.error({
        message: 'Toggle post like failed',
        metadata: {
          postId: data.postId,
          userId,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  getLikesCount: async (postId: string) => {
    const startedAt = performance.now()

    try {
      await assertPublishedPost(postId)

      const result = await db
        .select({ count: count() })
        .from(likeTable)
        .where(eq(likeTable.postId, postId))
        .then((rows) => rows[0])

      const countValue = toNumber(result?.count)

      logger.debug({
        message: 'Fetched likes count',
        metadata: {
          postId,
          count: countValue,
        },
        duration: performance.now() - startedAt,
      })

      return countValue
    } catch (error) {
      logger.error({
        message: 'Get likes count failed',
        metadata: {
          postId,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  hasUserLiked: async (postId: string, userId: string) => {
    await assertPublishedPost(postId)

    const like = await db
      .select({ id: likeTable.id })
      .from(likeTable)
      .where(
        and(
          eq(likeTable.postId, postId),
          eq(likeTable.userId, userId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    return Boolean(like)
  },

  createComment: async (data: CreateCommentBodySchema, userId: string) => {
    const startedAt = performance.now()

    logger.info({
      message: 'Creating comment',
      metadata: {
        postId: data.postId,
        userId,
        parentId: data.parentId ?? null,
      },
    })

    try {
      await assertPublishedPost(data.postId)

      if (data.parentId) {
        const parentComment = await db
          .select({
            id: commentTable.id,
            postId: commentTable.postId,
          })
          .from(commentTable)
          .where(eq(commentTable.id, data.parentId))
          .limit(1)
          .then((rows) => rows[0])

        if (!parentComment) {
          logger.warn({
            message: 'Parent comment not found',
            metadata: {
              postId: data.postId,
              parentId: data.parentId,
            },
          })
          throw new ParentCommentNotFoundError()
        }
        if (parentComment.postId !== data.postId) {
          logger.warn({
            message: 'Invalid comment parent detected',
            metadata: {
              postId: data.postId,
              parentId: data.parentId,
              parentPostId: parentComment.postId,
            },
          })
          throw new InvalidCommentParentError()
        }
      }

      const [comment] = await db
        .insert(commentTable)
        .values({
          postId: data.postId,
          userId,
          content: data.content,
          parentId: data.parentId ?? null,
        })
        .returning()

      if (!comment) throw new Error('Failed to create comment')

      logger.info({
        message: 'Comment created successfully',
        metadata: {
          commentId: comment.id,
          postId: data.postId,
          userId,
          parentId: comment.parentId,
        },
        duration: performance.now() - startedAt,
      })

      return comment
    } catch (error) {
      logger.error({
        message: 'Create comment failed',
        metadata: {
          postId: data.postId,
          userId,
          parentId: data.parentId ?? null,
        },
        error,
        duration: performance.now() - startedAt,
      })

      throw error
    }
  },

  getCommentsByPost: async (postId: string, page: number, limit: number) => {
    const startedAt = performance.now()

    logger.debug({
      message: 'Fetching comments by post',
      metadata: {
        postId,
        page,
        limit,
      },
    })

    await assertPublishedPost(postId)

    const rootRows = await db
      .select(selectCommentFields)
      .from(commentTable)
      .innerJoin(userTable, eq(commentTable.userId, userTable.id))
      .where(
        and(
          eq(commentTable.postId, postId),
          isNull(commentTable.parentId)
        )
      )
      .orderBy(desc(commentTable.createdAt), desc(commentTable.id))
      .limit(limit)
      .offset((page - 1) * limit)

    const totalRootsResult = await db
      .select({ count: count() })
      .from(commentTable)
      .where(
        and(
          eq(commentTable.postId, postId),
          isNull(commentTable.parentId)
        )
      )
      .then((rows) => rows[0])

    const rootComments = rootRows.map(mapCommentRow)
    const rootIds = rootComments.map((comment) => comment.id)

    if (rootIds.length === 0) {
      return {
        items: [] as CommentTreeNode[],
        total: toNumber(totalRootsResult?.count),
        page,
        limit,
      }
    }

    const replyRows: CommentRow[] = []
    let currentParentIds = rootIds

    while (currentParentIds.length > 0) {
      const descendants = await db
        .select(selectCommentFields)
        .from(commentTable)
        .innerJoin(userTable, eq(commentTable.userId, userTable.id))
        .where(
          and(
            eq(commentTable.postId, postId),
            inArray(commentTable.parentId, currentParentIds)
          )
        )
        .orderBy(desc(commentTable.createdAt), desc(commentTable.id))

      if (descendants.length === 0) break

      const mappedDescendants = descendants.map(mapCommentRow)
      replyRows.push(...mappedDescendants)
      currentParentIds = mappedDescendants.map((comment) => comment.id)
    }

    const result = {
      items: buildCommentTree(rootComments, replyRows),
      total: toNumber(totalRootsResult?.count),
      page,
      limit,
    }

    logger.info({
      message: 'Comments fetched successfully',
      metadata: {
        postId,
        page,
        limit,
        total: result.total,
        rootCount: result.items.length,
      },
      duration: performance.now() - startedAt,
    })

    return result
  },

  updateComment: async (
    commentId: string,
    data: UpdateCommentBodySchema,
    userId: string
  ) => {
    const startedAt = performance.now()

    const comment = await db
      .select({
        id: commentTable.id,
        userId: commentTable.userId,
        postId: commentTable.postId,
      })
      .from(commentTable)
      .where(eq(commentTable.id, commentId))
      .limit(1)
      .then((rows) => rows[0])

    if (!comment) {
      logger.warn({
        message: 'Comment update target not found',
        metadata: {
          commentId,
          userId,
        },
      })
      return null
    }

    await assertPublishedPost(comment.postId)

    if (comment.userId !== userId) {
      logger.warn({
        message: 'Comment update unauthorized',
        metadata: {
          commentId,
          userId,
          ownerId: comment.userId,
        },
      })
      return null
    }

    const [updated] = await db
      .update(commentTable)
      .set({
        content: data.content,
        updatedAt: new Date(),
      })
      .where(eq(commentTable.id, commentId))
      .returning()

    logger.info({
      message: 'Comment updated successfully',
      metadata: {
        commentId,
        userId,
      },
      duration: performance.now() - startedAt,
    })

    return updated
  },

  deleteComment: async (commentId: string, userId: string) => {
    const startedAt = performance.now()

    const comment = await db
      .select({
        id: commentTable.id,
        userId: commentTable.userId,
        postId: commentTable.postId,
      })
      .from(commentTable)
      .where(eq(commentTable.id, commentId))
      .limit(1)
      .then((rows) => rows[0])

    if (!comment) {
      logger.warn({
        message: 'Comment delete target not found',
        metadata: {
          commentId,
          userId,
        },
      })
      return null
    }

    await assertPublishedPost(comment.postId)

    if (comment.userId !== userId) {
      logger.warn({
        message: 'Comment delete unauthorized',
        metadata: {
          commentId,
          userId,
          ownerId: comment.userId,
        },
      })
      return null
    }

    await db.delete(commentTable).where(eq(commentTable.id, commentId))

    logger.info({
      message: 'Comment deleted successfully',
      metadata: {
        commentId,
        userId,
      },
      duration: performance.now() - startedAt,
    })

    return { deleted: true }
  },

  getCommentsCount: async (postId: string) => {
    await assertPublishedPost(postId)

    const result = await db
      .select({ count: count() })
      .from(commentTable)
      .where(eq(commentTable.postId, postId))
      .then((rows) => rows[0])

    return toNumber(result?.count)
  },

  trackView: async (postId: string, userId?: string, viewerIpHash?: string) => {
    const startedAt = performance.now()

    await assertPublishedPost(postId)

    await db.insert(viewTable).values({
      postId,
      userId: userId ?? null,
      viewerIpHash: viewerIpHash ?? null,
    })

    logger.debug({
      message: 'Post view tracked',
      metadata: {
        postId,
        userId: userId ?? null,
        viewerIpHash: viewerIpHash ?? null,
      },
      duration: performance.now() - startedAt,
    })
  },

  getViewsCount: async (postId: string) => {
    await assertPublishedPost(postId)

    const result = await db
      .select({ count: count() })
      .from(viewTable)
      .where(eq(viewTable.postId, postId))
      .then((rows) => rows[0])

    return toNumber(result?.count)
  },
}
