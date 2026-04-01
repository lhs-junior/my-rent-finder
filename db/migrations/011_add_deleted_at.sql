-- 011: Add deleted_at column for soft-delete support
ALTER TABLE normalized_listings
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_deleted_at
ON normalized_listings(deleted_at) WHERE deleted_at IS NOT NULL;

-- Partial index for active listings (deleted_at IS NULL) — used by most queries
CREATE INDEX IF NOT EXISTS idx_listings_active
ON normalized_listings(platform_code, updated_at DESC) WHERE deleted_at IS NULL;
