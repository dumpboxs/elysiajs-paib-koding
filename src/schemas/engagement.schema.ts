import { z } from 'zod'

export const postIdQuerySchema = z.object({
  postId: z.string().uuid(),
})

export type PostIdQuerySchema = z.infer<typeof postIdQuerySchema>

export const toggleLikeBodySchema = z.object({
  postId: z.string().uuid(),
})

export type ToggleLikeBodySchema = z.infer<typeof toggleLikeBodySchema>

export const createCommentBodySchema = z.object({
  postId: z.string().uuid(),
  content: z.string().trim().min(1).max(2000),
  parentId: z.string().uuid().optional(),
})

export type CreateCommentBodySchema = z.infer<typeof createCommentBodySchema>

export const updateCommentBodySchema = z.object({
  content: z.string().trim().min(1).max(2000),
})

export type UpdateCommentBodySchema = z.infer<typeof updateCommentBodySchema>

export const getCommentsQuerySchema = z.object({
  postId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type GetCommentsQuerySchema = z.infer<typeof getCommentsQuerySchema>

export const commentParamsSchema = z.object({
  id: z.string().uuid(),
})

export type CommentParamsSchema = z.infer<typeof commentParamsSchema>

export const trackViewBodySchema = z.object({
  postId: z.string().uuid(),
})

export type TrackViewBodySchema = z.infer<typeof trackViewBodySchema>
