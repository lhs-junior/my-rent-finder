# 플랫폼별 수집/저장/화면 연동 정리 (Data-Back-Front)

## 1. 문서 목적
- 샘플 데이터 저장 중심 설명에서 벗어나 운영 가능한 실데이터 흐름으로 정리한다.
- 각 플랫폼별 수집 방식 차이를 플랫폼 수집기·어댑터·오케스트레이터 기준으로 정리한다.
- `Data → Back → Front` 기준으로 화면 연동 지점을 확정한다.
- 2026-02-16 기준으로 수집/저장/화면 전환 우선순위를 고정한다.

## 2. 핵심 결론
- 현재 운영 파이프라인은 `--persist-to-db`를 사용하면 **DB 적재 + API 렌더링**이 기본이다.
  - 수집기(raw) → 어댑터(normalized) → DB 업서트(raw/normalized/images/violation/match)
  - API 서버(`/api/ops`, `/api/matches`) 조회 후 Dashboard 렌더링
  - DB 쓰기 실패 시 `collect:parallel:*`/`ops:dashboard:build:*` 파이프라인은 실패(`exit code != 0`)로 종료됨
- 질문 정리:
  - “누가 HTML에서 DB를 읽나?” → HTML은 API 서버를 통해 조회하며 DB를 직접 읽지 않음
  - “왜 샘플인가?” → `--sample-cap=100`은 샘플 개수 개념이 아니라 **플랫폼별 최대 수집 목표치**(기본 100건)다
  - “실매물을 언제 볼 수 있나?” → `collect:parallel:db` 후 `/api/ops`, `/api/matches`, `/api/listings`로 즉시 조회 가능

## 3. 플랫폼별 수집 방식(현재 운영 및 보유 현황)

### 3.1 오케스트레이터/어댑터 연동 완료(실행 가능)

| 플랫폼 | 플랫폼 코드 | 오케스트레이터 | 수집 모드 | 수집 엔트리 | 핵심 수집 방식 |
|---|---|---|---|---|---|
| 네이버 부동산 | naver | `run_parallel_collect` + `naver_auto_collector` + `naver_normalize` | `STEALTH_AUTOMATION` | `scripts/naver_auto_collector.mjs` | Playwright stealth + 네트워크 응답 캡처 + 캡처 데이터 정규화 |
| 직방 | zigbang | `run_parallel_collect` + `zigbang_auto_collector.mjs` | `STEALTH_AUTOMATION` | `scripts/zigbang_auto_collector.mjs` | Direct API fallback → Playwright 네트워크 인터셉트 → Playwright API 호출 → DOM 파싱 |
| 다방 | dabang | `run_parallel_collect` + `dabang_auto_collector.mjs` | `STEALTH_AUTOMATION` | `scripts/dabang_auto_collector.mjs` | 페이지 API 인터셉트 + 페이지 기반 페이징 수집 |
| 부동산114 | r114 | `run_parallel_collect` + `r114_auto_collector.mjs` | `STEALTH_AUTOMATION` | `scripts/r114_auto_collector.mjs` | 브라우저 리스트 이동 + POST API(`/_c=memul&_m=p10&_a=index.ajax`) + HTML 파싱 |
| 피터팬 | peterpanz | `run_parallel_collect` + `peterpanz_auto_collector.mjs` | `STEALTH_AUTOMATION` | `scripts/peterpanz_auto_collector.mjs` | 지도 조작 기반 API 인터셉트(`/houses/area/pc`) + 파라미터 보강 |

### 3.2 수집기 보유 but 오케스트레이터 미연동

| 플랫폼 | 수집기 | 어댑터 | 상태 |
|---|---|---|---|
| 당근 부동산 | `daangn_auto_collector.mjs` | 미연동 | 실사용 경로에 미반영 |
| KB부동산 | `kbland_auto_collector.mjs` | 미연동 | 실사용 경로에 미반영 |

### 3.3 제외/보류

| 플랫폼 | 상태 |
|---|---|
| 네모 | `platform_query_probe` 대상에서 서비스 성격 이슈(제외) |
| 호갱노노 | BLOCKED 성향으로 수집 제외 |
| `naver_api_collector.mjs` | 실수집 파이프라인에서 현재 미사용(레거시 실험성 스크립트) |

