# my-rent-finder 기술 부채 분석 및 개선안 기획서

> 작성일: 2026-02-18
> 범위: 코드베이스 전체 (scripts/, frontend/, db/, tests/)
> 방법론: Planner-Architect-Critic 합의 기반 분석
> 검토: Architect 기술 타당성 검증 완료 / Critic 완성도 평가 완료 (조건부 승인)

---

## 1. 현황 요약

### 프로젝트 개요
서울 월세/전세 매물을 7개 부동산 플랫폼에서 수집하여 통합 비교하는 개인 프로젝트.
Node.js ESM + PostgreSQL + React 18 SPA.

### 핵심 지표

| 지표 | 값 | 상태 |
|------|------|------|
| 총 소스 파일 | 86 `.mjs` + 14 `.jsx` | - |
| 스크립트 총 라인 | 33,553줄 | 비대 |
| 프론트엔드 총 라인 | 3,520줄 | 적정 |
| 중복 코드 추정 | 500-800줄 | 리팩토링 필요 |
| 테스트 파일 | 3개 | 심각하게 부족 |
| 테스트 커버리지 | 측정 불가 | - |
| console.log 호출 | ~1,100건 (archive 포함) | 구조화 필요 |
| 하드코딩 URL | 100건+ | 설정 분리 필요 |
| archive 파일 | 35개 | 정리 필요 |
| DB 인덱스 | 11개 | 일부 누락 |

---

## 2. 기술 부채 상세 분석

### 2.1 거대 파일 / 단일 책임 위반 (Critical)

**현재 상태:**
| 파일 | 라인 수 | 문제점 |
|------|---------|--------|
| `platform_sampling_collect.mjs` | 3,624 | 레거시 모놀리식 (개별 수집기 분리 완료, 미삭제) |
| `ops_db_persistence.mjs` | 1,831 | raw/normalized/image/match 전부 한 파일 |
| `daangn_auto_collector.mjs` | 1,659 | URL 정규화 6개 함수 + fetch + parse 혼재 |
| `naver_listings_adapter.mjs` | 1,527 | 범위 면적, 가격 파싱, 한국어 토큰화 밀집 |
| `zigbang_auto_collector.mjs` | 1,339 | v2/v3 API 분기 + geohash 로직 |
| `run_parallel_collect.mjs` | 1,279 | 오케스트레이션 + 프로세스 관리 혼재 |
| `user_only_listing_adapter.mjs` | 1,257 | 베이스 어댑터 역할이지만 과도한 기능 |
| `ListingSearch.jsx` | 666 | 검색+필터+모달+갤러리 모놀리식 |

**왜 문제인가:** 단일 파일이 1,000줄을 넘으면 인지 부하 증가, 변경 시 사이드이펙트 위험, 코드 리뷰 어려움.

### 2.2 수집기 간 코드 중복 (High)

**현재 상태:**
7개 `*_auto_collector.mjs`가 각각 독립 구현. 공통 base collector 없음.

반복되는 패턴:
- fetch → parse → normalize → JSONL 저장 루프
- 재시도/rate-limiting 로직 (각각 다르거나 없음)
- 중복 제거 (Set 기반, 각 수집기별 별도 구현)
- 에러 핸들링 (try-catch 패턴 제각각)

**중복 유틸리티:**
| 유틸리티 | 중복 위치 | 중복 라인 |
|----------|-----------|-----------|
| FNV-1a 해시 | `db_client.mjs`에 단일 정의 (`ensureFnv11`). 다른 모듈에서 import하여 사용 — 실제 중복 아님 | - |
| 면적 정규화 | `db_client.mjs`, `daangn_listings_adapter.mjs` | ~40줄 x 2 |
| URL 파싱/정규화 | `daangn_auto_collector.mjs` 내 6개 함수 | ~100줄 |
| 이미지 URL 검증 | `base_listing_adapter.mjs`, `naver_listings_adapter.mjs` | ~20줄 x 2 |

> **[Architect 검증]** FNV-1a는 `db_client.mjs:182`에 단일 구현. 초안의 "3곳 중복" 주장은 사실과 다름.

### 2.3 DB 클라이언트 비일관성 (High)

