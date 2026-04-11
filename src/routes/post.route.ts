import Elysia, { status as elysiaStatus } from 'elysia'
import { z } from 'zod'

import { auth } from '#/lib/auth'
import {
  ApiSuccessSchema,
  createErrorResponse,
  withStandardResponses,
} from '#/schemas/api-response.schema'
import { selectPostSchema } from '#/schemas/drizzle-zod'
import {
  createPostBodySchema,
  type CreatePostBodySchema,
} from '#/schemas/post.schema'
import { postService } from '#/services/post.service'

type AuthenticatedUser = typeof auth.$Infer.Session.user

type AuthenticatedSession = typeof auth.$Infer.Session | null

type CreatePostResult = Awaited<ReturnType<typeof postService.create>>

type AuthorizeCreatePostInput = {
  body: CreatePostBodySchema
  user: AuthenticatedUser
}

type PostRoutesDeps = {
  authorizeCreatePost: (input: AuthorizeCreatePostInput) => Promise<boolean>
  createPost: (
    data: CreatePostBodySchema,
    authorId: string
  ) => Promise<CreatePostResult | null | undefined>
  getSession: (request: Request) => Promise<AuthenticatedSession>
  isRateLimited: (input: AuthorizeCreatePostInput) => Promise<boolean>
}

export type CreatePostRoutesDeps = Partial<PostRoutesDeps>

const postResponseDataSchema = selectPostSchema
  .omit({
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    createdAt: z.string(),
    updatedAt: z.string().nullable(),
  })

const createPostResponseSchema = ApiSuccessSchema(
  postResponseDataSchema
).extend({
  message: z.literal('Post created successfully'),
})

const defaultPostRoutesDeps: PostRoutesDeps = {
  authorizeCreatePost: async () => true,
  createPost: (data, authorId) => postService.create(data, authorId),
  getSession: async (request) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session) return null

    return {
      session: session.session,
      user: session.user,
    }
  },
  isRateLimited: async () => false,
}

const isUniqueConstraintError = (
  error: unknown
): error is {
  code: '23505'
  constraint?: string
  detail?: string
} => {
  if (!error || typeof error !== 'object') return false

  return (error as { code?: unknown }).code === '23505'
}

const toDateString = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value

  return new Date(String(value)).toISOString()
}

const mapCreatePostResponse = (post: NonNullable<CreatePostResult>) => ({
  ...post,
  createdAt: toDateString(post.createdAt),
  updatedAt: post.updatedAt ? toDateString(post.updatedAt) : null,
})

/**
 * Post Routes
 */
export const createPostRoutes = (deps: CreatePostRoutesDeps = {}) => {
  const runtimeDeps = {
    ...defaultPostRoutesDeps,
    ...deps,
  } satisfies PostRoutesDeps

  const authMacro = new Elysia({ name: 'post-auth-macro' }).macro({
    optionalAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) return

        return {
          session: session.session,
          user: session.user,
        }
      },
    },

    requiredAuth: {
      async resolve({ request }) {
        const session = await runtimeDeps.getSession(request)

        if (!session) return elysiaStatus(401, createErrorResponse(401))

        return {
          session: session.session,
          user: session.user,
        }
      },
    },
  })

  return new Elysia({ prefix: '/api/posts' }).use(authMacro).post(
    '/',
    async ({ body, user }) => {
      if (!(await runtimeDeps.authorizeCreatePost({ body, user }))) {
        return elysiaStatus(403, createErrorResponse(403))
      }

      if (await runtimeDeps.isRateLimited({ body, user })) {
        return elysiaStatus(429, createErrorResponse(429))
      }

      try {
        const post = await runtimeDeps.createPost(body, user.id)

        if (!post) return elysiaStatus(500, createErrorResponse(500))

        return {
          success: true,
          message: 'Post created successfully',
          data: mapCreatePostResponse(post),
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const isSlugConstraint =
            error.constraint?.includes('slug') ?? error.detail?.includes('slug')

          return elysiaStatus(
            400,
            createErrorResponse(400, {
              message: isSlugConstraint ? 'Slug already exists' : 'Bad request',
            })
          )
        }

        throw error
      }
    },
    {
      requiredAuth: true,
      body: createPostBodySchema,
      response: withStandardResponses({
        200: createPostResponseSchema,
      }),
    }
  )
}

export const postRoutes = createPostRoutes()
