-- 028: pin_favorites FK ON DELETE CASCADE → RESTRICT 변경
-- 수집 파이프라인이 normalized_listings를 하드 DELETE할 때 찜 목록이 사라지는 버그 방지.
-- 코드 레벨(cleanupNormalizedRowsByListingIds, db_cleanup_stale)에서 이미 pin_favorites 걸린
-- listing_id를 하드 삭제 대상에서 제외하지만, DB 레벨에서도 이중 방어.

ALTER TABLE pin_favorites
  DROP CONSTRAINT IF EXISTS pin_favorites_listing_id_fkey;

ALTER TABLE pin_favorites
  ADD CONSTRAINT pin_favorites_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES normalized_listings(listing_id)
  ON DELETE RESTRICT;
