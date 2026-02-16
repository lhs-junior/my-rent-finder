<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-16 | Updated: 2026-02-16 -->

# docs

## Purpose
프로젝트 설계 문서, 데이터 계약, 플랫폼 분석 보고서, UI 설계 스펙을 모아둔 문서 디렉토리. 프로젝트의 요구사항, 아키텍처 의사결정, 데이터 스키마 정의의 단일 소스(single source of truth)이다.

## Key Files

### 핵심 설계 문서
| File | Description |
|------|-------------|
| `rent_finder_master_plan.md` | **마스터 설계안.** 프로젝트 목적, MVP 범위, 아키텍처(3-layer), 수집 정책, 동일매물 매칭 설계, 이미지 저장 전략, DB 스키마 요약, 파이프라인 상태머신, 프론트 화면 설계, 하위 작업 목록 등 전체 프로젝트 청사진 |
| `rent_finder_ralplan_validation_checklist.md` | 마스터 플랜 검증 체크리스트 |

### 데이터 계약
| File | Description |
|------|-------------|
| `data_contract.md` | **데이터 계약 v0.2.** Raw 수집 필수/권장 필드, 정규화 스키마, 이미지 계약, 매칭 계약, 검증 오류 코드 정의 (REQ_FIELD_MISSING, PRICE_PARSE_FAIL 등) |
| `data_contract.schema.json` | JSON Schema 2020-12 기반 `listing_contract_v0.2` 공식 스키마. raw payload + normalized + image 구조 정의 |

### 플랫폼 분석
| File | Description |
|------|-------------|
| `platform_feasibility_matrix.md` | 플랫폼 수집 가능성 평가 설계서. 접근성/완성도/비용/정합성/운영 리스크 평가 항목과 수치화 공식 정의 |
| `platform_feasibility_report.md` | **자동 생성** 플랫폼별 점수/등급 보고서. calc_platform_feasibility.mjs 실행 결과 (직방 B등급 78.7점 ~ 네이버 C등급 49.7점) |
| `platform_field_mapping_template.md` | 플랫폼별 필드 매핑 템플릿 |
| `platform_sampling_priority_queue.md` | 샘플링 우선순위 큐 |
| `platform_sampling_runbook_all.md` | 전체 플랫폼 샘플링 실행 가이드 |

### 네이버 부동산 관련
| File | Description |
|------|-------------|
| `naver_stealth_success_guide.md` | 네이버 부동산 stealth 수집 성공 가이드 |
| `naver_budongsan_handoff.md` | 네이버 부동산 수집 핸드오프 문서 |
| `naver_adapter_progress.md` | 네이버 어댑터 개발 진행 상황 |

### 매칭
| File | Description |
|------|-------------|
| `matcher_threshold_v1.md` | 매칭 임계치 v1 설계. 주소/거리/면적/가격/속성 가중치와 AUTO_MATCH(93)/REVIEW_REQUIRED(80) 경계값 정의 |

### UI/프론트
| File | Description |
|------|-------------|
| `ui_planning.md` | UI 기획 문서 |
| `ui_design_spec.md` | UI 디자인 스펙 |
| `ui_composition_showcase.html` | UI 컴포지션 쇼케이스 HTML 프로토타입 |

## For AI Agents

### Working In This Directory
- `rent_finder_master_plan.md`가 프로젝트의 최상위 설계 문서이므로 항상 먼저 참조
- `data_contract.md` + `data_contract.schema.json`이 데이터 형식의 정의이므로 스키마 변경 시 반드시 동기화
- `platform_feasibility_report.md`는 `calc_platform_feasibility.mjs` 스크립트가 자동 생성하므로 직접 수정하지 말 것
- 새 설계 문서 추가 시 기존 명명 패턴(`snake_case.md`)을 따를 것

### Document Relationships
```
rent_finder_master_plan.md (최상위 청사진)
├── data_contract.md + .schema.json (데이터 스키마 정의)
├── platform_feasibility_matrix.md → platform_feasibility_report.md (자동 생성)
├── matcher_threshold_v1.md (매칭 점수 규칙)
├── naver_*.md (네이버 플랫폼 특화 문서)
└── ui_*.md (프론트엔드 설계)
```

### Testing Requirements
- `data_contract.schema.json` 변경 시 `validate_contract.mjs`가 정상 동작하는지 확인
- `platform_feasibility_report.md`는 재생성 가능: `node scripts/calc_platform_feasibility.mjs`

## Dependencies

### Internal
- `scripts/validate_contract.mjs` → `data_contract.schema.json` 참조
- `scripts/calc_platform_feasibility.mjs` → `platform_feasibility_report.md` 생성
- `scripts/matcher_v1.mjs` → `matcher_threshold_v1.md` 설계 기반 구현
- `db/schema_v1.sql` → `data_contract.md`의 스키마 정의를 SQL로 구현

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
