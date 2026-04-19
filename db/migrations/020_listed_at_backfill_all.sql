-- 020_listed_at_backfill_all.sql
-- 목적: 나머지 4개 플랫폼(zigbang, dabang, peterpanz, daangn) 의 기존 매물도
--       raw_listings.payload_json 에서 listed_at 를 즉시 백필한다.
-- 배경: 019 에서는 어댑터 수정만 적용됐기에 이 4개 플랫폼은 재수집 전까지 listed_at 이 NULL.
--       raw payload 에는 이미 원본 등록일이 저장되어 있으므로 지금 바로 백필 가능.

-- 1) zigbang: payload_json->>'reg_date' = "2026-04-10T11:33:42+09:00" → "YYYY-MM-DD HH:MM:SS"
UPDATE normalized_listings nl
   SET listed_at = to_char(
         (rl.payload_json->>'reg_date')::timestamptz AT TIME ZONE 'Asia/Seoul',
         'YYYY-MM-DD HH24:MI:SS'
       )
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'zigbang'
   AND nl.listed_at IS NULL
   AND rl.payload_json->>'reg_date' IS NOT NULL
   AND rl.payload_json->>'reg_date' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';

-- 2) dabang: payload_json->>'saved_time_str' = "2026.04.13" → "YYYY-MM-DD 00:00:00"
UPDATE normalized_listings nl
   SET listed_at = replace(rl.payload_json->>'saved_time_str', '.', '-') || ' 00:00:00'
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'dabang'
   AND nl.listed_at IS NULL
   AND rl.payload_json->>'saved_time_str' ~ '^\d{4}\.\d{2}\.\d{2}$';

-- 3) peterpanz: info.live_start_date → 이미 "2026-03-23 00:00:00" 포맷
--    naverUpdatedAt 이 있으면 더 정밀(초 단위)이므로 우선 사용
UPDATE normalized_listings nl
   SET listed_at = COALESCE(
         rl.payload_json->'attribute'->>'naverUpdatedAt',
         rl.payload_json->'info'->>'live_start_date'
       )
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'peterpanz'
   AND nl.listed_at IS NULL
   AND COALESCE(
         rl.payload_json->'attribute'->>'naverUpdatedAt',
         rl.payload_json->'info'->>'live_start_date'
       ) ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$';

-- 4) daangn: _detail.createdAt = "2026-04-09T07:08:39.944Z" (UTC) → KST 변환
UPDATE normalized_listings nl
   SET listed_at = to_char(
         (rl.payload_json->'_detail'->>'createdAt')::timestamptz AT TIME ZONE 'Asia/Seoul',
         'YYYY-MM-DD HH24:MI:SS'
       )
  FROM raw_listings rl
 WHERE rl.raw_id = nl.raw_id
   AND nl.platform_code = 'daangn'
   AND nl.listed_at IS NULL
   AND rl.payload_json->'_detail'->>'createdAt' IS NOT NULL
   AND rl.payload_json->'_detail'->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}';
