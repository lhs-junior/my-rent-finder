-- db/migrations/009_pin_user_profiles.sql

-- PIN은 SHA-256 해시로 저장 (raw PIN 미저장)
CREATE TABLE IF NOT EXISTS user_profiles (
  pin_hash  TEXT PRIMARY KEY,
  my_capital  TEXT,
  my_income   TEXT,
  ltv_ratio   TEXT,
  loan_type   TEXT,
  dti_limit   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pin_favorites (
  pin_hash    TEXT NOT NULL,
  listing_id  INTEGER NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pin_hash, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_pin_favorites_pin
  ON pin_favorites(pin_hash);
