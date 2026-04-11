import { createSchemaFactory } from 'drizzle-zod'
import { z } from 'zod'

import { postTable } from '#/db/schemas'

export const { createInsertSchema, createSelectSchema, createUpdateSchema } =
  createSchemaFactory({
    coerce: {
      boolean: true,
      date: true,
      number: true,
    },
    zodInstance: z,
  })

export const selectPostSchema = createSelectSchema(postTable)

export const insertPostSchema = createInsertSchema(postTable, {
  title: (schema) =>
    schema
      .nonempty({ error: 'Title is required' })
      .min(3, { error: 'Title must be at least 3 chars' }),
  slug: (schema) =>
    schema
      .nonempty({ error: 'Slug is required' })
      .min(3, { error: 'Slug must be at least 3 chars' }),
  content: (schema) => schema.optional(),
  coverImage: z.url({ error: 'Invalid URL' }).optional(),
  published: (schema) => schema.optional().default(false),
})
