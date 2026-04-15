-- 017: 지하철 도보시간 + 주차 가능 여부 컬럼 추가 (네이버 상세 API)
ALTER TABLE normalized_listings
ADD COLUMN IF NOT EXISTS walk_time_to_subway SMALLINT,
ADD COLUMN IF NOT EXISTS parking_possible BOOLEAN;

COMMENT ON COLUMN normalized_listings.walk_time_to_subway IS '지하철까지 도보 시간(분), 네이버: walkingTimeToNearSubway';
COMMENT ON COLUMN normalized_listings.parking_possible IS '주차 가능 여부, 네이버: parkingPossibleYN';
