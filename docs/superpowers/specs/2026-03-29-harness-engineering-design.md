# Harness Engineering Design — my-rent-finder

**Date**: 2026-03-29
**Status**: Approved
**Scope**: 수집 파이프라인에 하네스 엔지니어링 적용 (LLM API 없이, Claude Code가 운영자)

---

## 1. Overview

기존 `collect_ops_pipeline.mjs` 위에 **하네스 레이어**를 얹어서:
- 각 단계별 품질 게이트 (자동 판정 + 재시도)
- 리스팅 품질 평가 (허위매물 탐지)
- 매칭 2차 검증 (Generator/Evaluator 분리)
- 구조화된 리포트 (Claude Code가 읽고 다음 행동 결정)

핵심 원칙: **생성과 평가의 분리, 명시적 품질 기준, 피드백 루프**.

---

## 2. Architecture

```
harness_runner.mjs (신규 — 단일 진입점)
    │
    ├── Phase 1: Collection
    │   └── run_parallel_collect.mjs (기존)
    │   └── evaluateCollection() ← lib/harness/collection_gate.mjs
    │       └── pass → Phase 2
    │       └── fail → retry (max 2) → fail → log + continue
    │
    ├── Phase 2: Normalization
    │   └── run_listing_adapters.mjs (기존, build_operations_payload.mjs 내부)
    │   └── evaluateNormalization() ← lib/harness/normalization_gate.mjs
    │
    ├── Phase 3: Listing Quality
    │   └── evaluateListingQuality() ← lib/harness/listing_quality.mjs
    │   └── quality_reports 테이블에 저장
    │
    ├── Phase 4: Matching
    │   └── matcher_v1.mjs (기존)
    │   └── matchEvaluator() ← lib/harness/match_evaluator.mjs
    │   └── uncertain 건 리포트
    │
    └── Phase 5: Report
        └── lib/harness/report_builder.mjs
        └── reports/harness-{timestamp}.json
```

### File Structure (신규 파일)

```
scripts/
├── harness_runner.mjs              ← 하네스 진입점
└── lib/
    └── harness/
        ├── collection_gate.mjs     ← 수집 품질 게이트
        ├── normalization_gate.mjs  ← 정규화 품질 게이트
        ├── listing_quality.mjs     ← 리스팅 품질 평가
        ├── match_evaluator.mjs     ← 매칭 2차 검증
        ├── report_builder.mjs      ← 리포트 생성
        └── constants.mjs           ← 공유 상수/기준값
```

---

## 3. Collection Quality Gate

### Input
`parallel_collect_summary_{runId}.json` — 기존 수집 결과 요약

### Grading Rubric

| Metric | Pass Threshold | Weight |
|--------|---------------|--------|
| 수집 성공률 (collected / requested) | >= 80% | 30% |
| 필수 필드 완성률 (address, area, rent, deposit) | >= 90% | 30% |
| 이미지 URL 유효율 | >= 50% | 15% |
| 가격 이상치 비율 (시세 대비 +-300%) | <= 5% | 15% |
| 플랫폼 내 중복 비율 | <= 20% | 10% |

### Scoring

```
totalScore = sum(metric_score * weight)  // 0~100
status = totalScore >= 70 ? 'pass' : 'fail'
```

### Retry Logic
- fail 시 해당 플랫폼만 재수집 (최대 2회)
- 재시도 후에도 fail이면 `status: 'fail'`로 기록하고 다음 단계로 진행
- 재시도 간격: 즉시 (대기 없음)

### Output
```json
{
  "phase": "collection",
  "status": "pass|fail",
  "score": 87,
  "retries": 0,
  "per_platform": {
    "naver": { "score": 92, "status": "pass", "metrics": {...} },
    "dabang": { "score": 65, "status": "fail", "metrics": {...}, "retries": 1 }
  },
  "failed_platforms": ["dabang"],
  "timestamp": "2026-03-29T..."
}
```

---

## 4. Normalization Quality Gate

### Input
정규화 완료 후 `normalized_listings` 테이블 조회

### Checks
- 필수 필드 null 비율: address_text, area_exclusive_m2, rent_amount, deposit_amount
- 좌표 유효율: latitude/longitude not null
- lease_type 분포 이상 감지

### Threshold
- 필수 필드 완성률 >= 90% → pass
- 그 외 → warn (계속 진행하되 리포트에 기록)

### Output
```json
{
  "phase": "normalization",
  "status": "pass|warn",
  "completeness": 94,
  "null_field_counts": { "address_text": 2, "area_exclusive_m2": 5 },
  "total_normalized": 380
}
```

---

## 5. Listing Quality Evaluator

### Input
`normalized_listings` + `listing_images` JOIN

### Scoring Rules

| Pattern | Deduction | Flag |
|---------|-----------|------|
| 이미지 0장 | -25 | `no_images` |
| 보증금/월세가 시세 50% 이하 | -30 | `price_suspiciously_low` |
| 면적 대비 방수 비정상 (area < 20m2 AND rooms >= 3) | -20 | `room_area_mismatch` |
| 필수 필드 3개+ 누락 | -20 | `incomplete_data` |
| 동일 연락처로 20개+ 매물 | -15 | `bulk_lister` |
| 등록일 90일 초과 | -10 | `stale_listing` |
| 설명 없음 or 10자 미만 | -10 | `no_description` |

### Scoring
```
base = 100
score = max(0, base + sum(deductions))
```

