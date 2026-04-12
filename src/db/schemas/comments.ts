import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { userTable } from './auth'
import { postTable } from './post'

export const commentTable = pgTable(
  'comments',
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
    parentId: uuid('parent_id').references((): AnyPgColumn => commentTable.id, {
      onDelete: 'cascade',
    }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').$onUpdate(() => /* @__PURE__ */ new Date()),
  },
  (table) => ({
    postIdIdx: index('comment_post_id_idx').on(table.postId),
    parentIdIdx: index('comment_parent_id_idx').on(table.parentId),
  })
)

export type Comment = typeof commentTable.$inferSelect
export type NewComment = typeof commentTable.$inferInsert
