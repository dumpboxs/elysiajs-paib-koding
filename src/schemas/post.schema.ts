import { type z } from 'zod'

import { insertPostSchema } from '#/schemas/drizzle-zod'

export const createPostBodySchema = insertPostSchema.pick({
  title: true,
  slug: true,
  content: true,
  coverImage: true,
  published: true,
})

export type CreatePostBodySchema = z.infer<typeof createPostBodySchema>
