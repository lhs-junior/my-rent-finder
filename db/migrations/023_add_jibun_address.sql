-- 크로스플랫폼 중복 탐지를 위한 지번주소 컬럼 추가
-- kbland: address 필드에서 번지수 추출 (예: "자양동 10-13")
-- naver: _detail.articleDetail.exposureAddress
ALTER TABLE normalized_listings ADD COLUMN IF NOT EXISTS jibun_address TEXT;

CREATE INDEX IF NOT EXISTS idx_normalized_jibun_address
  ON normalized_listings(jibun_address)
  WHERE jibun_address IS NOT NULL;
