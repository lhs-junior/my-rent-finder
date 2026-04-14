-- 교차 플랫폼 참조 컬럼 추가
-- serve.co.kr의 naverAtclNo → naver external_id 교차 중복 제거에 사용
ALTER TABLE normalized_listings ADD COLUMN IF NOT EXISTS cross_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_normalized_cross_ref ON normalized_listings(cross_ref) WHERE cross_ref IS NOT NULL;

COMMENT ON COLUMN normalized_listings.cross_ref IS '교차 플랫폼 참조 ID (예: serve의 naverAtclNo → naver external_id)';
