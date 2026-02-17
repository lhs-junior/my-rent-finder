-- 006: Add user_favorites table for persistent bookmarking
-- Single-user project — no user_id needed

CREATE TABLE IF NOT EXISTS user_favorites (
  favorite_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_created ON user_favorites(created_at DESC);
