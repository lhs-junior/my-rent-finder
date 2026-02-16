# 네이버 부동산 수집 핸드오프 문서

## 1) 목적
- 이 프로젝트는 서울 월세 매물을 여러 플랫폼에서 통합 조회하려는 개인용 도구다.
- 네이버 부동산 데이터를 반드시 포함해야 한다.
- 완전 무인 크롤링이 아니라, 브라우저 동반(STEALTH_AUTOMATION) 모드로 실사용 가능한 품질을 목표로 한다.

## 2) 고정 요구사항
- 지역: 서울시
- 대상 구(임장 동선 기반): 노원구, 중랑구, 동대문구, 광진구, 성북구, 성동구, 중구, 종로구
- 거래유형: 월세
- 보증금: 최대 6000만원
- 월세: 최대 80만원
- 면적: 40m2 이상
- 주거 유형: 빌라/연립 + 단독/다가구 포함
- 지도에서 현재 보이는 영역 기준 수집 지원 필요

## 2.1) 정책/약관/robots 참고 URL (법률 자문 아님)
- robots.txt (크롤링 정책 힌트)
  - https://land.naver.com/robots.txt
- 네이버 정책/약관 페이지(서비스 이용약관/운영정책 계열)
  - https://policy.naver.com/terms/
  - https://policy.naver.com/policy/service.html

위 URL의 내용(robots/약관)과 실제 구현 방식이 충돌하면, 계약 위반/접근 제한/계정 제한 등의 리스크가 생길 수 있다.

## 3) 현재 프로젝트 상태 요약
- 조건 파일: `scripts/platform_search_conditions.json`
- 프로브 스크립트: `scripts/platform_query_probe.mjs`
- 샘플 수집 스크립트: `scripts/platform_sampling_collect.mjs`
- 샘플 판정 스크립트: `scripts/evaluate_sampling_results.mjs`
- 통합 타깃 생성은 이미 구현되어 있음
- 네이버는 현재 `BLOCKED` 성격이 강해서 자동 수집 대신 사용자 동반 수집 어댑터가 필요

### 참고(이미 존재하는 문서/코드)
- `docs/naver_stealth_success_guide.md` (조사/가설 문서)
- `scripts/naver_playwright_capture.mjs` (STEALTH_AUTOMATION 네트워크 캡처)
- `scripts/naver_auto_collector.mjs` (자동 수집 실험 코드)
- `scripts/naver_api_collector.mjs` (직접 API 호출 실험 코드)
- `scripts/naver_raw_samples.jsonl` (캡처된 raw 샘플)
- `scripts/naver_normalize.mjs` (raw -> normalized 변환기)

### 네이버 부동산 `realEstateType` 코드(관측 기반)
- `scripts/naver_raw_samples.jsonl`의 `request_url`에서 관측된 코드:
- `DDDGG` = 단독/다가구
- `VL`, `YR`, `DSD` = 빌라/연립/다세대 계열로 관측됨(표기/코드 체계는 추가 검증 필요)

## 4) 요청 작업 범위(다른 AI에게 위임할 핵심)
- 네이버 전용 `STEALTH_AUTOMATION` 수집 모듈 구현
- `Playwright`로 브라우저 세션에서 `response(XHR/fetch)` 캡처
- 캡처한 원문 응답(raw) 저장 + 정규화(normalized) 변환
- 이미지 URL 추출 및 품질 검증 코드 연결

## 5) 구현 산출물(필수 파일)
- `scripts/naver_capture_playwright.mjs`
- `scripts/naver_extract_from_raw.mjs`
- `scripts/naver_normalize.mjs`
- `scripts/naver_capture_results.json` (실행 결과)
- `scripts/naver_raw_samples.jsonl` (원문)
- `docs/naver_endpoint_map.md` (캡처된 응답 URL 패턴 정리)

## 6) 데이터 계약(최소 필드)
- raw 저장 필드
- `platform_code`, `collected_at`, `source_url`, `request_url`, `response_status`, `response_headers`, `payload_json`
- normalized 저장 필드
- `address_text`, `rent_amount`, `deposit_amount`, `area_exclusive_m2`, `area_gross_m2`, `room_count`, `floor`, `total_floor`, `image_urls`, `lease_type`, `source_ref`

## 7) 판정 기준(기존 프로젝트 기준 유지)
- 필수 필드 추출률: 85% 이상
- 계약 위반율: 8% 이하
- 가격/면적 파싱 실패 합산: 8% 이하
- 이미지 URL 유효성: 90% 이상

## 8) 실행 예시(권장)
```bash
node scripts/naver_capture_playwright.mjs \
  --sido 서울시 \
  --sigungu 노원구 \
  --lease-type 월세 \
  --deposit-max 6000 \
  --rent-max 80 \
  --min-area-m2 40 \
  --headed true
```

