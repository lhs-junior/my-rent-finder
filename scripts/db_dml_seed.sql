-- v1 DML templates (샘플)

INSERT INTO platform_codes (platform_code, platform_name, collection_mode, home_url)
VALUES
  ('zigbang', '직방', 'STEALTH_AUTOMATION', 'https://www.zigbang.com'),
  ('dabang', '다방', 'STEALTH_AUTOMATION', 'https://www.dabangapp.com'),
  ('naver', '네이버 부동산', 'STEALTH_AUTOMATION', 'https://new.land.naver.com'),
  ('r114', '부동산114', 'STEALTH_AUTOMATION', 'https://www.r114.com')
ON CONFLICT (platform_code) DO UPDATE
SET platform_name = EXCLUDED.platform_name,
    collection_mode = EXCLUDED.collection_mode,
    updated_at = NOW();

-- 원시 저장
INSERT INTO raw_listings (
  platform_code, external_id, source_url, payload_json, collected_at, parsed_at, raw_status, run_id
) VALUES (
  'zigbang',
  'Z1001',
  'https://example.com/zigbang/1001',
  '{
    "title":"역삼동 원룸",
    "price":{"monthly_rent":"75","deposit":"500"},
    "area":{"exclusive_m2":36.3,"area_type":"exclusive"}
  }'::jsonb,
  NOW(),
  NOW(),
  'PARSE_FAILED',
  'run_demo'
) ON CONFLICT (platform_code, external_id) DO NOTHING;

-- 정규화 저장 (동일 external_id가 있다면 UPDATE)
WITH src AS (
  SELECT raw_id
  FROM raw_listings
  WHERE platform_code='zigbang' AND external_id='Z1001'
  LIMIT 1
)
INSERT INTO normalized_listings (
  raw_id, platform_code, external_id, canonical_key, source_url, title,
  lease_type, rent_amount, deposit_amount, area_exclusive_m2, area_claimed,
  address_text, address_code, room_count, floor, total_floor, direction, building_use, source_ref, quality_flags
)
SELECT raw_id, 'zigbang', 'Z1001', 'key_z_1001', 'https://example.com/zigbang/1001',
       '역삼동 원룸', '월세', 75, 500, 36.3, 'exclusive',
       '서울특별시 강남구 역삼동 123-45', '1168010100', 1, 12, 15, '남향', '빌라/연립',
       'run_demo:Z1001', '[]'::jsonb
FROM src
ON CONFLICT (platform_code, external_id) DO UPDATE
SET rent_amount = EXCLUDED.rent_amount,
    deposit_amount = EXCLUDED.deposit_amount,
    area_exclusive_m2 = EXCLUDED.area_exclusive_m2,
    updated_at = NOW();

-- 매칭 실행 결과 저장 (예시)
INSERT INTO matcher_runs (
  algorithm_version, rule_version, candidates, auto_match_count, review_required_count, distinct_count, threshold_json, started_at, finished_at
) VALUES (
  'matcher_v1', 'v0.1', 3, 1, 1, 1,
  '{"autoMatch":93,"reviewRequiredMin":80}'::jsonb,
  NOW(), NOW()
) RETURNING matcher_run_id;

-- 이미지 저장 제한 정책 적용 예시 조회
SELECT listing_id, COUNT(*) AS active_imgs
FROM listing_images
WHERE status = 'downloaded'
GROUP BY listing_id
HAVING COUNT(*) > 2;
