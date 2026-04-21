-- 노원구 전체 수집 제외 — 도봉구·강북구 접경으로 불필요 지역 판단
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (
    address_text LIKE '서울특별시 노원구%'
    OR address_text LIKE '서울 노원구%'
    OR address_text ~ '^노원구 '
  );
