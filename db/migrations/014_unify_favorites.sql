-- 014: user_favorites → pin_favorites 통합
-- 비인증 찜을 pin_hash='__anon__'으로 pin_favorites에 통합
-- 이후 favorites API는 pin_favorites만 사용

INSERT INTO pin_favorites (pin_hash, listing_id, added_at)
SELECT '__anon__', uf.listing_id, uf.created_at
FROM user_favorites uf
WHERE EXISTS (
  SELECT 1 FROM normalized_listings nl
  WHERE nl.listing_id = uf.listing_id AND nl.deleted_at IS NULL
)
ON CONFLICT DO NOTHING;
