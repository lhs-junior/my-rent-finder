-- 021_subway_distance.sql
-- 목적: 매물 → 최근접 지하철역 거리 필터링을 위한 구조.
-- subway_stations 테이블로 서울 지하철역 좌표를 보관하고,
-- normalized_listings 에 최근접역 정보를 캐시한다.

CREATE TABLE IF NOT EXISTS subway_stations (
  station_id  BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  lines       JSONB NOT NULL DEFAULT '[]'::jsonb,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, lat, lng)
);

CREATE INDEX IF NOT EXISTS idx_subway_stations_coord
    ON subway_stations (lat, lng);

-- normalized_listings 에 캐시 컬럼
ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS nearest_subway_station TEXT,
  ADD COLUMN IF NOT EXISTS nearest_subway_line    TEXT,
  ADD COLUMN IF NOT EXISTS subway_distance_m      INTEGER,
  ADD COLUMN IF NOT EXISTS subway_walk_min        SMALLINT;

-- 필터/정렬용 부분 인덱스 (활성 매물만)
CREATE INDEX IF NOT EXISTS idx_normalized_subway_distance
    ON normalized_listings (subway_distance_m)
 WHERE deleted_at IS NULL AND subway_distance_m IS NOT NULL;
