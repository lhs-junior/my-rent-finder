CREATE TABLE IF NOT EXISTS listing_price_history (
  history_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  rent_amount REAL,
  deposit_amount REAL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_rent REAL,
  previous_deposit REAL,
  run_id TEXT REFERENCES collection_runs(run_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_history_listing ON listing_price_history(listing_id, detected_at DESC);
