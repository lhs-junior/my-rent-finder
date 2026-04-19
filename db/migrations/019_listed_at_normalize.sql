-- 019_listed_at_normalize.sql
-- 목적: normalized_listings.listed_at 포맷을 "YYYY-MM-DD HH:MM:SS"로 통일하고
--       정렬용 인덱스를 추가한다.
-- 배경: 기존 네이버 수집분은 "YYYYMMDD" 포맷으로 저장되어 있어 최신순 정렬이 불가.

-- 1) 네이버 YYYYMMDD → "YYYY-MM-DD 00:00:00"
UPDATE normalized_listings
   SET listed_at = substring(listed_at, 1, 4) || '-'
                || substring(listed_at, 5, 2) || '-'
                || substring(listed_at, 7, 2) || ' 00:00:00'
 WHERE listed_at ~ '^\d{8}$';

-- 2) 점 구분자 "YYYY.MM.DD" → "YYYY-MM-DD 00:00:00"
UPDATE normalized_listings
   SET listed_at = replace(listed_at, '.', '-') || ' 00:00:00'
 WHERE listed_at ~ '^\d{4}\.\d{2}\.\d{2}$';

-- 3) kbland: raw_listings.payload_json->>'registeredDate' 에서 listed_at 백필
UPDATE normalized_listings nl
   SET listed_at = replace(rl.payload_json->>'registeredDate', '.', '-') || ' 00:00:00'
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'kbland'
   AND nl.listed_at IS NULL
   AND rl.payload_json->>'registeredDate' ~ '^\d{4}\.\d{2}\.\d{2}$';

-- 4) serve: raw_listings.payload_json->>'atclRegDttm' 백필
UPDATE normalized_listings nl
   SET listed_at = rl.payload_json->>'atclRegDttm'
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'serve'
   AND nl.listed_at IS NULL
   AND rl.payload_json->>'atclRegDttm' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$';

-- 5) 정렬용 인덱스 (deleted_at IS NULL 파셔닝)
CREATE INDEX IF NOT EXISTS idx_normalized_listed_at
    ON normalized_listings (listed_at DESC NULLS LAST)
 WHERE deleted_at IS NULL;
