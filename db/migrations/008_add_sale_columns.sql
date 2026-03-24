-- db/migrations/008_add_sale_columns.sql

-- 1. lease_type CHECK 확장: '매매' 추가
ALTER TABLE normalized_listings
  DROP CONSTRAINT IF EXISTS normalized_listings_lease_type_check;
ALTER TABLE normalized_listings
  ADD CONSTRAINT normalized_listings_lease_type_check
    CHECK (lease_type IN ('월세', '전세', '단기', '기타', '매매'));

-- 2. 매매 전용 컬럼
ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS sale_price INTEGER,
  ADD COLUMN IF NOT EXISTS loan_amount INTEGER,
  ADD COLUMN IF NOT EXISTS building_year INTEGER;

CREATE INDEX IF NOT EXISTS idx_listings_sale
  ON normalized_listings(lease_type, sale_price)
  WHERE lease_type = '매매';

-- 3. 설정 저장 테이블
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
