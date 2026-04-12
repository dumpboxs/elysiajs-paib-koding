import { relations } from 'drizzle-orm'

import { accountTable, sessionTable, userTable } from '#/db/schemas/auth'
import { commentTable } from '#/db/schemas/comments'
import { likeTable } from '#/db/schemas/likes'
import { postTable } from '#/db/schemas/post'
import { viewTable } from '#/db/schemas/views'

export const userRelations = relations(userTable, ({ many }) => ({
  sessions: many(sessionTable),
  accounts: many(accountTable),
  posts: many(postTable),
  likes: many(likeTable),
  comments: many(commentTable),
  views: many(viewTable),
}))

export const sessionRelations = relations(sessionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [sessionTable.userId],
    references: [userTable.id],
  }),
}))

export const accountRelations = relations(accountTable, ({ one }) => ({
  user: one(userTable, {
    fields: [accountTable.userId],
    references: [userTable.id],
  }),
}))

export const postRelations = relations(postTable, ({ one, many }) => ({
  author: one(userTable, {
    fields: [postTable.authorId],
    references: [userTable.id],
  }),
  likes: many(likeTable),
  comments: many(commentTable),
  views: many(viewTable),
}))

export const likeRelations = relations(likeTable, ({ one }) => ({
  post: one(postTable, {
    fields: [likeTable.postId],
    references: [postTable.id],
  }),
  user: one(userTable, {
    fields: [likeTable.userId],
    references: [userTable.id],
  }),
}))

export const commentRelations = relations(commentTable, ({ one, many }) => ({
  post: one(postTable, {
    fields: [commentTable.postId],
    references: [postTable.id],
  }),
  user: one(userTable, {
    fields: [commentTable.userId],
    references: [userTable.id],
  }),
  parent: one(commentTable, {
    fields: [commentTable.parentId],
    references: [commentTable.id],
    relationName: 'commentReplies',
  }),
  replies: many(commentTable, {
    relationName: 'commentReplies',
  }),
}))

export const viewRelations = relations(viewTable, ({ one }) => ({
  post: one(postTable, {
    fields: [viewTable.postId],
    references: [postTable.id],
  }),
  user: one(userTable, {
    fields: [viewTable.userId],
    references: [userTable.id],
  }),
}))
