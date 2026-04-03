-- 011: pin_favorites에 FK + ON DELETE CASCADE 추가
-- 수집 파이프라인이 normalized_listings를 하드 DELETE할 때
-- pin_favorites orphan 행이 남는 버그 방지

-- 기존 orphan 행 정리
DELETE FROM pin_favorites pf
WHERE NOT EXISTS (
  SELECT 1 FROM normalized_listings nl WHERE nl.listing_id = pf.listing_id
);

-- FK 추가
ALTER TABLE pin_favorites
  ADD CONSTRAINT pin_favorites_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES normalized_listings(listing_id)
  ON DELETE CASCADE;
