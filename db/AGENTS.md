<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-16 | Updated: 2026-02-16 -->

# db

## Purpose
PostgreSQL 데이터베이스 스키마 정의. 매물 수집-정규화-매칭-품질관리 파이프라인의 전체 데이터 모델을 담고 있다. 현재 스키마 정의만 존재하며, 어플리케이션 코드와의 연동은 아직 미구현 상태이다.

## Key Files

| File | Description |
|------|-------------|
| `schema_v1.sql` | **PostgreSQL DDL v1.** 12개 테이블 + 인덱스 정의. 서울 매물 통합(개인 사용) 1차 MVP 대상 |

## Database Schema (schema_v1.sql)

### 테이블 구조 (3-Layer)

**메타 & 수집 관리**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `platform_codes` | 플랫폼 마스터 (직방/다방/네이버/부동산114) | platform_code PK, collection_mode, policy_state |
| `collection_runs` | 수집 실행 이력 (스케줄/상태/실패코드) | run_id PK, platform_code FK, status, query_district |

**원시층 (Raw Layer)**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `raw_listings` | 플랫폼 원본 보존 (JSONB payload) | raw_id PK, platform_code+external_id UNIQUE, payload_json, raw_status |

**정규화층 (Normalized Layer)**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `normalized_listings` | 통합 검색 기준 매물 | listing_id PK, lease_type, rent_amount, deposit_amount, area_*, address_*, room_count, floor |
| `listing_images` | 매물 이미지 (eager 2장 + on-demand) | image_id PK, listing_id FK, source_url UNIQUE, status, phash |

**파생층 (Derived Layer)**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `matcher_runs` | 매칭 알고리즘 실행 이력 | matcher_run_id PK, algorithm_version, threshold_json |
| `listing_matches` | 매물 쌍별 매칭 점수 | match_id PK, source/target_listing_id FK, score 0~100, status |
| `match_groups` | 동일 매물 군집 | group_id PK, canonical_key, canonical_status (OPEN/CLOSED/CONFLICT) |
| `match_group_members` | 군집 소속 매물 | group_id+listing_id PK |

**품질 관리**
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `contract_violations` | 계약 위반 감사 로그 | violation_id PK, scope(RAW/NORMALIZED/IMAGE/MATCHER), violation_code, severity |
| `quality_reports` | 매물별 품질 점수 | report_id PK, completeness_score, hallucination_risk |
| `image_fetch_jobs` | 이미지 지연 수집 작업 큐 | image_job_id PK, reason(LIST_VIEW/COMPARE_VIEW/BOOKMARK/MANUAL), status |

### 핵심 인덱스
- `idx_raw_listings_platform`: platform_code + collected_at DESC (플랫폼별 최신 수집)
- `idx_normalized_platform`: platform_code + address_code + rent_amount + room_count (검색 필터)
- `idx_normalized_address`: address_code + lease_type (주소 기반 매칭)
- `idx_listing_matches_status`: status + matcher_run_id (매칭 결과 조회)

### 제약 조건
- `raw_listings`: (platform_code, external_id) UNIQUE → 동일 플랫폼 동일 매물 중복 방지
- `normalized_listings`: (platform_code, external_id) UNIQUE + (source_ref) UNIQUE
- `listing_matches`: (matcher_run_id, source_listing_id, target_listing_id) UNIQUE → 매칭 쌍 중복 방지
- `listing_images`: (source_url) UNIQUE → 이미지 URL 중복 방지

## For AI Agents

### Working In This Directory
- PostgreSQL 전용 DDL이며 다른 DB 엔진과 호환되지 않을 수 있음 (JSONB, TIMESTAMPTZ 등)
- 스키마 변경 시 `docs/data_contract.md` 및 `docs/data_contract.schema.json`과 동기화 필수
- 현재 마이그레이션 도구(Flyway, Knex 등) 미사용 → 수동 DDL 관리
- `scripts/db_dml_seed.sql`에 시드 데이터 INSERT 예시가 있음

### Testing Requirements
- 스키마 검증: `psql -f db/schema_v1.sql` 로 빈 DB에 적용 테스트
- 시드 데이터: `psql -f scripts/db_dml_seed.sql` 로 샘플 데이터 삽입

### Common Patterns
- 모든 테이블에 `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` 포함
- 변경 추적 필요 테이블은 `updated_at` 추가
- JSONB 컬럼: payload_json(raw), quality_flags, reason_json, extra, policy_state
- FK CASCADE: listing_images, match_group_members → 부모 삭제 시 자동 삭제
- CHECK 제약: lease_type IN ('월세','전세','단기','기타'), score 0~100 등

## Dependencies

### Internal
- `docs/data_contract.md` → 스키마의 논리적 정의 문서
- `docs/data_contract.schema.json` → JSON Schema 형태의 정의
- `scripts/db_dml_seed.sql` → 시드 데이터
- `scripts/adapters/` → normalized_listings 테이블 스키마와 어댑터 출력 스키마가 대응

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
