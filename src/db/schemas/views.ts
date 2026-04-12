import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { userTable } from './auth'
import { postTable } from './post'

export const viewTable = pgTable(
  'views',
  {
    id: uuid('id')
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    postId: uuid('post_id')
      .notNull()
      .references(() => postTable.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => userTable.id, {
      onDelete: 'cascade',
    }),
    viewerIp: text('viewer_ip'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    postIdIdx: index('view_post_id_idx').on(table.postId),
  })
)

export type View = typeof viewTable.$inferSelect
export type NewView = typeof viewTable.$inferInsert