## 4. 현재 데이터 플로우(실행 기준)

1. `scripts/run_parallel_collect.mjs`
   - `scripts/platform_search_conditions.json` 입력
   - 플랫폼별 컬렉션 실행 후 raw 파일 생성
   - `--normalize` 시 normalized 파일도 함께 생성
2. `scripts/build_operations_payload.mjs`
   - raw/normalized 또는 DB 기준으로 운영 대시보드 payload 생성
   - 출력: `docs/rent_finder_operations_dashboard_payload.json`
3. `docs/rent_finder_operations_dashboard.html`
   - 기본적으로 API 모드(`/api/ops`, `/api/matches`)로 렌더링, 파일 모드 fallback 지원
4. 매칭 파트
   - 정규화 결과는 `matcher_v1` 기반 파이프라인 결과로 payload에 내장되어 후보/군집 표시
5. DB 단계
   - DB 스키마(`db/schema_v1.sql`) 기준 upsert/수집 저장 구현 완료 (`--persist-to-db`)

## 5. Data → Back → Front 매핑(v1 목표)

### 5.1 Data(DB) Layer
- `raw_listings`
  - `platform_code`, `external_id`, `source_url`, `payload_json`, `collected_at`, `raw_status`
- `normalized_listings`
  - `raw_id`, `platform_code`, `external_id`, `source_ref`, `source_url`
  - 가격: `lease_type`, `rent_amount`, `deposit_amount`
  - 면적: `area_exclusive_m2`, `area_gross_m2`, `area_claimed`
  - 위치: `address_text`, `address_code`
  - `quality_flags`, `room_count`, `floor`, `total_floor` 등
- `listing_images`
  - `source_url`, `status`, `is_primary`, `listing_id`
- `listing_matches` / `match_groups`
  - `status` (`AUTO_MATCH`, `REVIEW_REQUIRED`, `DISTINCT`)

### 5.2 Back(API) Layer
- `GET /api/collection/runs?hours=24`
  - 플랫폼별 최근 수집 실행 목록, 실패/성공 통계
- `GET /api/listings`
  - 조건 검색(지역/가격/면적/플랫폼)
- `GET /api/listings/:id`
  - 매물 상세(계약/이미지/검증위반 내역)
- `GET /api/matches?run_id=...&status=AUTO_MATCH|REVIEW_REQUIRED|DISTINCT`
  - 매칭 후보, reason_json, 점수
- `GET /api/match-groups/:group_id`
  - AUTO_MATCH 군집 상세

### 5.3 Front
- 현재 프론트는 React + Vite로 전환(`frontend/`)되어 있습니다.
- 실행: `npm run front:dev` (개발 서버), `npm run front:build` (배포용 번들), `npm run api:server`에서 `--front-dir=frontend/dist`로 정적 서빙.
- Operations Dashboard (수집 모니터링)
  - 플랫폼별 `수집/정규화/성공률/품질율/건수` 노출
- Matching Review (매칭 후보/중복 탐색)
  - AUTO/REVIEW 구분, 검색, 점수 및 매칭 사유(reason_json) 표시
  - 기본 API 모드이며 필요 시 기존 payload 파일 모드 fallback
- Listing Search (매물 조회)
- `/api/listings` 검색/상세 조회 페이지 (React SPA, API 기반)

## 6. 현재 상태 점검 (지금 기준)
- 수집기 + 어댑터 통합: 완료(5개)
- DB 적재: `--persist-to-db` 기준으로 운영 (`raw_listings`, `normalized_listings`, `listing_images`, `contract_violations`, 매칭 테이블)
- API 서버: `/api/*` 기본 라우트 동작
- 대시보드/매칭 화면 렌더링: API 우선 + 파일 fallback
- 따라서 `실데이터 영구 저장` 상태: 운영 가능

### 6.1 운영 시작 가이드 (권장)
- `cp .env.example .env`
- `PGPASSWORD` 값 입력
- `npm run db:init -- --seed`
  - `.env` DB 접속 정보를 기준으로 DB 생성 + `db/schema_v1.sql` 적용
  - 시드(`db_dml_seed.sql`)까지 같이 입력하고 싶으면 `--seed` 유지