### Tiers
- score >= 70: normal (그대로 노출)
- score 40~69: caution (프론트엔드 경고 배지)
- score < 40: suspicious (기본 숨김)

### Storage
기존 `quality_reports` 테이블 활용:
- `completeness_score` → listing quality score (0~100)
- `hallucination_risk` → suspicious 확률 (score를 역산: (100 - score) / 100)
- `review_flags` → JSONB array of flag strings

### Phase Gate
- 전체 매물 중 suspicious 비율 <= 15% → pass
- 초과 시 → warn (리포트에 기록, 계속 진행)

---

## 6. Match Evaluator (2차 검증)

### Generator (기존)
`matcher_v1.mjs` — 가중 점수 기반 매칭
- autoMatch >= 93
- reviewRequired 80~93
- distinct < 80

### Evaluator (신규)
80~93점 구간의 "uncertain" 매칭 쌍에 대해 추가 규칙 적용:

#### Rules
1. **주소 토큰 일치**: 동/호수 추출 후 비교 → 일치 시 +8점
2. **면적+보증금 근접**: area diff <= 2m2 AND deposit diff <= 500만원 → +5점
3. **이미지 URL 교차**: 동일 이미지 URL 존재 → +10점 (같은 사진 = 같은 매물)
4. **층수+방향+방수 일치**: 3개 모두 일치 → +5점, 2개 → +3점
5. **플랫폼 교차 확인**: 서로 다른 플랫폼이면 cross-platform 보너스 +2점

#### Final Decision
```
adjusted_score = original_score + evaluator_bonus
if adjusted_score >= 93 → match
if adjusted_score < 80 → distinct
else → uncertain (리포트에 기록)
```

### Output
```json
{
  "phase": "matching",
  "status": "pass",
  "auto_matched": 45,
  "evaluator_promoted": 8,
  "evaluator_demoted": 3,
  "still_uncertain": 2,
  "uncertain_pairs": [
    { "source_id": 123, "target_id": 456, "original_score": 85, "adjusted_score": 88, "reason": "address partial match" }
  ]
}
```

---

## 7. Harness Runner

### CLI Interface
```bash
# 전체 파이프라인
node scripts/harness_runner.mjs --run-id auto --out-dir scripts/parallel_collect_runs/

# 기존 collect_ops_pipeline.mjs 인자 모두 패스스루
node scripts/harness_runner.mjs --platforms naver,dabang --sigungu 강남구 --sample-cap 50

# 특정 단계만
node scripts/harness_runner.mjs --skip-collect --input-summary path/to/summary.json
```

### Report File
`reports/harness-{runId}-{timestamp}.json`:
```json
{
  "run_id": "2026-03-29-143022",
  "timestamp": "2026-03-29T14:30:22.000Z",
  "duration_ms": 180000,
  "phases": {
    "collection": { "status": "pass", "score": 87, "retries": 0 },
    "normalization": { "status": "pass", "completeness": 94 },
    "quality": { "status": "warn", "suspicious_rate": 12, "flagged_count": 15 },
    "matching": { "status": "pass", "auto_matched": 45, "uncertain": 2 }
  },
  "overall": "pass",
  "next_actions": [
    "review 2 uncertain matches (IDs: 123-456, 789-012)",
    "check 15 flagged listings (8 no_images, 4 price_suspiciously_low, 3 stale_listing)"
  ]
}
```

### Exit Codes
- 0: all phases pass
- 1: one or more phases warn (리포트 참조)
- 2: critical failure (수집 전체 실패 등)

---

## 8. CLAUDE.md Content Plan

프로젝트 루트 `CLAUDE.md`에 포함할 내용:

### Architecture Overview
- 6-platform collection pipeline 흐름도
- 핵심 테이블 관계 (raw → normalized → matches → quality)

### Golden Principles
1. 어댑터는 반드시 `base_listing_adapter.mjs`를 상속
2. DB 스키마 변경은 `db/migrations/` 에 순번 파일로
3. 수집기는 `{platform}_auto_collector.mjs` 네이밍
4. 에러는 삼키지 말고 contract_violations에 기록
5. 새 플랫폼 추가 시: collector + adapter + platform_codes INSERT

### Quality Standards
- 수집 성공률 >= 80%
- 필수 필드 완성률 >= 90%
- 매칭 정확도: autoMatch >= 93, review 80~93

### Operation Guide
- 파이프라인 실행: `node scripts/harness_runner.mjs`
- 리포트 확인: `reports/harness-*.json`
- 문제 발생 시: 리포트의 `next_actions` 따라 행동

---

## 9. DB Schema Changes

### 신규 테이블: 없음
기존 `quality_reports`, `contract_violations` 테이블 활용.

### quality_reports 테이블 활용 방식 변경
- `completeness_score`: listing quality score (0~100)
- `hallucination_risk`: (100 - quality_score) / 100
- `review_flags`: JSONB array of flag strings (e.g., `["no_images", "stale_listing"]`)
- `stale_hours`: 등록일 기준 경과 시간
- `field_confidence`: 필수 필드 완성 비율

### 신규 컬럼 추가 (normalized_listings)
없음. 기존 스키마로 충분.

---

## 10. Non-Goals

- LLM API 호출 (비용 발생) — 전부 rule-based
- 프론트엔드 변경 (이 스펙 범위 밖, 추후 quality badge 추가 가능)
- 기술부채 정리 (하네스 완성 후 별도 진행)
- 알림 시스템 (Slack/Discord) — 리포트 파일로 충분
