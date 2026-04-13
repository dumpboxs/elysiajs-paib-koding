import { z } from 'zod'

import { insertPostSchema } from '#/schemas/drizzle-zod'

export const createPostBodySchema = insertPostSchema.pick({
  title: true,
  slug: true,
  content: true,
  coverImage: true,
  published: true,
})

export type CreatePostBodySchema = z.infer<typeof createPostBodySchema>

export const getPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().trim().min(1).optional(),
})

export type GetPostsQuerySchema = z.infer<typeof getPostsQuerySchema>

export const getPostByIdParamsSchema = z.object({
  id: z.string().uuid(),
})

export type GetPostByIdParamsSchema = z.infer<typeof getPostByIdParamsSchema>
