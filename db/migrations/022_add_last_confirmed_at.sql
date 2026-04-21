-- 022_add_last_confirmed_at.sql
-- 목적: 매 수집마다 "마지막으로 확인된 시각"을 추적하는 컬럼 추가.
-- listed_at(플랫폼 등록일)은 불변이지만, last_confirmed_at은 수집할 때마다 NOW()로 갱신됨.
-- 프론트엔드에서 "최신 확인순" 정렬에 사용.

ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ DEFAULT NOW();

-- 기존 행 백필: 수집 이력이 있는 행은 updated_at을 초기값으로 사용
UPDATE normalized_listings
SET last_confirmed_at = updated_at
WHERE last_confirmed_at IS NULL;

-- 정렬/필터용 인덱스
CREATE INDEX IF NOT EXISTS idx_normalized_last_confirmed_at
    ON normalized_listings (last_confirmed_at DESC)
 WHERE deleted_at IS NULL;
