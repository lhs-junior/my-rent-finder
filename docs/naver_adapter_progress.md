# 네이버 부동산 Adapter 진행 상황 (2026-02-15)

## 지금까지 진행한 내용

### 1) 네이버 정규화 품질 업그레이드 반영
- `scripts/naver_normalize.mjs`를 `NaverListingAdapter` 기반으로 교체.
- raw 응답에서 매물 후보 추출 로직을 보강:
  - `articleList`, `complexList`, `body`, `result`, `data` 등 다양한 구조 반영.
  - 매물 유사 객체 탐색 로직으로 오탐/누락 축소.
- 핵심 파서 업그레이드:
  - 가격 파서: `억/만원` 형태 수치 정규화
  - 면적 파서: `㎡`, `평`, 범위(예: 20~25㎡) 처리
  - 층수/방개수/주소/이미지 추출 보강
- 월세/B2 필터 강화:
  - 정규화 단계에서 `월세`(B2) 필터를 지원해 `매매`/`전세` 혼입을 차단.
- 검증/품질 플래그:
  - 주소, 가격, 면적, source_ref, 이미지 URL 누락/형식 오류를 통일된 코드로 기록
- 결과 메트릭을 `requiredFieldsRate`, `imageRate`로 집계해 `docs`에서 바로 판단 가능

### 2) 공통 Adapter 골격 생성
- `scripts/adapters/base_listing_adapter.mjs`
  - raw 파일 라인 단위 파싱
  - 공통 품질 검증 및 메트릭 집계 템플릿
- `scripts/adapters/naver_listings_adapter.mjs`
  - 네이버 전용 정규화/파서 구현
- `scripts/adapters/adapter_registry.mjs`
  - 플랫폼별 어댑터 등록(네이버/직방/다방/부동산114은 READY)
- `scripts/run_listing_adapters.mjs`
  - 어댑터 실행 엔트리포인트
  - `--list` 시 등록 어댑터 목록 출력

## 실행 예시

- 네이버 raw 정규화:
  - `node scripts/naver_normalize.mjs --input scripts/naver_raw_samples.jsonl --output scripts/naver_normalized_samples.json`
- 어댑터 파이프라인(공통 실행):
  - `node scripts/run_listing_adapters.mjs --platform naver --input scripts/naver_raw_samples.jsonl --max-items 200`

## 다음 단계 권고

1. 네이버 수집(raw) 시나리오를 고정:
   - `scripts/naver_playwright_capture.mjs` 또는 `scripts/naver_auto_collector.mjs`로 동일 조건 세션 결과를 충분히 모으고
   - `node scripts/run_listing_adapters.mjs --platform naver --input <raw>` 로 검증.
2. `requiredFieldsRate >= 0.85`, `imageRate >= 0.90` 충족 여부 확인.
3. 충족되면:
- `platform_sampling_targets.json`에서 네이버를 `AUTO_OK`가 아닌 `STEALTH_AUTOMATION` 결과로 분류해 기존 샘플러와 동일 단계로 병합.
   - 월세 조건 수집은 `--lease-type B2` 또는 `--lease-type 월세`로 고정 실행.
4. 최소 4개 플랫폼 목표:
- 네이버/직방/다방/부동산114은 STEALTH_AUTOMATION raw 정규화 파서 연결이 완료된 상태.

## 2026-02-15 네이버 품질 업그레이드 반영

- 가격 파서: `억`, `천만원`, `만원`, `원`, `숫자` fallback 지원을 강화.
- 면적 파서: `㎡`, `평`, 범위, 중첩 숫자 문자열 파싱을 강화.
- 이미지 추출: 중첩 객체·URL 패턴 재귀 탐색으로 중복 제거 수집을 강화.
- 차단 감지: 메시지/코드/에러 필드 기반 접근 제한 키워드 검사 강화.
- 실행 골격: `--platform all` + `%p` 플레이스홀더 기반 다중 플랫폼 병합 실행 추가.

### 실행 예시

- 다수 플랫폼 병합 실행:
  - `node scripts/run_listing_adapters.mjs --platform all --input scripts/%p_raw_samples.jsonl --max-items 200`
- 단일 플랫폼 실행:
  - `node scripts/run_listing_adapters.mjs --platform naver --input scripts/naver_raw_samples.jsonl`
