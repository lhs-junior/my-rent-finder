-- 013_scored_listings.sql
-- AI 배점 결과를 별도 테이블에 저장 (pin_favorites와 분리)
-- pin_favorites는 유저 수동 찜 전용으로 존속

CREATE TABLE IF NOT EXISTS scored_listings (
  listing_id         INTEGER NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  total_score        SMALLINT NOT NULL,
  grade              TEXT,              -- SS / S / A / B / REJECT
  rpm_score          SMALLINT DEFAULT 0,
  subway_score       SMALLINT DEFAULT 0,
  transfer_score     SMALLINT DEFAULT 0,
  area_score         SMALLINT DEFAULT 0,
  floor_score        SMALLINT DEFAULT 0,
  year_score         SMALLINT DEFAULT 0,
  img_score          SMALLINT DEFAULT 0,
  effective_monthly_cost INTEGER,       -- 실질 월비용 (만원, 보증금 기회비용 포함)
  scored_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id)
);

CREATE INDEX IF NOT EXISTS idx_scored_listings_grade ON scored_listings(grade);
CREATE INDEX IF NOT EXISTS idx_scored_listings_score ON scored_listings(total_score DESC);