**현재 상태:**
- `db_client.mjs`에 `withDbClient()` 유틸 존재
- 일회성 fix 스크립트(`_fix_*`, `_check_*`)가 직접 `new pg.Client({host, port...})` 하드코딩 — 주요 모듈은 이미 `withDbClient()` 사용
- Connection pooling 없음 (API 서버도 per-request `Client` 사용 — `withDbClient()`가 매번 TCP 연결 열고 닫음)
- 관련 파일: `_fix_daangn_swap.mjs`, `_fix_daangn_null_dep.mjs`, `_check_db_quality.mjs`, `_reprocess_db.mjs`, `_check_db_coords.mjs`

> **[Architect 검증]** 하드코딩 파일들은 대부분 일회성 핫픽스 — "통합" 대상이 아니라 **삭제/archive 대상**. 실질적 문제는 `withDbClient()`의 per-request Client 패턴(Pool 미사용).

### 2.4 테스트 부재 (Critical)

**현재 상태:**
```
tests/
├── api_server.test.mjs     (379줄, API 라우팅/보안 테스트)
├── matcher_v1.test.mjs      (524줄, 매칭 로직 단위 테스트)
└── smoke.test.mjs           (기본 smoke)
```

**테스트 없는 영역:**
- 수집기 (7개 전부) — 네트워크 의존이지만 파싱 로직은 단위 테스트 가능
- 어댑터 (6개 전부) — 순수 함수, 가장 테스트 효과 높음
- DB persistence (`ops_db_persistence.mjs` 1,831줄) — 쿼리 빌딩 테스트 가능
- 프론트엔드 컴포넌트 — React Testing Library 미설정

**QA 스크립트 (`scripts/qa/`)는 존재하지만 vitest 통합 아닌 수동 실행.**

### 2.5 환경 설정 관리 (Medium)

**현재 상태:**
- 커스텀 `.env` 로더 (db_client.mjs에서 직접 파싱, dotenv 미사용)
- 환경변수 접근 패턴이 파일마다 불일치
- Kakao API 키: `KAKAO_REST_API_KEY`, `KAKAO_MAP_JS_KEY`, `VITE_KAKAO_JS_KEY`, `VITE_KAKAO_REST_API_KEY` — 4가지 변수명 혼재
- `.env`에 실제 credential 존재 (gitignored이지만 `.env.example`에 기본값 노출)

### 2.6 프론트엔드 구조적 문제 (Medium)

**현재 상태:**
- React Router 없이 URL query param으로 뷰 전환 (`?view=listings`)
- Class-based ErrorBoundary (MapErrorBoundary) + hooks 혼용
- 상태 관리 라이브러리 없음 — prop drilling 5단계+
- `styles.css` 단일 파일 1,727줄
- `ListingSearch.jsx` 666줄 모놀리식 (검색+필터+상세모달+이미지갤러리)

### 2.7 API 서버 구조 (Low)

**현재 상태:**
- `node:http` 직접 사용 (Express/Fastify 없음)
- 메인 라우터 312줄이지만, 실제 핸들러는 `lib/api_routes/` 하위 5개 모듈(총 1,634줄)로 이미 분리됨
- CORS, 요청 검증, 에러 핸들링 수동 구현이지만 현재 규모에서 충분히 동작

> **[Critic 검증]** 기획서 초안이 시사하는 것보다 이미 상당 부분 모듈화된 상태. 심각도 Medium → Low로 하향.

### 2.8 기타 부채

| 항목 | 심각도 | 설명 |
|------|--------|------|
| 마이그레이션 번호 충돌 | Low | `002_add_price_history.sql`과 `002_listing_images_unique_by_listing.sql` |
| 의존성 구조 | Low | react/react-dom이 루트 package.json에 (frontend 전용) |
| puppeteer-extra-plugin-stealth | Low | Playwright에서 미사용, 불필요 의존성 |
| CI/CD 없음 | Medium | 린트/테스트/빌드 자동화 없음 |
| 로깅 구조 없음 | Medium | 1,226개 console.log, 레벨 구분 없음 |
| archive 파일 35개 | Low | 탐색/실험 아티팩트 잔존 |
| 수집 결과 데이터 | Low | `parallel_collect_runs/` 19+ 디렉토리 |

---

## 3. 개선안 (Phase별)

### Phase 1: 즉시 정리 (1-2일) — 안정성 기반 확보

