ALTER TABLE posts
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(content, '')), 'B')
) STORED;--> statement-breakpoint
CREATE INDEX idx_posts_search
ON posts
USING GIN(search_vector);
