-- Database schema v1 (PostgreSQL)
-- Scope: 서울 매물 통합(개인 사용) 1차 MVP

CREATE TABLE IF NOT EXISTS platform_codes (
  platform_code TEXT PRIMARY KEY,
  platform_name TEXT NOT NULL,
  collection_mode TEXT NOT NULL CHECK (collection_mode IN ('API', 'STEALTH_AUTOMATION', 'BLOCKED')) DEFAULT 'STEALTH_AUTOMATION',
  home_url TEXT,
  policy_check_at TIMESTAMPTZ,
  last_fail_code TEXT,
  policy_state JSONB DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_runs (
  run_id TEXT PRIMARY KEY,
  platform_code TEXT NOT NULL REFERENCES platform_codes(platform_code),
  mode TEXT NOT NULL CHECK (mode IN ('API', 'STEALTH_AUTOMATION', 'BLOCKED')),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'RUNNING', 'DONE', 'FAILED', 'PARTIAL', 'BLOCKED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  query_city TEXT,
  query_district TEXT,
  query_dong TEXT,
  target_min_rent INTEGER,
  target_max_rent INTEGER,
  target_min_area REAL,
  extra JSONB DEFAULT '{}'::jsonb,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_platform ON collection_runs(platform_code, started_at DESC);

CREATE TABLE IF NOT EXISTS raw_listings (
  raw_id BIGSERIAL PRIMARY KEY,
  platform_code TEXT NOT NULL REFERENCES platform_codes(platform_code),
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  page_snapshot TEXT,
  collected_at TIMESTAMPTZ NOT NULL,
  parsed_at TIMESTAMPTZ,
  run_id TEXT REFERENCES collection_runs(run_id),
  raw_status TEXT NOT NULL DEFAULT 'FETCHED' CHECK (raw_status IN ('FETCHED', 'PARSING', 'PARSE_FAILED', 'NORMALIZED', 'REJECTED')),
  raw_area_unit TEXT,
  raw_price_unit TEXT,
  parse_error_code TEXT,
  raw_fingerprint TEXT,
  raw_hash BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform_code, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_listings_platform ON raw_listings(platform_code, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_listings_status ON raw_listings(raw_status, platform_code);
CREATE INDEX IF NOT EXISTS idx_raw_listings_collected ON raw_listings(collected_at DESC);

CREATE TABLE IF NOT EXISTS normalized_listings (
  listing_id BIGSERIAL PRIMARY KEY,
  raw_id BIGINT NOT NULL REFERENCES raw_listings(raw_id),
  platform_code TEXT NOT NULL REFERENCES platform_codes(platform_code),
  external_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  lease_type TEXT NOT NULL CHECK (lease_type IN ('월세', '전세', '단기', '기타')),
  rent_amount REAL,
  deposit_amount REAL,
  area_exclusive_m2 REAL,
  area_exclusive_m2_min REAL,
  area_exclusive_m2_max REAL,
  area_gross_m2 REAL,
  area_gross_m2_min REAL,
  area_gross_m2_max REAL,
  area_claimed TEXT NOT NULL CHECK (area_claimed IN ('exclusive', 'gross', 'range', 'estimated')),
  address_text TEXT NOT NULL,
  address_code TEXT NOT NULL,
  room_count INTEGER,
  bathroom_count INTEGER,
  floor INTEGER,
  total_floor INTEGER,
  direction TEXT,
  building_use TEXT,
  building_name TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  listed_at TEXT,
  available_date TEXT,
  source_ref TEXT NOT NULL,
  quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform_code, external_id),
  UNIQUE (source_ref)
);

CREATE INDEX IF NOT EXISTS idx_normalized_platform ON normalized_listings(platform_code, address_code, rent_amount, room_count);
CREATE INDEX IF NOT EXISTS idx_normalized_updated ON normalized_listings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_address ON normalized_listings(address_code, lease_type);

CREATE TABLE IF NOT EXISTS listing_images (
  image_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  raw_id BIGINT NOT NULL REFERENCES raw_listings(raw_id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  local_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'downloaded', 'failed', 'skipped')),
  width INTEGER,
  height INTEGER,
  file_size_bytes BIGINT,
  sha256 TEXT,
  phash TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_listing_image_source_url UNIQUE (listing_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_listing_images_source_url ON listing_images(source_url);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images(listing_id, status);

CREATE TABLE IF NOT EXISTS contract_violations (
  violation_id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('RAW', 'NORMALIZED', 'IMAGE', 'MATCHER', 'COLLECTION')),
  scope_id TEXT NOT NULL,
  platform_code TEXT REFERENCES platform_codes(platform_code),
  raw_id BIGINT REFERENCES raw_listings(raw_id),
  listing_id BIGINT REFERENCES normalized_listings(listing_id),
  violation_code TEXT NOT NULL,
  message TEXT,
  detail JSONB DEFAULT '{}'::jsonb,
  severity TEXT NOT NULL CHECK (severity IN ('ERROR', 'WARN')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_scope ON contract_violations(platform_code, violation_code, severity);

CREATE TABLE IF NOT EXISTS matcher_runs (
  matcher_run_id BIGSERIAL PRIMARY KEY,
  algorithm_version TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  candidates INT NOT NULL DEFAULT 0,
  auto_match_count INT NOT NULL DEFAULT 0,
  review_required_count INT NOT NULL DEFAULT 0,
  distinct_count INT NOT NULL DEFAULT 0,
  threshold_json JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  run_meta JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS listing_matches (
  match_id BIGSERIAL PRIMARY KEY,
  matcher_run_id BIGINT NOT NULL REFERENCES matcher_runs(matcher_run_id),
  source_listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id),
  target_listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id),
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  distance_score REAL NOT NULL DEFAULT 0,
  address_score REAL NOT NULL DEFAULT 0,
  area_score REAL NOT NULL DEFAULT 0,
  price_score REAL NOT NULL DEFAULT 0,
  attribute_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('AUTO_MATCH', 'REVIEW_REQUIRED', 'DISTINCT')),
  reason_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_match_pair UNIQUE (matcher_run_id, source_listing_id, target_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_matches_status ON listing_matches(status, matcher_run_id);

CREATE TABLE IF NOT EXISTS match_groups (
  group_id BIGSERIAL PRIMARY KEY,
  matcher_run_id BIGINT NOT NULL REFERENCES matcher_runs(matcher_run_id),
  canonical_key TEXT NOT NULL,
  canonical_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (canonical_status IN ('OPEN', 'CLOSED', 'CONFLICT')),
  reason_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_group_members (
  group_id BIGINT NOT NULL REFERENCES match_groups(group_id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id),
  score REAL NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_match_group_members_listing ON match_group_members(listing_id);

CREATE TABLE IF NOT EXISTS quality_reports (
  report_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  completeness_score REAL NOT NULL DEFAULT 0,
  field_confidence REAL NOT NULL DEFAULT 0,
  stale_hours INTEGER NOT NULL DEFAULT 0,
  hallucination_risk REAL NOT NULL DEFAULT 0,
  review_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS image_fetch_jobs (
  image_job_id BIGSERIAL PRIMARY KEY,
  listing_id BIGINT NOT NULL REFERENCES normalized_listings(listing_id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('LIST_VIEW', 'COMPARE_VIEW', 'BOOKMARK', 'MANUAL')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  failure_reason TEXT
);
