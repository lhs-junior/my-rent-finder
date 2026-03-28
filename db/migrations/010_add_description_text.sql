-- 매물 상세 설명 텍스트 저장 컬럼
ALTER TABLE normalized_listings
ADD COLUMN IF NOT EXISTS description_text TEXT;
