-- 수집 범위 전면 정정
-- TARGET_DISTRICTS: 성동구, 광진구, 동대문구, 성북구, 중랑구, 노원구, 중구, 종로구

-- 1) address_text에 "서울숲권역" 포함 (수집 레이블이 주소에 잘못 저장된 것)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL AND address_text LIKE '%서울숲권역%';

-- 2) TARGET_DISTRICTS 밖 구 매물 전체 (마포구, 서대문구, 은평구, 도봉구, 강북구, 용산구, 서초구, 강남구 등)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND address_text IS NOT NULL
  AND (
    -- "서울특별시 X구" 형식
    (address_text LIKE '서울%'
     AND SUBSTRING(address_text FROM '서울[특별시]* ([^ ]+구)') IS NOT NULL
     AND SUBSTRING(address_text FROM '서울[특별시]* ([^ ]+구)') NOT IN (
       '성동구','광진구','동대문구','성북구','중랑구','노원구','중구','종로구'
     ))
    -- "X구 " 형식 (서울 prefix 없음)
    OR (address_text !~ '^서울'
        AND address_text ~ '^[^ ]+구 '
        AND SUBSTRING(address_text FROM '^([^ ]+구)') NOT IN (
          '성동구','광진구','동대문구','성북구','중랑구','노원구','중구','종로구'
        ))
  );

-- 3) 중구: bbox 밖 서쪽 (중림동 등, lng < 127.000)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 중구%' OR address_text LIKE '서울 중구%' OR address_text ~ '^중구 ')
  AND lng IS NOT NULL AND lng < 127.000;

-- 4) 종로구: bbox 밖 서쪽·북쪽 (경복궁·북촌 등, lng < 127.000 또는 lat > 37.595)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 종로구%' OR address_text LIKE '서울 종로구%' OR address_text ~ '^종로구 ')
  AND (
    (lng IS NOT NULL AND lng < 127.000)
    OR (lat IS NOT NULL AND lat > 37.595)
  );

-- 5) 성북구: bbox 밖 북쪽 (정릉·길음 등, lat > 37.600)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 성북구%' OR address_text LIKE '서울 성북구%' OR address_text ~ '^성북구 ')
  AND lat IS NOT NULL AND lat > 37.600;

-- 6) 노원구: bbox 밖 서쪽 (도봉구·강북구 침범 영역, lng < 127.050)
UPDATE normalized_listings SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND (address_text LIKE '서울특별시 노원구%' OR address_text LIKE '서울 노원구%' OR address_text ~ '^노원구 ')
  AND lng IS NOT NULL AND lng < 127.050;