- `npm run ops:full:stack`
  - `docker compose up -d` → PostgreSQL 기동 대기(`wait_db_ready`) → `ops:full` 실행
  - 파이프라인은 bootstrap(DB 생성/스키마), 수집/매칭 산출, DB 적재, API 기동, Front 번들 빌드까지 일괄 수행
  - 브라우저에서 `http://127.0.0.1:4100`로 접속해 실데이터 화면 확인
  - 포트 충돌 발생 시 `PGHOST_PORT`를 바꾸고 `PGPORT`도 동일하게 맞춰 재시작

## 7. 병렬 진행 제안 (동시 작업)

- 백엔드 트랙
  - 1차: raw/normalized 업서트(원본/정규화/이미지)
  - 2차: `/api/collection/*` / `/api/listings` / `/api/matches` 1차 엔드포인트
  - 3차: matcher run/quality 보고서 API 연결
- 프론트 트랙
  - 1차: operations dashboard payload 소스 교체(API 호출) ✅
  - 1차 병행: 매칭 후보 목록 API 바인딩 + reason JSON 표출 ✅
  - 2차: 필터, 정렬, 페이지네이션 고도화 (대기)

## 8. UltraQA 점검(문서 기준)
- UltraQA 방식으로 문서-코드 정합성 체크를 수행했으며, 미완료 항목은 아래와 같다.
  - **PASS**: 플랫폼별 수집기-어댑터-오케스트레이터 실체 존재
  - **PASS**: current front가 API-first(payload 파일 fallback) 렌더링으로 전환됨
  - **PASS**: data-back-front 구현 정합성 확보 (`collect -> DB -> API -> Front`)

## 9. 실행 규칙(오해 방지)
- HTML 파일에서 DB 직접 조회를 기대하지 않는다.
- 새로고침 시마다 JSON 파일 재파싱을 영구 저장 대체 수단으로 쓰지 않는다.
- `샘플`은 테스트 케이스 이름일 뿐이며, 운영에서는 `수집 저장 파이프라인`이 정답이다.

### 9.1 실데이터 연결 체크 순서 (현재 기준)

1. DB 커넥션 파일 준비
   - `cp .env.example .env`
   - `PGPASSWORD` 포함해 `my_rent_finder` DB 접근 정보 입력
2. 백엔드/API 서버 실행
   - `npm run front:build`
   - `npm run api:server` 또는 `npm run ops:full`
   - 브라우저에서 `http://127.0.0.1:4100/api/health` 호출 시 `db.ok: true` 확인
3. 수집 실행(운영 데이터)
   - `npm run collect:parallel:db:full -- --sample-cap=100`  
     (수집 + DB 적재 + 매칭 산출물 반영까지 1회 실행)
   - 이 명령은 DB 쓰기 실패 시 즉시 오류로 종료됨(성공으로 보고되지 않음)
   - 분리 실행이 필요하면:
     - `npm run collect:parallel:db -- --sample-cap=100`
     - `npm run ops:dashboard:build:db`
4. 수집 산출물 DB 반영 확인
   - `http://127.0.0.1:4100/api/ops` → 플랫폼별 raw/norm/성공률/품질 노출
   - `http://127.0.0.1:4100/api/matches` → 매칭 후보/중복 탐색 노출
   - `http://127.0.0.1:4100/api/listings?limit=50` → 실매물 조회
5. 프론트 확인
   - `http://127.0.0.1:4100` 열고 상단의 `run_id`를 비우면 최신 run_id 기준 표시
   - `API` 상태칩이 실패면 API 자체 또는 DB 연결을 먼저 복구

### 9.2 연결 실패 시 빠른 점검
- `health`가 `DB_CONNECTION_ERROR`로 내려오면 아래 값 점검
  - PostgreSQL 데몬 실행 여부
  - `.env`의 `PGHOST/PGHOST_PORT/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`
  - 스키마 적용 여부
    - `createdb my_rent_finder` (DB 없다면)
    - `psql -h 127.0.0.1 -p 5432 -U "$PGUSER" -d my_rent_finder -f db/schema_v1.sql`
    - `psql -h 127.0.0.1 -p 5432 -U "$PGUSER" -d my_rent_finder -f scripts/db_dml_seed.sql`
