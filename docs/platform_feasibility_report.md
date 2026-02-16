# 플랫폼 수집 가능성 자동 검증 결과

산출일: 2026-02-15T16:15:58.792Z
시나리오: 서울 초기 탐색 (시·구·동 기반)

조건: 일일 쿼리 140, 최소평수 12평, 월세 20~120만원
예산: DB 일일 3GB, 이미지 일일 1GB, 보관 30일

| 플랫폼 | 모드 | 일일매물(원본) | 일일매물(캡핑) | 일일 DB(GB) | 일일 이미지(GB) | 월 DB(GB) | 월 이미지(GB) | 총점 | 등급 | 경고 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 직방 | STEALTH_AUTOMATION | 29232 | 3000 | 0.023 | 0.401 | 0.687 | 12.016 | 78.7 | B | 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 |
| 다방 | STEALTH_AUTOMATION | 15792 | 3000 | 0.02 | 0.372 | 0.601 | 11.158 | 75.1 | B | 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 |
| 호갱노노 | STEALTH_AUTOMATION | 10080 | 3000 | 0.029 | 0.429 | 0.858 | 12.875 | 72.1 | B | 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 |
| 부동산114 | STEALTH_AUTOMATION | 6888 | 3000 | 0.017 | 0.355 | 0.515 | 10.643 | 68 | B | 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 |
| 당근 부동산 | STEALTH_AUTOMATION | 4536 | 3000 | 0.014 | 0.412 | 0.429 | 12.36 | 66.8 | B | 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 / 필수 필드 완성도 낮음, 사용자검증 필요 |
| 네이버 부동산 | BLOCKED | 4200 | 3000 | 0.023 | 0.458 | 0.687 | 13.733 | 49.7 | C | BLOCKED 모드: 기본 실행 불가, URL/동반 수집 검증 필요 / 실패율 높음(>30%), 모드 강등 감시 / 상한 적용: 일일매물이 상한값으로 캡핑됨 / 일일 상한 임박, 쿼리 제한 필요 / 필수 필드 완성도 낮음, 사용자검증 필요 |

## 2026-02-16 1차 실측 보정

- 샘플 실행 기준: 조건 기반 조회 + 각 플랫폼 단일/소규모 캡처
- PASS: 직방(2/2), 네이버 부동산(1/1)
- FAIL: 다방, 피터팬, 부동산114, 네모, 호갱노노(각 1건씩)
- 네이버 부동산은 BLOCKED 등급이지만 스크립트 경유 1/1 수집 성공하여, 현재 운영상태는 `CAPTURE_PASS`로 분기 처리 중.

## 추천 순위

A군(우선 구현): 없음
B군(조건부 실행): 직방, 다방, 호갱노노, 부동산114, 당근 부동산
C군(보류/STEALTH_AUTOMATION): 네이버 부동산

## 계산 상세(JSON)

