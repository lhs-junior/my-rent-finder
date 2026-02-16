# Data Contract v0.2 (수집·정규화·검증)

## 1. 목표
플랫폼별 원문 데이터를 보존하고, 개인용 탐색에 필요한 핵심값은 정규화한다.  
추정치와 원문값은 분리 저장하고, 위반은 `contract_violations`로 감사 가능하게 남긴다.

## 2. Raw 수집 계약 (`raw_payload`)

### 2.1 공통 필수
- `collection_run_id` (string)
- `platform_code` (string)
- `external_id` (string, 플랫폼 고유 ID)
- `source_url` (절대 URL)
- `collected_at` (ISO 8601)
- `payload` (object)

### 2.2 권장 필수
- `payload.raw`  
  - `title`  
  - `price.monthly_rent`  
  - `price.deposit`  
  - `area.exclusive_m2`  
  - `area.gross_m2`  
  - `area.area_type` (`exclusive|gross|range|estimated`)  
  - `address.address_raw`  
  - `address.sido`, `address.sigungu`, `address.dong`  
  - `building.floor`, `building.total_floor`, `building.direction`, `building.usage`  
  - `unit.room_count`, `unit.bathroom_count`  
  - `listing_type` (`원룸|투룸|쓰리룸|오피스텔|아파트|빌라/연립|단독/다가구|상가주택|기타`)  
  - `images` (최대 N개 URL)  
  - `raw_text`  
- `page_snapshot` (원본 HTML/JSON/이미지 참조)

### 2.3 규칙
- raw 값의 추정치(derived)는 원문 자리로 넣지 않는다.
- 값 누락 시 `null` 또는 `MISSING`이 아니라 필드별 위반 코드 기록.
- 동일 플랫폼 동일 `external_id`는 충돌 없이 upsert 가능해야 함.

## 3. 정규화 계약 (`normalized`)

### 3.1 정규화 필수
- `platform_code`, `external_id`
- `canonical_key`
- `source_url`
- `address_text`, `address_code`
- `lease_type` (`월세|전세|단기|기타`)
- `rent_amount`, `deposit_amount`
  - `area_exclusive_m2`, `area_gross_m2`
  - `area_claimed` (`exclusive|gross|range|estimated`)
  - `room_count`, `floor`, `total_floor`, `direction`, `building_use`
  - `source_ref` (raw FK)
  - `quality_flags`
  - `created_at`, `updated_at`

### 3.2 타입
- 숫자: `rent_amount`, `deposit_amount`, `area_*`, `floor`, `total_floor`, `room_count`, `bathroom_count`
- 문자열: 주소 텍스트, 지역코드, 플랫폼코드, 계약유형
- JSONB: `facility_list`, `raw_attrs`, `errors`

### 3.3 면적 규칙
- 전용면적만 있으면 `area_claimed=exclusive`
- 공용면적만 있으면 `area_claimed=gross`
- 범위면적은 `area_exclusive_m2_min`/`area_exclusive_m2_max` 또는 `area_gross_m2_min`/`area_gross_m2_max`로 저장
- 평수 입력은 `3.3058` 곱하여 ㎡ 저장

### 3.4 가격 규칙
- 월세/보증금은 숫자변환 후 저장 (`협의`, `문의`는 `null`)
- 월세,보증금 둘 다 누락은 `REQUIRED_MISSING` 경고

## 4. 이미지 계약
- 기본 저장: 목록 조회당 `max 2장`만 즉시 처리
- 지연 저장: 상세열람·즐겨찾기 이벤트 시 추가 수집
- `image` 객체:
  - `source_url` (필수)
  - `local_path` (nullable)
  - `status` (`queued|downloaded|failed|skipped`)
  - `sha256` optional
  - `phash` optional

## 5. 매칭 계약

### 5.1 입력
- `candidate_listing_id`, `target_listing_id`
- `score` (0~100)
- `distance_score`, `address_score`, `area_score`, `price_score`, `attribute_score`
- `reason_json`

### 5.2 상태
- `AUTO_MATCH`
- `REVIEW_REQUIRED`
- `DISTINCT`

### 5.3 면적 동일성 규칙
- 전용/전용: 상대오차 6% 이내 가산
- 공용/전용: 비율 1.05~1.35 허용
- 범위형: 구간 겹침이 존재하면 보조 후보군 생성

## 6. 검증 오류 코드(최초)

### 필드/타입
- `REQ_FIELD_MISSING`
- `REQ_FIELD_TYPE_MISMATCH`
- `URL_INVALID`

### 파싱
- `AREA_PARSE_FAIL`
- `AREA_UNIT_UNKNOWN`
- `PRICE_PARSE_FAIL`
- `FLOOR_PARSE_FAIL`
- `ADDRESS_NORMALIZE_FAIL`
- `IMAGE_URL_INVALID`

### 계약/운영
- `CONTRACT_MODE_MISMATCH`
- `DUPLICATE_KEY_POSSIBLE`
- `RATE_LIMIT_TRIGGER`
- `SOURCE_ACCESS_BLOCKED`
- `CONTRACT_FAIL`

### 위반 분류 처리
- `ERROR`: 저장/매칭 게이트(사용 제한)
- `WARN`: 저장은 허용하되 UI 경고 및 신뢰도 하향

## 7. 출력 규칙(검증 리포트)
- `valid`: error 레벨의 `ERROR`가 0일 때 true
- `counts`: `ERROR`, `WARN` 건수
- `errors`: 코드, 경로, 레벨, 상세 메시지

## 8. 버전
- 현재 버전: `listing_contract_v0.2`
- 변경 시 `schema_version`을 증가시켜 마이그레이션 경로 보존
