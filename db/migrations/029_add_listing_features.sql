-- 029_add_listing_features.sql
-- normalized_listings에 features JSONB 컬럼 추가.
-- 다방 detail API의 옵션/안전시설/관리비/난방/주차 등 풍부한 attribute를 통째로 보관.
-- 다른 플랫폼도 같은 컬럼에 자기 형태로 채울 수 있도록 schema-less.

ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS features JSONB;

COMMENT ON COLUMN normalized_listings.features IS
  '플랫폼별 매물 attribute(옵션/안전시설/관리비/난방/주차/태그 등). 키는 플랫폼 어댑터가 결정.';

-- features.options 안의 항목으로 검색하는 일이 잦으면 GIN 인덱스 추가 가능.
-- 지금은 read-write 비용 최소화를 위해 인덱스 없이 시작.