#### 1-1. 레거시 모놀리식 수집기 제거
| 항목 | 내용 |
|------|------|
| **문제** | `platform_sampling_collect.mjs` (3,624줄)이 개별 수집기 분리 후에도 존재 |
| **선행조건** | `run_parallel_collect.mjs:69`의 `collect:` 경로가 이 파일을 참조 중. 해당 분기가 dead code인지 확인 후, 참조 제거가 **반드시 선행**되어야 함 |
| **개선** | 참조 제거 후 파일 삭제. git history에서 복원 가능 |
| **효과** | 코드베이스 ~3,600줄 감소, 혼란 제거 |
| **우선순위** | P0 |
| **난이도** | S |
| **의존성** | 없음 |

#### 1-2. archive 디렉토리 정리
| 항목 | 내용 |
|------|------|
| **문제** | 35개 탐색/디버그 스크립트가 `scripts/archive/`에 잔존 |
| **개선** | git에서 추적 중단. 필요 시 git history에서 복원 가능하므로 삭제 |
| **효과** | 코드베이스 정리, 탐색 용이성 향상 |
| **우선순위** | P0 |
| **난이도** | S |
| **의존성** | 없음 |

#### 1-3. 불필요 의존성 제거
| 항목 | 내용 |
|------|------|
| **문제** | `puppeteer-extra-plugin-stealth`가 production deps에 있으나 Playwright만 사용 |
| **주의** | `playwright-extra`가 내부적으로 stealth plugin을 peer dependency로 사용할 수 있음. 제거 전 `playwright-extra` 단독 동작 확인 필요 |
| **개선** | 확인 후 `npm uninstall puppeteer-extra-plugin-stealth` |
| **효과** | 의존성 트리 축소 |
| **우선순위** | P0 |
| **난이도** | S |
| **의존성** | 없음 |

#### 1-4. 마이그레이션 번호 정리
| 항목 | 내용 |
|------|------|
| **문제** | `002_` 접두사가 2개 파일에 중복 |
| **개선** | `002_add_price_history.sql` → `002a_` 또는 적용 순서 확인 후 정리 |
| **효과** | 마이그레이션 순서 명확화 |
| **우선순위** | P1 |
| **난이도** | S |
| **의존성** | 없음 |

---

### Phase 2: 코드 품질 개선 (3-5일) — 유지보수성 확보

#### 2-1. 공유 유틸리티 추출
| 항목 | 내용 |
|------|------|
| **문제** | FNV-1a 해시, 면적 정규화, URL 파싱이 3-6곳에 중복 |
| **개선** | `scripts/lib/` 아래 공유 모듈 생성: |
| | - `lib/hash.mjs` — FNV-1a 단일 구현 |
| | - `lib/area_utils.mjs` — 면적 정규화/변환 |
| | - `lib/url_utils.mjs` — URL 정규화/검증 |
| | - `lib/dedup.mjs` — Set 기반 중복제거 유틸 |
| **효과** | ~500줄 중복 제거, 버그 수정 시 한 곳만 변경 |
| **우선순위** | P1 |
| **난이도** | M |
| **의존성** | 없음 |

#### 2-2. DB 클라이언트 통합
| 항목 | 내용 |
|------|------|
| **문제** | 5개+ 스크립트가 DB 접속 정보 하드코딩 |
| **개선** | 모든 DB 접근을 `withDbClient()` 또는 새로운 `withDbPool()` 경유. 임시 fix 스크립트들도 `db_client.mjs` import |
| **효과** | DB 설정 변경 시 1곳만 수정, connection pooling 도입 가능 |
| **우선순위** | P1 |
| **난이도** | M |
| **의존성** | 없음 |

#### 2-3. Connection Pooling 도입
| 항목 | 내용 |
|------|------|
| **문제** | API 서버가 요청마다 `new Client()` → `connect()` → `end()` |
| **개선** | `db_client.mjs`에 `pg.Pool` 기반 싱글톤 추가. API 서버와 persistence 모듈에서 사용 |
| **효과** | 동시 요청 성능 향상, 커넥션 관리 자동화 |
| **우선순위** | P1 |
| **난이도** | M |
| **의존성** | 없음 (독립 실행 가능 — `withDbClient()` 내부만 Pool로 교체하면 호출측 변경 불필요) |

> **[Architect 검증]** 2-3은 2-2와 독립적으로 실행 가능. `withDbClient()` 내부를 `pool.connect()`/`release()`로 교체하면 끝.

