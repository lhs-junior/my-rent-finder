-- 수집 범위 정정: 서울숲권역 오주소 매물 + 중구·종로구 매물 soft-delete
-- 원인: "서울숲권역"이 행정구역이 아닌 수집 범위 레이블이었으나 address_text에 노출됨
--       중구·종로구는 서울숲/뚝섬 권역과 무관하여 수집 대상에서 제외

-- 1) address_text에 "서울숲권역"이 포함된 매물 (잘못 저장된 주소)
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND address_text LIKE '%서울숲권역%';

-- 2) 중구 매물 (서울특별시 중구 / "중구 " 시작)
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    address_text LIKE '서울특별시 중구%'
    OR address_text LIKE '서울 중구%'
    OR address_text ~ '^중구 '
  );

-- 3) 종로구 매물
UPDATE normalized_listings
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    address_text LIKE '서울특별시 종로구%'
    OR address_text LIKE '서울 종로구%'
    OR address_text ~ '^종로구 '
  );
