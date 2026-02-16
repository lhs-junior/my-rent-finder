# UltraQA 검증 리포트: Platform Methods + Data/Back/Front 정합성

작성일: 2026-02-16  
범위: `/Users/hyunsoo/personal-projects/my-rent-finder/docs/platform_methods_and_data_back_front.md`

## ULTRAQA Goal
`수집기·어댑터·오케스트레이터·프론트 렌더링 경로가 실제 코드와 일치하고, 실제 저장 기준으로 이동해야 할 지점이 명확한지 확인`

## Cycle 1 결과
- **결과: PASS** (구현된 항목 기준 정합성 확인)

## 검증 항목

### 1) 플랫폼별 수집기와 오케스트레이션 결합 확인
- 검사:
  - `run_parallel_collect.mjs`에서 플랫폼 목록/별칭/캡처 옵션이 실제 엔트리와 정합한지
  - 어댑터 레지스트리(`adapter_registry.mjs`) 존재 여부
- 근거:
  - `scripts/run_parallel_collect.mjs`
  - `scripts/adapters/adapter_registry.mjs`
- 상태: **PASS**
- 비고: 5개 플랫폼(네이버/직방/다방/부동산114/피터팬) 연결성 확인됨.

### 2) 샘플값 혼동(`sample-cap`) 정리
- 검사: 기본값/파싱/이름이 "샘플 개수"인지 "최대 수집량"인지 코드 동작 확인
- 근거:
  - `scripts/run_parallel_collect.mjs` (`normalizeCap`, `--sample-cap` 기본값=100)
- 상태: **PASS**
- 비고: 파일명 기반 저장 임시 디렉터리(`parallel_collect_runs`) 정책 확인.

### 3) Front가 DB를 직접 조회하는지 확인
- 검사: 운영 화면이 DB 직접 접근 없이 API를 통해 렌더링되는지
- 근거:
  - `frontend/src/App.jsx` (`fetchJson` + `/api/ops`, `/api/matches`, `/api/listings`)
  - `scripts/api_server.mjs` (`/api/*` 라우트)
- 상태: **PASS**
- 비고: DB는 API 서버(`/api/*`)를 통해만 조회합니다.

### 4) DB 스키마와 저장 전략 정합성
- 검사: `raw/normalized/match/images/violations` 저장 설계가 현재 DB 스키마와 일치하는지 문서 반영 여부
- 근거:
  - `db/schema_v1.sql`
- 상태: **PASS**
- 비고: 문서에 Back API 대상으로 필요한 테이블/컬럼이 반영됨.

### 5) 미구현 항목(기능적 갭) 식별
- 검사: 남은 런타임 갭 존재 여부
- 상태: **PASS(핵심), TODO(부가)**
- 비고:
  - 핵심 런타임(`/api/ops`, `/api/matches`, `/api/listings`, `/api/collection/runs`, `/api/listings/:id`, `/api/match-groups/:id`) 동작 확인.
  - 대시보드/API 연동은 실데이터 API 중심입니다.
  - ` /api/collection/platform/:platform_code` 는 현재 미지원이므로 추후 추가 권장.

## 최종 판정
- 문서 정합성은 완료되었고, 핵심 목표인 실데이터 영구 저장 + API 렌더링은 구현 상태.
- 다음 초점은 구현(백엔드 upsert + API 고도화)이며, 동일 체크리스트를 2차 Cycle로 재검증해야 함.

## ULTRAQA 결론
- **Goal met for documentation + gap disclosure:** YES
- **Goal met for runtime DB persistence:** YES
- **Runtime parity:** OK (현재는 API-first, 정적 HTML fallback 제거 완료)
