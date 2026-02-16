# 플랫폼 샘플 수집 실행북 v0.1 (직방/다방/네이버 부동산)

## 0) 기본 전제
- 실행 순서: 조건 입력 → 조회 가능성 판정 → 타깃 자동 생성 → 플랫폼별 샘플 수집
- 조건 입력 파일: `scripts/platform_search_conditions.json`
- 판정 스크립트: 
  - 기본: `node scripts/platform_query_probe.mjs --conditions scripts/platform_search_conditions.json`
  - 조건 직접 전달: `node scripts/platform_query_probe.mjs --sido 서울시 --sigungu 강남구 --dong 역삼동 --lease-type 월세 --rent-min 30 --rent-max 100 --min-area 10`
- 판정 출력: `scripts/platform_query_probe_results.json`
- `AUTO_OK` 플랫폼은 `scripts/platform_sampling_targets.json`에 자동 반영 후 수집 진행
- 네이버 부동산은 `platform_sampling_collect.mjs`로 처리하지 않고, 별도 캡처 파이프라인을 사용
  - `scripts/naver_playwright_capture.mjs` (STEALTH_AUTOMATION 네트워크 캡처)
  - `scripts/naver_normalize.mjs` (raw -> normalized)
  - 참고: `docs/naver_stealth_success_guide.md`, `scripts/naver_auto_collector.mjs`
- 샘플 수: 플랫폼당 20건
- 샘플 채점 기준:
  - `sample_status: SUCCESS`(파싱/검증 수행)
  - `sample_status: FAILED`(실패)
  - `sample_status: PENDING`(현재 자동 파이프라인 미지원 seed 페이지; 브라우저 자동화/수집기 전환 대상)
- 판정 임계치: [필수 필드 추출률 85%, 위반코드 <= 8%, 계약오류합산<=8%, 이미지 URL 유효성 >=90%]
- 수집모드: 판정에 따라 결정(직방/다방/네이버는 STEALTH_AUTOMATION 또는 BLOCKED)
- 직방/다방 STEALTH 모드는 API 후보 수집 → 응답 캡처(list API) → DOM/시드 fallback 순으로 탐색

## 0-1) 1차 수집 실행 결과(2026-02-16 기준, 샘플캡 8건 기준으로 집계)

- 직방: **`PASS`** (8건 SUCCESS)
- 네이버 부동산: **`PASS`** (8건 SUCCESS)
- 다방: **`PASS`** (Playwright stealth + page.route() 필터 인젝션, 20건/구)
- 피터팬: **`PASS`** (4구 40건, route 필터 인젝션 + API 인터셉트)
- 당근 부동산: **`PASS`** (7/8개 구 67건, Direct fetch + JSON-LD, 면적 미제공)
- 부동산114: **`PASS`** (6개 구 중 3건, page.evaluate(fetch), 매물 수 적음)
- KB부동산: `진행 중` (CDP 수집기 구현 완료, 검증 중)
- 네모: `제외` (상업용 부동산 전문)
- 호갱노노: `제외` (아파트 전문)

> 위 현황은 실시간 최신값입니다. 아래 `5.1` 표도 최신값으로 맞춰두었으니 실행 판단은 `0-1` 섹션 기준입니다.

---

## 1) 직방 샘플 수집 기록표 (현재 1건 수집 표시)

| idx | source_id | source_url | mode | 필수필드_추출_YN | rent_raw | rent_norm | deposit_raw | deposit_norm | area_raw | area_type | area_norm_m2 | address_raw | address_norm_code | room_count | floor | total_floor | images_cnt | images_valid_cnt | images_duplicate_cnt | contract_violations | parse_error | 비고 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 13 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 14 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 15 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 16 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 17 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 18 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 19 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 20 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

---

## 2) 다방 샘플 수집 기록표 (현재 1건 수집 표시)

| idx | source_id | source_url | mode | 필수필드_추출_YN | rent_raw | rent_norm | deposit_raw | deposit_norm | area_raw | area_type | area_norm_m2 | address_raw | address_norm_code | room_count | floor | total_floor | images_cnt | images_valid_cnt | images_duplicate_cnt | contract_violations | parse_error | 비고 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 13 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 14 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 15 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 16 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 17 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 18 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 19 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 20 | - |  | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

---

## 3) 네이버 부동산 샘플 수집 기록표 (현재 1건 수집 표시)

네이버는 일반 URL HTML 파싱보다 `네트워크 JSON 응답 캡처` 기반이 안정적이다.

| idx | source_id | source_url | mode | 입력유형(url/링크) | 필수필드_추출_YN | rent_raw | rent_norm | deposit_raw | deposit_norm | area_raw | area_type | area_norm_m2 | address_raw | address_norm_code | room_count | floor | total_floor | images_cnt | images_valid_cnt | images_duplicate_cnt | contract_violations | parse_error | 비고 |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- | --- | --- |
| 1 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 13 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 14 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 15 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 16 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 17 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 18 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 19 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 20 | - |  | - | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