#### 1-5. 일회성 fix/check 스크립트 정리 (Architect 추가)

| 항목 | 내용 |
|------|------|
| **문제** | `_fix_*`, `_check_*`, `_tmp_*` 스크립트 7개+가 `scripts/`에 잔존. 직접 DB 접속 하드코딩 |
| **개선** | 삭제 (이미 gitignored, git history에서 복원 가능) |
| **효과** | DB 클라이언트 비일관성 문제의 실질적 해결 (2-2의 범위 축소) |
| **우선순위** | P0 |
| **난이도** | S |
| **의존성** | 없음 |

#### 2-4. 환경변수 정리
| 항목 | 내용 |
|------|------|
| **문제** | Kakao API 키 4가지 변수명 혼재, env 로더 커스텀 구현 |
| **개선** | Kakao 키를 `KAKAO_REST_API_KEY` / `KAKAO_MAP_JS_KEY` 2개로 통일. Vite용은 `define`에서 매핑. `.env.example`에 Kakao 키 항목 추가 (현재 누락됨) |
| **효과** | 설정 혼란 제거 |
| **우선순위** | P1 |
| **난이도** | S |
| **의존성** | 없음 |

---

### Phase 3: 테스트 기반 구축 (1-2주) — 품질 보증

#### 3-1. 어댑터 단위 테스트 추가
| 항목 | 내용 |
|------|------|
| **문제** | 어댑터 6개 전부 테스트 없음. 순수 함수이므로 가장 ROI 높음 |
| **개선** | 각 어댑터별 테스트 파일 작성. 실제 수집 데이터 샘플을 fixture로 사용 |
| | - 입력: raw JSONL 레코드 → 출력: normalized 레코드 검증 |
| | - 엣지 케이스: null 면적, 보증금/월세 스왑, 잘못된 주소 |
| **효과** | 어댑터 변경 시 회귀 방지. 최근 발생한 rent/deposit 스왑 버그 재발 차단 |
| **우선순위** | P1 |
| **난이도** | M |
| **의존성** | 없음 |

#### 3-2. 수집기 파싱 로직 테스트
| 항목 | 내용 |
|------|------|
| **문제** | 수집기의 API 응답 파싱 로직이 테스트 없음 |
| **개선** | 네트워크 의존 없는 파싱 함수만 추출하여 테스트 |
| | - `parsePriceFromDetail()` (당근) |
| | - `toRecord()` / `toNormalizedRecord()` (KB) |
| | - geohash 변환 (직방) |
| **효과** | API 응답 구조 변경 시 빠른 감지 |
| **우선순위** | P1 |
| **난이도** | M |
| **의존성** | 없음 |

#### 3-3. DB persistence 쿼리 테스트
| 항목 | 내용 |
|------|------|
| **문제** | `ops_db_persistence.mjs` 1,831줄이 테스트 없음 |
| **개선** | 테스트 DB (docker compose 기반) + INSERT/UPSERT/COALESCE 검증 |
| **효과** | 데이터 무결성 보장 |
| **우선순위** | P2 |
| **난이도** | L |
| **의존성** | Docker 환경 |

#### 3-4. 테스트 커버리지 측정 설정
| 항목 | 내용 |
|------|------|
| **문제** | 커버리지 측정 미설정 |
| **개선** | `vitest.config.mjs`에 `coverage` 설정 추가. `@vitest/coverage-v8` 설치 |
| **효과** | 커버리지 현황 파악, 목표 설정 가능 |
| **우선순위** | P2 |
| **난이도** | S |
| **의존성** | 3-1 이후 의미 있음 |

---

### Phase 4: 아키텍처 개선 (2-4주) — 확장성 확보

#### 4-1. ops_db_persistence.mjs 분리
| 항목 | 내용 |
|------|------|
| **문제** | 1,831줄에 raw/normalized/image/match/violation 전부 혼재 |
| **개선** | 테이블별 모듈 분리: |
| | - `lib/db/raw_listings.mjs` |
| | - `lib/db/normalized_listings.mjs` |
| | - `lib/db/images.mjs` |
| | - `lib/db/matches.mjs` |
| | - `lib/db/index.mjs` (re-export) |
| **효과** | 단일 책임, 각 모듈 독립 테스트 가능 |
| **우선순위** | P2 |
| **난이도** | L |
| **의존성** | 2-2, 2-3 완료 후 |

