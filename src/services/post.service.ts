import { type CreatePostBodySchema } from '#/schemas/post.schema'

import { db } from '#/db'
import { postTable } from '#/db/schemas'

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
}