---

## 4) 입력 데이터 집계 체크리스트

### 직방/다방/네이버 공통
- [ ] `platform_query_probe.mjs` 실행 후 수집 타깃 생성 결과 확인 (네이버는 별도 파이프라인)
- [ ] source_url 20건 수집 완료
- [ ] `필수필드_추출_YN` = Y 개수 계산
- [ ] rent/deposit/area 파싱 실패 수집
- [ ] area_type별 분포(Exclusive/Gross/Range/Estimated) 확인
- [ ] 주소 정규화 실패 항목 추적
- [ ] 계약 위반 코드 합산 비율 계산
- [ ] 이미지 URL 유효성 비율 계산
- [ ] 중복 이미지 비율 계산

### 실행 후 요약 제출용
- 각 플랫폼별 1차 판정: PASS/REJECT + 근거
- 네이버 부동산의 경우: STEALTH_AUTOMATION 전환 판단 여부

## 5) 현재 진행 상태 (2026-02-16T12:00:00Z 기준)

### 5.1 완료/대기 상태 요약

| 플랫폼 | 수집 방식 | 샘플링 결과 | 현재 건수 | 진행 상태 |
| --- | --- | --- | ---: | --- |
| 직방 | Direct API | SUCCESS 8/8 | 8 | **PASS** - `house/property/v1` payload 직접 수집 |
| 다방 | STEALTH_AUTOMATION | SUCCESS | 20건/구 | **PASS** - Playwright stealth + page.route() 필터 인젝션 |
| 피터팬 | STEALTH_AUTOMATION | SUCCESS: 동대문13/중랑13/성북9/광진5 | 40 | **PASS** - route 필터 인젝션 + API 인터셉트 |
| 당근 부동산 | Direct fetch | SUCCESS: 7/8개 구 | 67 | **PASS** - JSON-LD 파싱, 면적 미제공 |
| 부동산114 | STEALTH_AUTOMATION | SUCCESS: 노원2/성동1 | 3 | **PASS** - page.evaluate(fetch), 매물 수 적음 |
| 네이버 부동산 | STEALTH_AUTOMATION(캡처) | SUCCESS 8/8 | 8 | **PASS** - 별도 수집 모듈(캡처)로 정상 수집 |
| KB부동산 | CDP (수동 로그인) | - | - | **진행 중** - 수집기 구현 완료, 검증 중 |
| 네모 | - | - | - | **제외** - 상업용 부동산 전문 |
| 호갱노노 | - | - | - | **제외** - 아파트 전문 |

### 5.2 전체 집계
- 총 플랫폼: 8개 (SUCCESS 6 / 진행 중 1 / 제외 2)
- SUCCESS 플랫폼: 직방(8건), 네이버(8건), 다방(20건/구), 피터팬(40건), 당근(67건), 부동산114(3건)
- 진행 중: KB부동산
- 제외: 네모, 호갱노노

### 5.3 다음 우선 작업
- 1) ~~직방/다방/피터팬/당근/부동산114/네이버 수집기 구현~~ (`completed`)
- 2) KB부동산 CDP 수집 검증 (수동 로그인 후 자동 수집 테스트)
- 3) 당근 부동산 어댑터 + 레지스트리 + 오케스트레이터 통합
- 4) 부동산114 오케스트레이터 전용 블록 추가
- 5) 8개 구 전체 오케스트레이터 통합 실행 검증 (`run_parallel_collect.mjs`)
- 7) 당근 부동산 수집기 면적 미제공 이슈 대응 방안 결정

## 5.4 피터팬 수집 성공 상세 (2026-02-16 기준)

- 적용 쿼리: `서울시 {동대문구|중랑구|성북구|광진구}`, `월세 <= 80`, `보증금 <= 6000`, `면적 >= 40m2`, `빌라/연립 + 단독/다가구`
- 수집 방식: Playwright stealth + `page.route()` 필터 인젝션 + `/houses/area/pc` API 응답 인터셉트
- 수집기: `scripts/peterpanz_auto_collector.mjs`
- 어댑터: `scripts/adapters/peterpanz_listings_adapter.mjs`
- 테스트 결과:
  - 동대문구: 13건 SUCCESS (requiredFields 100%)
  - 중랑구: 13건 SUCCESS (requiredFields 100%)
  - 성북구: 9건 SUCCESS (requiredFields 100%)
  - 광진구: 5건 SUCCESS (requiredFields 100%)
- 정규화 검증: 가격(만원 변환), 면적(m2), 주소, 이미지 URL 모두 정상
- 이전 실패 원인: SPA가 Naver Map drag 이벤트로만 API 호출 → 기존 seed URL 방식으로는 리스트 링크 추출 불가 (`STEALTH_NO_LISTING_LINKS`)
- 해결: `page.route()`로 outgoing API 요청에 누락된 필터 파라미터(contractType, checkMonth, checkDeposit, checkRealSize) 재주입

---
