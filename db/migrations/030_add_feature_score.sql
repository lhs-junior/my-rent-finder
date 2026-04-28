-- 030_add_feature_score.sql
-- AI 배점에 features 활용 — feature_score 0~2점 추가.
--   parking.possible=true → +1
--   elevator='있음' OR options.length>=5 (풀옵션) → +1

ALTER TABLE scored_listings
  ADD COLUMN IF NOT EXISTS feature_score SMALLINT DEFAULT 0;

COMMENT ON COLUMN scored_listings.feature_score IS
  'features 기반 가점 (0~2): 주차+1, 엘리베이터/풀옵션+1';
