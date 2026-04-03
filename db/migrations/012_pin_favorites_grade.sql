-- 012: pin_favorites에 grade 컬럼 추가
-- score_and_pin_favorites.mjs가 SS/S/A 등급을 함께 저장하도록 지원

ALTER TABLE pin_favorites ADD COLUMN IF NOT EXISTS grade TEXT;
