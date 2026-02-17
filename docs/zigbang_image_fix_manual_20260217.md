# 직방 이미지 수집 이슈 정리 (직방 v3 상세 보강)

## 요약
- 원인: 직방 목록 API(`v2/items/...`)는 썸네일(`images_thumbnail`)만 주고, 상세 API의 다중 이미지 배열(`images`)은 별도로 조회해야 함.
- 추가로 상세 `item.area`는 객체(`{ 전용면적M2: ... }`)로 오기 때문에 기존 파서가 `size_m2` 해석 없이 섞이면 면적/필터/정규화가 흔들릴 수 있었음.

## 변경 파일
1. `scripts/zigbang_auto_collector.mjs`
2. `scripts/adapters/zigbang_listings_adapter.mjs`

## 변경 내용
### 1) 상세 API 병합 강화
- `item_id` 기준으로 `https://apis.zigbang.com/v3/items/{id}?version=&domain=zigbang` 를 조회해 상세 데이터 보강.
- `mergeZigbangDetail()`에서 보강 항목 반영:
  - `price.deposit`, `price.rent`
  - `area.전용면적M2`를 `size_m2`/`area` 계열로 정규화
  - `serviceType`, `salesType`, `roomDirection`, `roomType`
  - `floor.floor`, `floor.allFloors`
  - `randomLocation`, `location`
  - `images` 배열
- 상세 병합 통계를 메타(`detailImageEnrichment`)에 기록: `attempted/success/failed/skipped`.

### 2) 어댑터 이미지 추출 보강
- `collectZigbangImageCandidates()`가 `images` 필드와 배열/객체형 이미지 후보를 모두 탐색.
- 상세/원본에서 들어오는 `image`, `imageUrl`, `thumbnail`, `img*` 등 복수 형태를 재귀 수집.
- `postProcess`에서 기존 `item.image_urls`와 병합 후 중복 제거.

### 3) 방향/타입/면적 안정성 보완
- 직방 상세/목록 공통 키셋을 감안해 보조 매핑 보강.
- 방향은 한글 패턴 또는 방향 축약값(`N,S,E,W`)을 한글 방향으로 변환하도록 보완.

## 다음 확인 항목(화면)
- 재수집 후 `source_url`로 직방 상세 이동.
- 해당 건의 `image_urls`가 1장이 아닌 다중 URL(예: `.../1.jpg`, `.../2.jpg` …)인지 확인.
- 면적/층/방향 필드가 `null`만 남지 않는지 확인.

## 실행 예시
- `node scripts/zigbang_auto_collector.mjs --sigungu 종로구 --sample-cap 80 --output-raw /tmp/zigbang_raw.jsonl`
- `node scripts/run_listing_adapters.mjs --platform=zigbang --input /tmp/zigbang_raw.jsonl --output /tmp/zigbang_output.json`
