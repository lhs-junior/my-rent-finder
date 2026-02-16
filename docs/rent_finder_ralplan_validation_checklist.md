# /ralplan 합의용 검증 체크리스트 (Planner/Architect/Critic)

버전: `listing_contract_v0.2`  
작성일: `2026-02-15`

## 1) 작업 목표(요약)
- 서울 거주 매물 통합 시스템의 다음 3개 핵심 기준을 우선 합의한다.
  - 동일 매물 매칭 임계치
  - 계약 위반/검증 위반 처리
  - 이미지 저장량 상한

## 2) 합의본(Planner)

### A. 수집 모드 운영
- 플랫폼은 `API`, `STEALTH_AUTOMATION`, `BLOCKED` 중 1개 모드만 가짐
- 모드 전환 규칙:
  - 24시간 실패율 `> 35%` 또는 `CONTRACT_FAIL > 5%`: 하향 강등
  - 7일 안정(실패율 `< 10%`, 위반 누적 없음): 상향 재심사
- 1차 파일럿은 개인 수집 목적에 맞춰 `STEALTH_AUTOMATION` 중심으로 시작
- 플랫폼 정책 위반 징후 발생 시 해당 플랫폼은 즉시 `BLOCKED`로 기록

### B. 매칭 정책
- 정규화 필드 기반 매칭: 주소, 좌표, 면적(전용/공용), 월세/보증금, 층, 방수
- 점수식: `score = 0.30*주소 + 0.20*거리 + 0.25*면적 + 0.15*가격 + 0.10*속성`
- 상태:
  - `AUTO_MATCH`: `>= 93`
  - `REVIEW_REQUIRED`: `80 ~ 92`
  - `DISTINCT`: `< 80`
- 오탐 억제 규칙:
  - 같은 플랫폼, 동일 `external_id`는 병합 우선
  - 주소가 동일해도 면적/가격이 크게 다르면 병합 제한
  - 전용↔공용 면적 혼재는 비율이 `1.05~1.35` 범위에서만 후보 허용
  - 같은 동/호수 + 면적 ±8% + 가격군 동군인 경우 `REVIEW_REQUIRED` 우선

### C. 계약 위반/검증
- 모든 오류는 `contract_violations`에 코드/위치/샘플 원문과 함께 저장
- `ERROR`: 해당 레코드는 노출 제한(`STORED_PARTIAL`), 매칭 점수 계산에서 제외
- `WARN`: 노출은 허용되지만 UI에 경고 뱃지
- 실패 코드 공통화: `FETCH_FAILED`, `PARSE_FAILED`, `NORMALIZE_FAILED`, `MATCH_INCONCLUSIVE`, `CONTRACT_FAIL`

### D. 이미지 용량 상한
- 매물당 기본 저장: 썸네일 + 대표 2장 (최대 2장)
- 상세 이미지: 사용자 이벤트 기반 지연 수집
- 플랫폼/일일 이미지 저장 상한:
  - 일일 1GB
  - 매물당 최대 2장(즉시), 추가는 별도 큐
- 일일 URL 수집 시도에서 유효 이미지율이 `90% 미만`이면 즉시 중단 후 다음 실행에서 재평가

### E. 파이프라인/운영
- 상태 머신: `SCHEDULED → RUNNING → FETCHING → PARSING → NORMALIZING → MATCHING → VALIDATING → STORED/COMPLETED`
- 임계치 초과 시 플랫폼 모드 강등 또는 수집 중단
- 매칭 결과는 `reason_json`을 항상 저장해 사람이 재현 가능해야 함

## 3) Architect 체크리스트
- `raw_listings` -> `normalized_listings` -> `match_*`가 단방향 lineage으로 추적되는가?
- 같은 raw를 여러 normalized로 바꾸는 재정규화 시나리오가 가능한가?
- `listings + images + violations + quality`에 대한 재현성/재산출 가능성이 있는가?
- 가격/면적 단위 정책(㎡↔평)이 플랫폼별 예외 없이 일관적인가?
- 이미지 상한이 저장소, 대역폭, 조회 지연에 미치는 영향이 추정되는가?

## 4) Critic Acceptance Criteria

### Pass
- 초기 200개 샘플 기준 허위 매칭율 `< 8%`
- `contract_violations` 미기록 항목 `0건` (임계 초과 시 플랫폼 강등)
- `ERROR`가 사용자 노출/점수 계산에 투입되지 않음
- 이미지 저장 초과 시 신규 저장이 즉시 제한됨
- `AUTO_MATCH`은 항상 `reason_json`을 가짐

### Fail
- 필수 조건(시·구·동, 월세, 평수)보다 비필수 값 우선 저장
- 원시값/추정값 구분 상실
- 동일 플랫폼 과대병합(동일 주소·면적 다중 병합)
- 계약 위반 데이터가 핵심 점수 계산에 사용

## 5) 산출물(다음 단계)
1. `docs/data_contract.md` 보완(원시/정규화 필드 + 검증 코드)
2. `docs/platform_field_mapping_template.md`에 1~3 플랫폼 샘플 케이스 정리
3. `scripts/matcher_v1.mjs` 기반 DB/DML + matcher 골격 구현

## 6) 사용자 승인(Planner 단계)
- **Proceed**: 현재 합의값으로 진행
- **Request changes**: 임계치/상한값만 수정
- **Skip review**: 바로 구현 단계로 진행
