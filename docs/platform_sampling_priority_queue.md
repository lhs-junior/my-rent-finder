# 플랫폼 샘플 수집 우선순위 큐 v0.1 (analyze 대상)

근거 문서: `docs/platform_feasibility_report.md`, `docs/data_contract.md`, `docs/platform_field_mapping_template.md`

## 1) 목표
- 플랫폼별 최소 20~50건 샘플로 실측 추출률/오류율을 측정
- 수집량 가설을 실제 데이터로 보정
- 현재 큐는 `조건 기반 조회가능성 판정` 후 진행
- 최소 4개 플랫폼 확보를 목표로 하며, `AUTO_OK + STEALTH_AUTOMATION`를 수집 가능군으로 본다
- 우선순위는 `다방 → 피터팬 → 부동산114 → 네모 → (직방/네이버/호갱노노)` 순으로 시도
- 직방/다방은 API 후보 추출 + 응답 캡처(list API) + DOM fallback로 우선 판정

실행 반영(2026-02-16 기준):
- 1차 수집 타깃: 8개 구(노원/중랑/동대문/광진/성북/성동/중구/종로)
- 완료 상태:
  - 직방: **PASS** - Direct API, 8건 SUCCESS
  - 다방: **PASS** - Playwright stealth + page.route() 필터 인젝션, 20건/구
  - 피터팬: **PASS** - route 필터 인젝션 + API 인터셉트, 4구 40건
  - 당근 부동산: **PASS** - Direct fetch + JSON-LD 파싱, 7/8개 구 67건 (면적 미제공)
  - 부동산114: **PASS** - page.evaluate(fetch), 6개 구 중 3건 (매물 수 적음)
  - 네이버: **PASS** - 별도 캡처 수집 플로우, 8건 SUCCESS
  - KB부동산: **진행 중** - CDP 수집기 구현 완료, 검증 중
  - 네모: **제외** - 상업용 부동산 전문 플랫폼
  - 호갱노노: **제외** - 아파트 전문 실거래가 서비스
- 다음 큐 우선순위:
  1) KB부동산 CDP 수집 검증
  2) 당근 부동산 어댑터/레지스트리/오케스트레이터 통합
  3) 부동산114 오케스트레이터 전용 블록 추가
  4) 8개 구 전체 오케스트레이터 통합 실행 검증

## 2) 실행 우선순위

실행 직전 예시:
- `node scripts/platform_query_probe.mjs --sido 서울시 --lease-type 월세 --deposit-max 6000 --rent-max 80 --min-area 40`

| 순서 | 플랫폼 | 모드 | 샘플 수 | 1차 판정 기준 | 상태 |
| --- | --- | --- | ---: | --- | --- |
| 1 | 다방 | STEALTH_AUTOMATION | 20건/구 | Playwright stealth + page.route() 필터 인젝션 | **`PASS`** |
| 2 | 피터팬 | STEALTH_AUTOMATION | 4구 40건 | route 필터 인젝션 + API 인터셉트, 정규화 100% | **`PASS`** |
| 3 | 부동산114 | STEALTH_AUTOMATION | 6구 3건 | page.evaluate(fetch) API 호출, 매물 수 적음 | **`PASS`** |
| 4 | 당근 부동산 | Direct fetch | 7구 67건 | JSON-LD 파싱, 면적 미제공, 주소/가격/이미지 100% | **`PASS`** |
| 5 | 직방 | Direct API | 8건 | API 직접 호출, 브라우저 불필요 | **`PASS`** |
| 6 | 네이버 부동산 | STEALTH_AUTOMATION(캡처) | 8건 | 응답 캡처 성공률, 필수필드 정규화율, 이미지 URL 추출률 | **`PASS`** |
| 7 | KB부동산 | CDP (수동 로그인 필요) | - | 수집기 구현 완료, 수집 가능성 검증 중 | `진행 중` |
| - | 네모 | - | - | 상업용 부동산 전문 플랫폼 | `제외` |
| - | 호갱노노 | - | - | 아파트 전문 실거래가 서비스 | `제외` |

## 3) 플랫폼별 샘플링 체크리스트 (공통)
- 필수 추출률 체크: address, monthly_rent, deposit, area_exclusive_m2, room_count, source_url
- 계약 위반 체크: 위반 코드 발생 건수 / 샘플 대비 비율
- 정규화 체크: 면적 단위(㎡/평), 가격 단위, 주소 정규화 신뢰도
- 이미지 체크: 대표/썸네일 URL 유효성, 중복 URL 비율
- 중복 매칭 체크: 동일/유사 매물 시뮬레이션 10건

### 판정 임계치(1차)
- 판정 선행 단계: `node scripts/platform_query_probe.mjs --conditions scripts/platform_search_conditions.json`
- 필수 필드 추출률: 85% 이상 충족 시 1차 통과
- 계약 위반 코드: 8% 이하
- `PRICE_PARSE_FAIL + AREA_PARSE_FAIL` 합산: 8% 이하
- 이미지 URL 유효성: 90% 이상
- 네이버 부동산의 경우 수집 경로 특성 반영 시 이 임계치에서 `STEALTH_AUTOMATION`용 분기 적용

## 4) 샘플 결과 기록 템플릿

### 4.1 직방(20건)
- 대상 URL 수: 20
- 수집 방식: 사용자가 정의한 검색조건으로 조회 결과 20건
- 기록 항목:
  - raw_url_count, parsed_count
  - 필수필드 추출 성공률
  - 위반 코드 top5
  - 매칭 테스트(동일주소/유사면적) 샘플 10건

### 4.2 다방(20건)
- 대상 URL 수: 20
- 수집 방식: 사용자 정의 seed URL 기반(권장 STEALTH_AUTOMATION)
- 기록 항목:
  - raw_url_count, parsed_count
  - 전용/공용 면적 분류 정확도
  - 가격 파싱 실패 케이스
  - 이미지 저장 정책 적용 건수

### 4.3 네이버 부동산(20건)
- 대상 URL 수: 20
- 수집 방식(권장): `scripts/naver_playwright_capture.mjs`로 raw 캡처 → `scripts/naver_normalize.mjs`로 normalized 생성
- 수집 방식(실험): `docs/naver_stealth_success_guide.md` 및 `scripts/naver_auto_collector.mjs` 기반 자동 수집
- 기록 항목:
  - 자동 수집 실패 건수
  - 수동 등록/입력 오류율
  - 플랫폼 규칙 변경 대응 여부

## 5) 다음 단계 트리거
- `직방` 20건 통과 시: 직방 추가 샘플(50건) 수집 → 다음 우선순위로 전환 또는 모드 상향 검토
- `다방` 20건 통과 시: STEALTH_AUTOMATION 대비 자동 보강 가능성 점검
- `네이버 부동산` 20건 통과 후: 보조 입력 경로가 실사용 가치가 있으면 `STEALTH_AUTOMATION 우선` 모드로 유지
