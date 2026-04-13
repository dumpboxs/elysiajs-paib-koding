import { sql } from 'drizzle-orm'
import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { userTable } from './auth'
import { postTable } from './post'

export const likeTable = pgTable(
  'likes',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => postTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => userTable.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniqueLike: uniqueIndex('unique_like_idx').on(table.postId, table.userId),
  })
)

export type Like = typeof likeTable.$inferSelect
export type NewLike = typeof likeTable.$inferInsert
