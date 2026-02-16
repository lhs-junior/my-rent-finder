<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-16 | Updated: 2026-02-16 -->

# scripts

## Purpose
매물 수집, 정규화, 매칭, 검증, 플랫폼 분석을 수행하는 실행 스크립트 모음. 모든 스크립트는 Node.js ESM (.mjs) 기반 CLI 도구이며, `--key=value` 인자 패턴을 따른다.

## Key Files

### 수집 (Collection)
| File | Description |
|------|-------------|
| `naver_api_collector.mjs` | 네이버 부동산 API 직접 호출 수집기. 구/군 코드 기반으로 매물 목록을 가져오며, 엔드포인트 자동 탐색(discovery) + 페이지네이션 + 429 백오프 지원 |
| `naver_playwright_capture.mjs` | Playwright 기반 네이버 부동산 stealth 네트워크 캡처. 브라우저를 열고 사용자가 조작하는 동안 JSON 응답을 자동 가로채 JSONL로 저장 |
| `run_listing_adapters.mjs` | 어댑터 실행 오케스트레이터. 단일 플랫폼(`--platform=naver`) 또는 전체(`--platform=all`) 모드로 raw JSONL을 정규화된 JSON으로 변환 |
| `naver_normalize.mjs` | 네이버 전용 정규화 래퍼. NaverListingAdapter를 직접 호출하여 raw JSONL → normalized JSON 변환 |

### 매칭 (Matching)
| File | Description |
|------|-------------|
| `matcher_v1.mjs` | 동일 매물 매칭 엔진 v1. 주소(0.30) + 좌표거리(0.20) + 면적(0.25) + 가격(0.15) + 속성(0.10) 가중치 점수 계산. Bucket 기반 후보쌍 생성 + Union-Find 군집화. AUTO_MATCH(≥93) / REVIEW_REQUIRED(80~93) / DISTINCT(<80) |

### 검증 (Validation)
| File | Description |
|------|-------------|
| `validate_contract.mjs` | 데이터 계약 검증기. raw JSON이 listing_contract_v0.2 스키마를 준수하는지 필수필드/타입/URL/날짜 검사. ERROR/WARN 레벨 리포트 출력 |
| `evaluate_sampling_results.mjs` | 플랫폼별 샘플링 결과 품질 평가. requiredFieldsRate, violationRate, parseFailRate, imageValidRate 임계치 기반 pass/fail 판정 |

### 분석 (Analysis)
| File | Description |
|------|-------------|
| `calc_platform_feasibility.mjs` | 플랫폼 수집 가능성 자동 평가. 접근성/필드완성도/안정성/비용/업데이트빈도 가중 점수 계산 → A/B/C 등급 분류 → Markdown 보고서 생성 |

### 데이터/설정 파일
| File | Description |
|------|-------------|
| `naver_district_codes.json` | 네이버 부동산 구/군 코드 매핑 (시군구명 → cortarNo) |
| `platform_search_conditions.json` | 수집 대상 검색 조건 정의 (지역, 월세범위, 면적, 매물유형) |
| `platform_feasibility_sample.json` | 플랫폼 수집 가능성 평가 시나리오 입력 데이터 |
| `platform_sampling_results_skeleton.json` | 샘플링 결과 평가 입력 골격 |
| `platform_sampling_results_20260215.json` | 2026-02-15 실제 샘플링 결과 |
| `match_sample_input.json` | matcher_v1 테스트용 샘플 입력 |
| `data_contract_sample_raw.json` | validate_contract 테스트용 raw 데이터 샘플 |
| `db_dml_seed.sql` | PostgreSQL 시드 데이터 (플랫폼 등록, 샘플 매물 INSERT) |

### 출력 파일 (생성물)
| File | Description |
|------|-------------|
| `matcher_output.json` | matcher_v1 실행 결과 |
| `naver_adapter_output.json` | 네이버 어댑터 실행 결과 |
| `adapters_all_output.json` | 전체 플랫폼 어댑터 통합 실행 결과 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | 플랫폼별 Listing Adapter 구현 (see `adapters/AGENTS.md`) |
| `parallel_collect_runs/` | 병렬 수집 실행 결과 저장. 타임스탬프별 서브디렉토리에 각 플랫폼 raw/normalized/summary JSON 저장 |

## For AI Agents

### Working In This Directory
- 모든 `.mjs` 파일은 `#!/usr/bin/env node` + ESM import 방식
- CLI 인자 파싱은 각 스크립트에 내장된 `getArg(name, fallback)` 헬퍼 사용 (공통 라이브러리 없음)
- 스크립트 실행: `node scripts/<name>.mjs --key=value`
- raw 데이터는 JSONL (한 줄 = 하나의 JSON 레코드) 형식
- normalized 데이터는 단일 JSON 파일 (items 배열)

### Common CLI Patterns
```bash
# 네이버 수집
node scripts/naver_api_collector.mjs --sigungu=노원구 --sample-cap=20

# 네이버 Playwright 캡처
node scripts/naver_playwright_capture.mjs --sigungu=노원구 --headed --wait-time=90

# 정규화 (단일 플랫폼)
node scripts/run_listing_adapters.mjs --platform=naver --input=scripts/naver_raw_samples.jsonl

# 정규화 (전체 플랫폼)
node scripts/run_listing_adapters.mjs --platform=all

# 매칭
node scripts/matcher_v1.mjs --input=scripts/match_sample_input.json --out=scripts/matcher_output.json

# 계약 검증
node scripts/validate_contract.mjs --input=scripts/data_contract_sample_raw.json

# 플랫폼 평가
node scripts/calc_platform_feasibility.mjs --config=scripts/platform_feasibility_sample.json
```

### Testing Requirements
- 각 스크립트는 `--input` 인자로 샘플 JSON/JSONL을 받아 독립 실행 가능
- `parallel_collect_runs/` 하위에 실제 수집 결과가 있으므로 통합 테스트 데이터로 활용 가능

### Common Patterns
- 가격 파싱: `parseMoney()` - 억/천만/만/원 한국어 단위 처리
- 면적 파싱: `parseArea()` - m²/평 변환, 범위 표기 처리
- 층수 파싱: `parseFloorRaw()` - "3/15층", "지하1층" 등 한국어 패턴
- 주소 정규화: `normalizeAddress()` - 도로명/지번/동 정보 추출
- 중복 제거: FNV-1a 해시 기반 `hash11()` 함수

## Dependencies

### Internal
- `scripts/adapters/` - 어댑터 모듈 (BaseListingAdapter, 플랫폼별 구현)

### External
- `playwright` - naver_playwright_capture.mjs에서 브라우저 자동화
- `node:fs`, `node:path`, `node:https`, `node:readline` - 표준 라이브러리만 사용

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