#### 4-2. 수집기 공통 베이스 모듈
| 항목 | 내용 |
|------|------|
| **문제** | 7개 수집기에 반복되는 패턴 (fetch → parse → dedup → save) |
| **개선** | `lib/base_collector.mjs` 도입: |
| | - 공통 JSONL 저장 로직 |
| | - 재시도/backoff 유틸 |
| | - 중복 제거 Set 관리 |
| | - 진행률 리포팅 |
| | 각 수집기는 플랫폼별 fetch/parse만 구현 |
| **효과** | 신규 플랫폼 추가 시 보일러플레이트 30-40% 감소 (핵심 복잡도는 플랫폼별 인증/세션에 있으므로 공통화 한계 존재) |
| **주의** | KB부동산은 어댑터 패턴 미적용 (별도 `kbland_persist_db.mjs` 사용). base collector 도입 시 통합 여부 별도 판단 필요 |
| **우선순위** | P2 |
| **난이도** | L |
| **의존성** | 2-1 완료 후, 3-2(파싱 테스트) 선행 권장 |

#### 4-3. 프론트엔드 컴포넌트 분리
| 항목 | 내용 |
|------|------|
| **문제** | `ListingSearch.jsx` 666줄 모놀리식, prop drilling 5단계 |
| **개선** | 컴포넌트 분리: |
| | - `ListingFilters.jsx` (필터 UI) |
| | - `ListingTable.jsx` (목록 테이블) |
| | - `ListingDetailModal.jsx` (상세 모달) |
| | - `ImageGallery.jsx` (이미지 갤러리) |
| | Context API 또는 zustand로 검색 상태 관리 |
| **효과** | 컴포넌트 재사용성, 유지보수성 향상 |
| **우선순위** | P2 |
| **난이도** | L |
| **의존성** | 없음 |

#### 4-4. CSS 모듈화
| 항목 | 내용 |
|------|------|
| **문제** | `styles.css` 단일 파일 1,727줄 |
| **개선** | CSS Modules 또는 컴포넌트별 `.css` 파일 분리 |
| **효과** | 스타일 충돌 방지, 컴포넌트 독립성 |
| **우선순위** | P3 |
| **난이도** | M |
| **의존성** | 4-3과 병행 |

#### 4-5. 구조화 로깅 도입
| 항목 | 내용 |
|------|------|
| **문제** | 1,226개 `console.log` 호출, 레벨 구분 없음 |
| **개선** | 경량 로거 모듈 (`lib/logger.mjs`) 도입: |
| | - DEBUG / INFO / WARN / ERROR 레벨 |
| | - 환경변수로 레벨 제어 (`LOG_LEVEL=warn`) |
| | - 수집기 실행 시 요약 리포트 |
| | (pino/winston 같은 외부 라이브러리 대신 자체 경량 구현 권장 — 개인 프로젝트 규모) |
| **효과** | 디버깅 효율 향상, 운영 모니터링 가능 |
| **우선순위** | P2 |
| **난이도** | M |
| **의존성** | 없음 |

---

### Phase 5: 인프라/운영 (장기)

#### 5-1. CI/CD 파이프라인
| 항목 | 내용 |
|------|------|
| **문제** | GitHub Actions 없음, 테스트/린트/빌드 자동화 없음 |
| **개선** | `.github/workflows/ci.yml` — push 시 lint + test + build 자동 실행 |
| **효과** | 회귀 자동 감지 |
| **우선순위** | P2 |
| **난이도** | M |
| **의존성** | Phase 3 (테스트 존재해야 의미) |

#### 5-2. DB 인덱스 보완
| 항목 | 내용 |
|------|------|
| **문제** | `payload_json` JSONB에 GIN 인덱스 없음, `listed_at`/`available_date`가 TEXT 타입 |
| **개선** | GIN 인덱스 추가 (raw_listings.payload_json), 날짜 컬럼 TIMESTAMPTZ 마이그레이션 |
| **효과** | JSONB 쿼리 성능 향상, 날짜 연산 정확성 |
| **우선순위** | P3 |
| **난이도** | M |
| **의존성** | 없음 |

