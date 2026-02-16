CREATE TABLE IF NOT EXISTS listing_attrs (
  attr_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  attr_key TEXT NOT NULL,
  attr_value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'collector',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, attr_key, source)
);
CREATE INDEX IF NOT EXISTS idx_listing_attrs_key ON listing_attrs(attr_key, attr_value);
