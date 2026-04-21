-- 수집 범위 정정
-- 1) 서울숲권역 오주소 매물: address_text에 행정구역 아닌 수집 레이블이 저장된 것 제거
-- 2) 중구·종로구 범위 밖 매물: 서쪽(lng < 127.000) 동네 제거
--    남기는 지역 — 중구: 신당동·황학동 일대(신당역), 종로구: 창신동·숭인동(창신역·동묘앞역)
--    제거 지역 — 중구 중림동 등(lng < 127.000), 종로구 서부·북부(lng < 127.000 또는 lat > 37.595)

-- 1) address_text에 "서울숲권역" 포함 매물
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND address_text LIKE '%서울숲권역%';

-- 2) 중구 중 bbox 밖 (서쪽: lng < 127.000)
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 중구%' OR address_text LIKE '서울 중구%' OR address_text ~ '^중구 ')
  AND lng IS NOT NULL
  AND lng < 127.000;

-- 3) 종로구 중 bbox 밖 (서쪽: lng < 127.000 또는 북쪽: lat > 37.595)
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 종로구%' OR address_text LIKE '서울 종로구%' OR address_text ~ '^종로구 ')
  AND (
    (lng IS NOT NULL AND lng < 127.000)
    OR (lat IS NOT NULL AND lat > 37.595)
  );