#### 5-3. API 문서화
| 항목 | 내용 |
|------|------|
| **문제** | REST API 엔드포인트 문서 없음 |
| **개선** | `docs/API.md`에 각 엔드포인트 request/response 문서화 |
| **효과** | 프론트엔드 개발 시 참조 용이 |
| **우선순위** | P3 |
| **난이도** | S |
| **의존성** | 없음 |

---

## 4. 우선순위 매트릭스

```
                    낮은 난이도 ←──────────────→ 높은 난이도
높은 ┌─────────────────────────────────────────────────────┐
효과 │  1-1 레거시 삭제(P0/S)   2-1 유틸 추출(P1/M)        │
 │  │  1-2 archive 정리(P0/S)  2-2 DB통합(P1/M)           │
 │  │  1-3 deps 정리(P0/S)     3-1 어댑터 테스트(P1/M)     │
 │  │  2-4 env 정리(P1/S)      2-3 Pool 도입(P1/M)        │
 │  │                          4-2 base collector(P2/L)   │
 │  ├─────────────────────────────────────────────────────┤
 │  │  1-4 migration 번호(P1/S) 4-1 persistence 분리(P2/L)│
 │  │  3-4 coverage(P2/S)      4-3 FE 분리(P2/L)          │
낮은 │  5-3 API 문서(P3/S)       4-5 로깅(P2/M)            │
효과 │                          5-1 CI/CD(P2/M)            │
     │                          5-2 DB 인덱스(P3/M)        │
     └─────────────────────────────────────────────────────┘
```

**실행 순서 권장:**
```
Phase 1 (1-2일)       → Phase 2 (2-3일)     → Phase 3 (1주)       → Phase 4+ (필요 시)
━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━
1-1 레거시 삭제*       2-1 유틸 추출         3-1 어댑터 테스트     4-1 persistence 분리
1-2 archive 정리       2-4 env 정리          3-2 파싱 테스트       4-2 base collector
1-3 deps 제거**        2-3 Pool 도입         3-4 커버리지 설정     4-3 FE 분리
1-4 migration 번호                                               4-5 구조화 로깅
1-5 fix/check 정리

* run_parallel_collect.mjs:69 참조 제거 선행
** playwright-extra peer dep 확인 선행
```

---

## 5. ROI 분석 (개인 프로젝트 관점)

### 가장 ROI 높은 항목 (반드시 해야 함)

| 순위 | 항목 | 이유 |
|------|------|------|
| 1 | 레거시 파일 삭제 (1-1, 1-2) | 5분 작업으로 ~4,000줄 정리 |
| 2 | 어댑터 단위 테스트 (3-1) | rent/deposit 스왑 같은 데이터 버그 재발 방지. 최근 실제 발생 |
| 3 | 공유 유틸 추출 (2-1) | 동일 버그가 3곳에서 발생하는 위험 제거 |
| 4 | DB 클라이언트 통합 (2-2, 2-3) | Pool 도입으로 API 서버 안정성 향상 |

### ROI 낮은 항목 (후순위)

| 항목 | 이유 |
|------|------|
| CSS 모듈화 (4-4) | 현재 스타일 충돌 이슈 없음, 개인 사용 |
| API 문서화 (5-3) | 프론트엔드 개발자 본인만 사용 |
| CI/CD (5-1) | 개인 프로젝트에서 push 빈도 낮음, 로컬 테스트로 충분 |
| DB 인덱스 (5-2) | 현재 데이터 규모(~2,000건)에서 성능 이슈 없음 |

---

## 6. 리스크 및 주의사항

### 리팩토링 시 주의점

1. **수집기 변경 시 데이터 호환성**: 어댑터 입출력 형식이 바뀌면 기존 JSONL 재처리 불가. 포맷 변경 시 마이그레이션 스크립트 필요.

2. **해시 유틸 통합 시 데이터 호환성 파괴 위험 [Architect 추가]**: `ensureFnv11()`과 유사 구현의 입력 전처리(`toText()` vs `normalizeText()`)가 다를 수 있음. 하나로 합칠 때 전처리 함수를 잘못 선택하면 DB 기존 해시값과 불일치 발생 → 중복 감지 실패. 통합 전 기존 데이터와의 호환성 검증 필수.

3. **DB persistence 분리 시 트랜잭션**: 현재 multi-table INSERT가 한 함수에서 실행. 분리 전 함수별 의존 그래프를 먼저 파악하고, 트랜잭션 경계 유지 필수.

