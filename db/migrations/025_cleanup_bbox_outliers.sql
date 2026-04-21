-- bbox 이탈 매물 추가 정리
-- 024에서 누락된 케이스 + 새로 발견된 bbox 밖 매물

-- 1) 성북구 서쪽 (lng < 127.000) — 024에서 누락
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 성북구%' OR address_text LIKE '서울 성북구%' OR address_text ~ '^성북구 ')
  AND lng IS NOT NULL AND lng < 127.000;

-- 2) 중랑구: 서쪽 lng < 127.055 — 회기동(동대문구), 장위동·석관동(성북구) 오기입 매물
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 중랑구%' OR address_text LIKE '서울 중랑구%' OR address_text ~ '^중랑구 ')
  AND lng IS NOT NULL AND lng < 127.055;

-- 3) 광진구: 남쪽 bbox 밖 (lat < 37.517)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 광진구%' OR address_text LIKE '서울 광진구%' OR address_text ~ '^광진구 ')
  AND lat IS NOT NULL AND lat < 37.517;

-- 4) 광진구: 동쪽 bbox 밖 (lng > 127.113)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 광진구%' OR address_text LIKE '서울 광진구%' OR address_text ~ '^광진구 ')
  AND lng IS NOT NULL AND lng > 127.113;

-- 5) 성북구 북쪽 (lat > 37.600) — 024 이후 재수집된 정릉동 등
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 성북구%' OR address_text LIKE '서울 성북구%' OR address_text ~ '^성북구 ')
  AND lat IS NOT NULL AND lat > 37.600;
