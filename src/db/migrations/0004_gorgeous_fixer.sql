DROP INDEX IF EXISTS idx_posts_search;--> statement-breakpoint
ALTER TABLE posts DROP COLUMN IF EXISTS search_vector;--> statement-breakpoint
ALTER TABLE posts
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(content, '')), 'B')
) STORED;--> statement-breakpoint
CREATE INDEX idx_posts_search
ON posts
USING GIN(search_vector);