4. **base collector 도입 시 점진적 마이그레이션**: 한번에 모든 수집기를 리팩토링하지 말고, 새 수집기 추가 시 적용하고 기존 것은 점진적으로 전환.

5. **KB부동산 어댑터 비대칭성 [Critic 추가]**: KB부동산은 다른 플랫폼과 달리 `kbland_listings_adapter.mjs`가 존재하지 않으며, 별도 persistence 경로를 사용. base collector/adapter 패턴 도입 시 이 비대칭성을 인지하고 통합 여부를 별도 판단해야 함.

6. **프론트엔드 상태 관리 전환**: zustand 도입 시 기존 prop 구조 전부 변경 필요. 특정 뷰부터 점진 적용.

### 하지 말아야 할 것

- **Express/Fastify 전환**: 현재 `node:http` API 서버가 충분히 동작. 라우팅도 이미 모듈 분리됨. 미들웨어(인증, rate-limit) 필요해지면 재고.
- **TypeScript 전환**: 코드베이스 규모와 개인 프로젝트 특성상 마이그레이션 비용이 너무 큼. 대안: 어댑터 입출력에 JSDoc `@typedef`만 적용하면 IDE 지원 확보 가능.
- **ORM 도입**: 현재 raw SQL이 문제없이 동작. COALESCE 체인, JSONB 조작 등 ORM으로 표현 어려운 쿼리 다수.
- **모노레포 분리**: frontend/backend를 별도 패키지로 분리하는 것은 현 규모에서 오버엔지니어링.
- **console.log 일괄 치환 [Architect 추가]**: ~1,100건을 한번에 바꾸면 diff 폭발로 리뷰 불가능. 신규 코드부터 로거 적용, 기존 것은 점진 전환.

---

## 7. 결론

**my-rent-finder**는 기능적으로 완성도 높은 MVP이나, 빠른 개발 속도로 인한 기술 부채가 축적된 상태입니다.

**핵심 메시지:**
- Phase 1+2 (즉시 정리 + 코드 품질): **1주 투자로 코드베이스 대폭 정리** 가능
- Phase 3 (테스트): **데이터 품질 버그 재발 방지**에 가장 효과적 (최근 rent/deposit 스왑 실제 발생)
- Phase 4+5: 프로젝트가 성장하면 그때 착수해도 늦지 않음

**즉시 실행 가능한 Quick Win:**
1. `platform_sampling_collect.mjs` 삭제 → 3,624줄 즉시 정리 (선행: `run_parallel_collect.mjs:69` 참조 제거)
2. `scripts/archive/` 삭제 + `_fix_*`/`_check_*` 정리 → 40개+ 파일 정리
3. `puppeteer-extra-plugin-stealth` 제거 (peer dep 확인 후)
4. 어댑터 테스트 1개 작성 → 데이터 품질 회귀 방지 시작
5. `withDbClient()` 내부 Pool 전환 → API 서버 안정성 즉시 향상

---

## Appendix: Architect/Critic 검토 요약

### Architect 핵심 피드백 (기술 타당성)
- Phase 1-2 실현 가능성 **매우 높음**, Phase 4 **중간** (리스크 큼)
- 2-3 Pool 도입은 2-2와 **독립 실행 가능** — 의존성 수정
- base collector "80% 감소"는 과장 → **30-40%가 현실적** (플랫폼별 인증 복잡도)
- 해시 통합 시 전처리 차이로 **데이터 호환성 파괴 위험** — Critical
- `playwright-extra` ↔ `stealth` peer dependency 확인 필요
- `_fix_*` 스크립트는 통합 대상이 아니라 **삭제/archive 대상**

### Critic 핵심 피드백 (완성도/품질)
- 전체 판정: **조건부 승인** — 사실관계 3건 수정 후 즉시 실행 가능
- FNV-1a "3곳 중복" → **사실과 다름** (단일 정의, 정상 import)
- console.log 1,226건 → **실측 ~1,100건** (archive 포함)
- KB부동산 어댑터 비대칭성 **누락** — adapter 파일 없음
- `.env.example`에 Kakao API 키 **누락**
- API 서버 라우팅은 이미 모듈 분리됨 — 심각도 **과장**
- 파일 라인 수 정확성: **8개 파일 전부 실측 일치** (강점)