```json
[
  {
    "name": "직방",
    "mode": "STEALTH_AUTOMATION",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 208.8,
      "rawDailyListings": 29232,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.023,
      "dailyImageGb": 0.401,
      "monthlyDbGb": 0.687,
      "monthlyImageGb": 12.016
    },
    "scores": {
      "accessScore": 60,
      "fieldScore": 84.6,
      "reliabilityScore": 91,
      "dbBudgetScore": 99.2,
      "imageBudgetScore": 59.9,
      "updateScore": 70,
      "total": 78.7,
      "tier": "B"
    },
    "flags": {
      "extractSuccessRate": 0.87,
      "failureRate": 0.09,
      "requiredCoverageRate": 0.846,
      "savedImagePerListing": 2
    },
    "warnings": [
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요"
    ]
  },
  {
    "name": "다방",
    "mode": "STEALTH_AUTOMATION",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 112.8,
      "rawDailyListings": 15792,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.02,
      "dailyImageGb": 0.372,
      "monthlyDbGb": 0.601,
      "monthlyImageGb": 11.158
    },
    "scores": {
      "accessScore": 40,
      "fieldScore": 90.8,
      "reliabilityScore": 95,
      "dbBudgetScore": 99.3,
      "imageBudgetScore": 62.8,
      "updateScore": 45,
      "total": 75.1,
      "tier": "B"
    },
    "flags": {
      "extractSuccessRate": 0.94,
      "failureRate": 0.05,
      "requiredCoverageRate": 0.908,
      "savedImagePerListing": 2
    },
    "warnings": [
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요"
    ]
  },
  {
    "name": "호갱노노",
    "mode": "STEALTH_AUTOMATION",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 72,
      "rawDailyListings": 10080,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.029,
      "dailyImageGb": 0.429,
      "monthlyDbGb": 0.858,
      "monthlyImageGb": 12.875
    },
    "scores": {
      "accessScore": 60,
      "fieldScore": 76.4,
      "reliabilityScore": 82,
      "dbBudgetScore": 99,
      "imageBudgetScore": 57.1,
      "updateScore": 20,
      "total": 72.1,
      "tier": "B"
    },
    "flags": {
      "extractSuccessRate": 0.6,
      "failureRate": 0.18,
      "requiredCoverageRate": 0.764,
      "savedImagePerListing": 2
    },
    "warnings": [
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요"
    ]
  },
  {
    "name": "부동산114",
    "mode": "STEALTH_AUTOMATION",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 49.2,
      "rawDailyListings": 6888,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.017,
      "dailyImageGb": 0.355,
      "monthlyDbGb": 0.515,
      "monthlyImageGb": 10.643
    },
    "scores": {
      "accessScore": 40,
      "fieldScore": 72.2,
      "reliabilityScore": 88,
      "dbBudgetScore": 99.4,
      "imageBudgetScore": 64.5,
      "updateScore": 20,
      "total": 68,
      "tier": "B"
    },
    "flags": {
      "extractSuccessRate": 0.82,
      "failureRate": 0.12,
      "requiredCoverageRate": 0.722,
      "savedImagePerListing": 2
    },
    "warnings": [
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요"
    ]
  },
  {
    "name": "당근 부동산",
    "mode": "STEALTH_AUTOMATION",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 32.4,
      "rawDailyListings": 4536,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.014,
      "dailyImageGb": 0.412,
      "monthlyDbGb": 0.429,
      "monthlyImageGb": 12.36
    },
    "scores": {
      "accessScore": 40,
      "fieldScore": 67.4,
      "reliabilityScore": 78,
      "dbBudgetScore": 99.5,
      "imageBudgetScore": 58.8,
      "updateScore": 70,
      "total": 66.8,
      "tier": "B"
    },
    "flags": {
      "extractSuccessRate": 0.54,
      "failureRate": 0.22,
      "requiredCoverageRate": 0.674,
      "savedImagePerListing": 2
    },
    "warnings": [
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요",
      "필수 필드 완성도 낮음, 사용자검증 필요"
    ]
  },
  {
    "name": "네이버 부동산",
    "mode": "BLOCKED",
    "estimate": {
      "qpd": 140,
      "listingsPerQuery": 30,
      "rawDailyListings": 4200,
      "dailyListings": 3000,
      "storageRetentionDays": 30,
      "dailyDbGb": 0.023,
      "dailyImageGb": 0.458,
      "monthlyDbGb": 0.687,
      "monthlyImageGb": 13.733
    },
    "scores": {
      "accessScore": 8,
      "fieldScore": 56.2,
      "reliabilityScore": 49,
      "dbBudgetScore": 99.2,
      "imageBudgetScore": 54.2,
      "updateScore": 70,
      "total": 49.7,
      "tier": "C"
    },
    "flags": {
      "extractSuccessRate": 0.15,
      "failureRate": 0.51,
      "requiredCoverageRate": 0.562,
      "savedImagePerListing": 2
    },
    "warnings": [
      "BLOCKED 모드: 기본 실행 불가, URL/동반 수집 검증 필요",
      "실패율 높음(>30%), 모드 강등 감시",
      "상한 적용: 일일매물이 상한값으로 캡핑됨",
      "일일 상한 임박, 쿼리 제한 필요",
      "필수 필드 완성도 낮음, 사용자검증 필요"
    ]
  }
]
```