## 9) 구현 시 주의사항
- 사용자 동작 기반 수집을 기본으로 할 것
- 과도한 요청/반복 트래픽 방지(딜레이, 상한)
- 로그인/캡차/정책 변경 시 graceful fail 처리
- 차단 시 원인 코드를 남길 것(`SOURCE_ACCESS_BLOCKED`, `PARSE_FAIL`, `RESPONSE_EMPTY` 등)

## 10) 완료 정의(Definition of Done)
- 네이버에서 최소 20건 raw 수집 성공
- 최소 20건 중 85% 이상 normalized 필수 필드 생성
- 이미지 URL 유효성 90% 이상
- 결과 파일과 실행 커맨드가 문서화되어 재현 가능

## 11) 실패 시도/원인 기록 (2026-02-15 기준)
- 아래는 실제로 시도했고 실패하거나 실효성이 낮았던 방법들이다.
- 다른 AI는 같은 방식 재시도 전에 원인부터 확인할 것.

| 일시(UTC) | 시도 | 결과 | 실패/제약 원인 | 후속 방안 |
| --- | --- | --- | --- | --- |
| 2026-02-15 | `curl -I https://www.zigbang.com` + `robots.txt` | `403` | 루트/robots 모두 접근 차단 성격 | 자동 수집 대신 `STEALTH_AUTOMATION` 또는 브라우저 동반 모드 |
| 2026-02-15 | `curl -I https://land.naver.com/search?...` | `404` | 검색 엔드포인트 직접 호출 불안정/차단 | 페이지 자동 순회 포기, 사용자 세션 response 캡처 방식으로 전환 |
| 2026-02-15 | `curl https://land.naver.com/robots.txt` | `User-agent:* Disallow:/` | 일반 크롤러 기준 전면 제한 | 네이버는 `STEALTH_AUTOMATION` 전용 어댑터로 분리 |
| 2026-02-15 | 다방 검색 URL 직접 수집 | 검색경로 실효성 낮음 | `robots`에 `/search` 명시적 Disallow | 다방도 자동 순회 대신 사용자 동반/seed URL 기반 |
| 2026-02-15 | 호갱노노 수집 프로브 | 실패 | `robots`에 일반 User-agent `Disallow:/` + 명시 경고문 | 수집 대상에서 기본 제외, 필요 시 정책 재확인 |
| 2026-02-15 | 샘플 수집(`sample-cap=2`) 후 품질평가 | 모든 플랫폼 `requiredFieldsRate=0` | 홈/시드 URL 위주라 상세 매물 필드 부재 | 상세 listing URL/응답 캡처 어댑터 구현 필요 |

## 12) 구현 중 발생한 오탐/버그와 수정사항
- 이 이슈들을 모르면 같은 오판이 반복된다.

| 이슈 | 증상 | 원인 | 조치 |
| --- | --- | --- | --- |
| `robots` 파서 오동작 | `Disallow` 규칙이 0건으로 읽힘 | 줄바꿈을 제거하는 문자열 정규화 사용 | 줄 단위 파싱으로 수정 |
| 차단 키워드 과탐지 | 정상 페이지도 `BLOCKED_TEXT`로 분류 | `보안`, `인증` 등 일반 문구까지 차단 패턴에 포함 | 차단 정규식을 실제 차단 문구 중심으로 축소 |
| 불리언 플래그 파싱 오류 | `--print-condition-only`가 일반 실행처럼 동작 | 값 없는 플래그를 true로 처리 못함 | 플래그 존재 시 true 처리 로직 추가 |
| 샘플러 플랫폼 누락 | 5개 타깃인데 일부 플랫폼만 수집 | 타깃 슬라이싱(`3 * sampleCap`)으로 앞부분만 사용 | 전체 타깃 순회로 수정 |

## 12.1) Adapter 골격 반영
- 네이버 정규화는 `scripts/adapters/base_listing_adapter.mjs` + `scripts/adapters/naver_listings_adapter.mjs` 기반으로 공통화했습니다.
- 실행 포인트:
  - `node scripts/naver_normalize.mjs --input scripts/naver_raw_samples.jsonl --output scripts/naver_normalized_samples.json`
  - `node scripts/run_listing_adapters.mjs --platform naver --input scripts/naver_raw_samples.jsonl --max-items 200`
- 어댑터 등록:
  - READY: `naver`
  - PLAN_ONLY: `zigbang`, `dabang`, `r114`

## 13) 현재 시점 결론
- 네이버는 지금 상태에서 `완전 자동` 접근 성공 기준을 충족하지 못했다.
- 네이버를 포함하려면 `Playwright STEALTH_AUTOMATION response 캡처`가 사실상 필수다.
- 우선 구현 순서:
1. 네이버 브라우저 동반 캡처 모듈
2. raw->normalized 파서
3. 이미지 URL 검증
4. 20건 샘플 품질평가(85/8/8/90 기준)
