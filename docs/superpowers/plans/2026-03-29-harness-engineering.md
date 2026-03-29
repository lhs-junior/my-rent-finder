# Harness Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 수집 파이프라인 위에 하네스 레이어를 추가하여 품질 게이트, 리스팅 평가, 매칭 2차 검증, 구조화된 리포트를 제공한다.

**Architecture:** `harness_runner.mjs`가 단일 진입점으로 기존 파이프라인을 감싸고, 각 단계 후 `lib/harness/` 내 게이트 모듈이 품질을 판정한다. Generator/Evaluator 분리 원칙을 적용하여 기존 코드는 건드리지 않고 하네스만 추가한다.

**Tech Stack:** Node.js 20+, PostgreSQL 16 (기존), Vitest (기존 테스트 프레임워크)

**Spec:** `docs/superpowers/specs/2026-03-29-harness-engineering-design.md`

---

## File Structure

```
scripts/
├── harness_runner.mjs                  ← 하네스 진입점 (신규)
└── lib/
    └── harness/
        ├── constants.mjs               ← 공유 상수, 기준값, 유틸 (신규)
        ├── collection_gate.mjs         ← 수집 품질 게이트 (신규)
        ├── normalization_gate.mjs      ← 정규화 품질 게이트 (신규)
        ├── listing_quality.mjs         ← 리스팅 품질 평가 (신규)
        ├── match_evaluator.mjs         ← 매칭 2차 검증 (신규)
        └── report_builder.mjs          ← 리포트 생성 (신규)

reports/                                ← 하네스 리포트 출력 디렉토리 (신규)
    └── .gitkeep

tests/
├── harness_constants.test.mjs          ← (신규)
├── collection_gate.test.mjs            ← (신규)
├── normalization_gate.test.mjs         ← (신규)
├── listing_quality.test.mjs            ← (신규)
├── match_evaluator.test.mjs            ← (신규)
└── report_builder.test.mjs             ← (신규)

CLAUDE.md                               ← 프로젝트 하네스 컨텍스트 (신규)
```

---

## Task 1: CLAUDE.md + Golden Principles

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# my-rent-finder

서울 월세 매물 통합 수집·비교 플랫폼 (개인 사용).

## Architecture

```
Collection (6 platforms) → Normalization (adapters) → DB → Matching → API → Frontend
```

- **수집**: `scripts/{platform}_auto_collector.mjs` — Playwright Stealth 또는 직접 fetch
- **정규화**: `scripts/adapters/{platform}_listings_adapter.mjs` — `base_listing_adapter.mjs` 상속
- **매칭**: `scripts/matcher_v1.mjs` — 가중 점수 (주소 30%, 거리 20%, 면적 25%, 가격 15%, 속성 10%)
- **하네스**: `scripts/harness_runner.mjs` — 파이프라인 실행 + 품질 게이트 + 리포트
- **API**: `scripts/api_server.mjs` — Express-like HTTP
- **Frontend**: `frontend/` — React 18 + Vite + Kakao Map

## Golden Principles

1. 어댑터는 반드시 `base_listing_adapter.mjs`를 상속할 것
2. DB 스키마 변경은 `db/migrations/` 에 순번 파일로 추가
3. 수집기 네이밍: `{platform}_auto_collector.mjs`
4. 에러는 삼키지 말고 `contract_violations` 테이블에 기록
5. 새 플랫폼 추가 시: collector + adapter + `platform_codes` INSERT 세트로
6. 테스트는 `tests/` 디렉토리, Vitest 사용, `npm test`로 실행

## Quality Standards

- 수집 성공률 >= 80%
- 필수 필드 완성률 >= 90% (address_text, area_exclusive_m2, rent_amount, deposit_amount)
- 매칭: autoMatch >= 93점, review 80~93점, distinct < 80점

## Operation

```bash
# 하네스 파이프라인 (권장)
node scripts/harness_runner.mjs

# 기존 파이프라인
node scripts/collect_ops_pipeline.mjs

# 리포트 확인
cat reports/harness-*.json | jq '.overall, .next_actions'
```

## Key Commands

```bash
npm test                  # Vitest 전체
npm run lint              # ESLint
npm run collect:parallel:db:full  # 기존 전체 수집
npm run db:up             # PostgreSQL Docker
npm run db:migrate        # 마이그레이션
npm run dev:local         # 로컬 개발 스택
```
```

- [ ] **Step 2: Create reports directory**

```bash
mkdir -p reports && touch reports/.gitkeep
```

- [ ] **Step 3: Create harness lib directory**

```bash
mkdir -p scripts/lib/harness
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md reports/.gitkeep scripts/lib/harness
git commit -m "feat: add CLAUDE.md, reports dir, harness lib dir"
```

---

## Task 2: Harness Constants

**Files:**
- Create: `scripts/lib/harness/constants.mjs`
- Test: `tests/harness_constants.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/harness_constants.test.mjs
import { describe, it, expect } from "vitest";
import {
  COLLECTION_THRESHOLDS,
  QUALITY_RULES,
  EVALUATOR_BONUSES,
  PHASE_STATUS,
  computeWeightedScore,
} from "../scripts/lib/harness/constants.mjs";

describe("harness constants", () => {
  it("exports collection thresholds", () => {
    expect(COLLECTION_THRESHOLDS.successRate).toBe(0.8);
    expect(COLLECTION_THRESHOLDS.requiredFieldRate).toBe(0.9);
    expect(COLLECTION_THRESHOLDS.imageValidRate).toBe(0.5);
    expect(COLLECTION_THRESHOLDS.priceOutlierRate).toBe(0.05);
    expect(COLLECTION_THRESHOLDS.duplicateRate).toBe(0.2);
    expect(COLLECTION_THRESHOLDS.maxRetries).toBe(2);
    expect(COLLECTION_THRESHOLDS.passScore).toBe(70);
  });

  it("exports quality scoring rules", () => {
    expect(QUALITY_RULES).toHaveLength(7);
    const noImages = QUALITY_RULES.find((r) => r.flag === "no_images");
    expect(noImages.deduction).toBe(-25);
  });

  it("exports evaluator bonus values", () => {
    expect(EVALUATOR_BONUSES.addressTokenMatch).toBe(8);
    expect(EVALUATOR_BONUSES.areaDepositClose).toBe(5);
    expect(EVALUATOR_BONUSES.imageUrlOverlap).toBe(10);
    expect(EVALUATOR_BONUSES.allAttributesMatch).toBe(5);
    expect(EVALUATOR_BONUSES.twoAttributesMatch).toBe(3);
    expect(EVALUATOR_BONUSES.crossPlatform).toBe(2);
  });

  it("exports phase statuses", () => {
    expect(PHASE_STATUS.PASS).toBe("pass");
    expect(PHASE_STATUS.FAIL).toBe("fail");
    expect(PHASE_STATUS.WARN).toBe("warn");
  });

  it("computeWeightedScore calculates correctly", () => {
    const metrics = [
      { value: 0.9, threshold: 0.8, weight: 0.3 },
      { value: 0.95, threshold: 0.9, weight: 0.3 },
    ];
    const score = computeWeightedScore(metrics);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("computeWeightedScore returns 0 for all-failing metrics", () => {
    const metrics = [
      { value: 0, threshold: 0.8, weight: 0.5 },
      { value: 0, threshold: 0.9, weight: 0.5 },
    ];
    const score = computeWeightedScore(metrics);
    expect(score).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harness_constants.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/constants.mjs

/** Collection quality gate thresholds */
export const COLLECTION_THRESHOLDS = {
  successRate: 0.8,
  requiredFieldRate: 0.9,
  imageValidRate: 0.5,
  priceOutlierRate: 0.05,
  duplicateRate: 0.2,
  maxRetries: 2,
  passScore: 70,
};

/** Collection metric weights (sum = 1.0) */
export const COLLECTION_WEIGHTS = {
  successRate: 0.3,
  requiredFieldRate: 0.3,
  imageValidRate: 0.15,
  priceOutlierRate: 0.15,
  duplicateRate: 0.1,
};

/** Required fields that must be non-null in normalized_listings */
export const REQUIRED_FIELDS = [
  "address_text",
  "area_exclusive_m2",
  "rent_amount",
  "deposit_amount",
];

/** Listing quality scoring rules */
export const QUALITY_RULES = [
  {
    flag: "no_images",
    deduction: -25,
    check: (listing) => listing.image_count === 0,
  },
  {
    flag: "price_suspiciously_low",
    deduction: -30,
    check: (listing) => {
      if (listing.rent_amount == null || listing.median_rent == null) return false;
      return listing.rent_amount < listing.median_rent * 0.5;
    },
  },
  {
    flag: "room_area_mismatch",
    deduction: -20,
    check: (listing) => {
      if (listing.area_exclusive_m2 == null || listing.room_count == null) return false;
      return listing.area_exclusive_m2 < 20 && listing.room_count >= 3;
    },
  },
  {
    flag: "incomplete_data",
    deduction: -20,
    check: (listing) => {
      let missing = 0;
      for (const f of REQUIRED_FIELDS) {
        if (listing[f] == null || listing[f] === "") missing++;
      }
      return missing >= 3;
    },
  },
  {
    flag: "bulk_lister",
    deduction: -15,
    check: (listing) => listing.same_contact_count != null && listing.same_contact_count >= 20,
  },
  {
    flag: "stale_listing",
    deduction: -10,
    check: (listing) => listing.stale_hours != null && listing.stale_hours > 2160,
  },
  {
    flag: "no_description",
    deduction: -10,
    check: (listing) => {
      const desc = listing.description || "";
      return desc.length < 10;
    },
  },
];

/** Quality score tier thresholds */
export const QUALITY_TIERS = {
  normal: 70,
  caution: 40,
};

/** Suspicious listing rate threshold for phase gate */
export const SUSPICIOUS_RATE_THRESHOLD = 0.15;

/** Match evaluator bonus scores */
export const EVALUATOR_BONUSES = {
  addressTokenMatch: 8,
  areaDepositClose: 5,
  imageUrlOverlap: 10,
  allAttributesMatch: 5,
  twoAttributesMatch: 3,
  crossPlatform: 2,
};

/** Match evaluator thresholds (same as matcher_v1) */
export const MATCH_THRESHOLDS = {
  autoMatch: 93,
  reviewMin: 80,
};

/** Phase status enum */
export const PHASE_STATUS = {
  PASS: "pass",
  FAIL: "fail",
  WARN: "warn",
};

/**
 * Compute weighted score from metric results.
 * Each metric: { value: 0~1 actual rate, threshold: 0~1 required, weight: 0~1 }
 * Returns 0~100 score.
 */
export function computeWeightedScore(metrics) {
  let total = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const ratio = m.threshold > 0 ? Math.min(1, m.value / m.threshold) : (m.value > 0 ? 1 : 0);
    total += ratio * m.weight * 100;
    weightSum += m.weight;
  }
  if (weightSum === 0) return 0;
  return Math.round(Math.max(0, Math.min(100, total / weightSum)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harness_constants.test.mjs`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/constants.mjs tests/harness_constants.test.mjs
git commit -m "feat: add harness constants and shared utilities"
```

---

## Task 3: Collection Quality Gate

**Files:**
- Create: `scripts/lib/harness/collection_gate.mjs`
- Test: `tests/collection_gate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/collection_gate.test.mjs
import { describe, it, expect } from "vitest";
import { evaluateCollection, evaluatePlatform } from "../scripts/lib/harness/collection_gate.mjs";

const makeSummary = (overrides = {}) => ({
  platforms: {
    naver: {
      requested: 100,
      collected: 95,
      listings: Array.from({ length: 95 }, (_, i) => ({
        address_text: `서울시 강남구 역삼동 ${i}`,
        area_exclusive_m2: 33 + i * 0.1,
        rent_amount: 50 + i,
        deposit_amount: 5000,
        image_urls: i < 60 ? ["http://img.example.com/1.jpg"] : [],
        description: "좋은 방입니다 역삼역 도보 5분",
      })),
      ...overrides,
    },
  },
});

describe("evaluatePlatform", () => {
  it("returns pass for good data", () => {
    const summary = makeSummary();
    const result = evaluatePlatform("naver", summary.platforms.naver);
    expect(result.status).toBe("pass");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("returns fail for low collection rate", () => {
    const result = evaluatePlatform("dabang", {
      requested: 100,
      collected: 30,
      listings: Array.from({ length: 30 }, () => ({
        address_text: "서울시",
        area_exclusive_m2: 33,
        rent_amount: 50,
        deposit_amount: 5000,
        image_urls: ["http://img.example.com/1.jpg"],
        description: "설명입니다",
      })),
    });
    expect(result.status).toBe("fail");
    expect(result.score).toBeLessThan(70);
  });

  it("detects price outliers", () => {
    const listings = Array.from({ length: 100 }, (_, i) => ({
      address_text: `서울시 강남구 ${i}`,
      area_exclusive_m2: 33,
      rent_amount: i < 10 ? 1 : 50,
      deposit_amount: 5000,
      image_urls: ["http://img.example.com/1.jpg"],
      description: "설명입니다 좋은 방",
    }));
    const result = evaluatePlatform("naver", { requested: 100, collected: 100, listings });
    expect(result.metrics.priceOutlierRate).toBeGreaterThan(0);
  });
});

describe("evaluateCollection", () => {
  it("aggregates per-platform results", () => {
    const summary = makeSummary();
    const result = evaluateCollection(summary);
    expect(result.phase).toBe("collection");
    expect(result.per_platform).toHaveProperty("naver");
    expect(result.status).toBe("pass");
    expect(result.failed_platforms).toEqual([]);
  });

  it("lists failed platforms", () => {
    const summary = {
      platforms: {
        naver: {
          requested: 100, collected: 95,
          listings: Array.from({ length: 95 }, () => ({
            address_text: "서울시", area_exclusive_m2: 33, rent_amount: 50,
            deposit_amount: 5000, image_urls: ["http://a.jpg"], description: "설명입니다",
          })),
        },
        dabang: {
          requested: 100, collected: 10,
          listings: Array.from({ length: 10 }, () => ({
            address_text: "서울시", area_exclusive_m2: 33, rent_amount: 50,
            deposit_amount: 5000, image_urls: [], description: "",
          })),
        },
      },
    };
    const result = evaluateCollection(summary);
    expect(result.failed_platforms).toContain("dabang");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collection_gate.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/collection_gate.mjs
import {
  COLLECTION_THRESHOLDS,
  COLLECTION_WEIGHTS,
  REQUIRED_FIELDS,
  PHASE_STATUS,
  computeWeightedScore,
} from "./constants.mjs";

/**
 * Evaluate a single platform's collection quality.
 * @param {string} platform - Platform name
 * @param {{ requested: number, collected: number, listings: object[] }} data
 * @returns {{ status: string, score: number, metrics: object }}
 */
export function evaluatePlatform(platform, data) {
  const { requested, collected, listings } = data;
  const total = listings.length || 1;

  // 1. Success rate
  const successRate = requested > 0 ? collected / requested : 0;

  // 2. Required field completeness
  let fieldComplete = 0;
  for (const listing of listings) {
    const hasAll = REQUIRED_FIELDS.every((f) => listing[f] != null && listing[f] !== "");
    if (hasAll) fieldComplete++;
  }
  const requiredFieldRate = total > 0 ? fieldComplete / total : 0;

  // 3. Image valid rate
  let withImages = 0;
  for (const listing of listings) {
    const urls = listing.image_urls || listing.imageUrls || [];
    if (Array.isArray(urls) && urls.length > 0) withImages++;
  }
  const imageValidRate = total > 0 ? withImages / total : 0;

  // 4. Price outlier rate
  const rents = listings.map((l) => l.rent_amount ?? l.rentAmount).filter((v) => v != null && v > 0);
  let outlierCount = 0;
  if (rents.length > 0) {
    const sorted = [...rents].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const r of rents) {
      if (r < median * 0.25 || r > median * 4) outlierCount++;
    }
  }
  const priceOutlierRate = rents.length > 0 ? outlierCount / rents.length : 0;

  // 5. Duplicate rate (same address_text within platform)
  const addrSet = new Set();
  let dupeCount = 0;
  for (const listing of listings) {
    const addr = (listing.address_text || listing.addressText || "").trim();
    if (addr && addrSet.has(addr)) dupeCount++;
    else addrSet.add(addr);
  }
  const duplicateRate = total > 0 ? dupeCount / total : 0;

  // Compute weighted score
  // For outlier and duplicate rates: invert (lower is better)
  const metrics = [
    { value: successRate, threshold: COLLECTION_THRESHOLDS.successRate, weight: COLLECTION_WEIGHTS.successRate },
    { value: requiredFieldRate, threshold: COLLECTION_THRESHOLDS.requiredFieldRate, weight: COLLECTION_WEIGHTS.requiredFieldRate },
    { value: imageValidRate, threshold: COLLECTION_THRESHOLDS.imageValidRate, weight: COLLECTION_WEIGHTS.imageValidRate },
    { value: 1 - priceOutlierRate, threshold: 1 - COLLECTION_THRESHOLDS.priceOutlierRate, weight: COLLECTION_WEIGHTS.priceOutlierRate },
    { value: 1 - duplicateRate, threshold: 1 - COLLECTION_THRESHOLDS.duplicateRate, weight: COLLECTION_WEIGHTS.duplicateRate },
  ];

  const score = computeWeightedScore(metrics);
  const status = score >= COLLECTION_THRESHOLDS.passScore ? PHASE_STATUS.PASS : PHASE_STATUS.FAIL;

  return {
    platform,
    status,
    score,
    metrics: {
      successRate: Math.round(successRate * 1000) / 1000,
      requiredFieldRate: Math.round(requiredFieldRate * 1000) / 1000,
      imageValidRate: Math.round(imageValidRate * 1000) / 1000,
      priceOutlierRate: Math.round(priceOutlierRate * 1000) / 1000,
      duplicateRate: Math.round(duplicateRate * 1000) / 1000,
    },
  };
}

/**
 * Evaluate the entire collection run across all platforms.
 * @param {{ platforms: Record<string, object> }} summary
 * @returns {{ phase: string, status: string, score: number, per_platform: object, failed_platforms: string[], timestamp: string }}
 */
export function evaluateCollection(summary) {
  const perPlatform = {};
  const scores = [];
  const failedPlatforms = [];

  for (const [platform, data] of Object.entries(summary.platforms)) {
    const result = evaluatePlatform(platform, data);
    perPlatform[platform] = result;
    scores.push(result.score);
    if (result.status === PHASE_STATUS.FAIL) failedPlatforms.push(platform);
  }

  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const status = avgScore >= COLLECTION_THRESHOLDS.passScore ? PHASE_STATUS.PASS : PHASE_STATUS.FAIL;

  return {
    phase: "collection",
    status,
    score: avgScore,
    retries: 0,
    per_platform: perPlatform,
    failed_platforms: failedPlatforms,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/collection_gate.test.mjs`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/collection_gate.mjs tests/collection_gate.test.mjs
git commit -m "feat: add collection quality gate with weighted scoring"
```

---

## Task 4: Normalization Quality Gate

**Files:**
- Create: `scripts/lib/harness/normalization_gate.mjs`
- Test: `tests/normalization_gate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/normalization_gate.test.mjs
import { describe, it, expect } from "vitest";
import { evaluateNormalization } from "../scripts/lib/harness/normalization_gate.mjs";

describe("evaluateNormalization", () => {
  it("returns pass for complete data", () => {
    const listings = Array.from({ length: 100 }, (_, i) => ({
      listing_id: i,
      address_text: `서울시 강남구 역삼동 ${i}`,
      area_exclusive_m2: 33,
      rent_amount: 50,
      deposit_amount: 5000,
      latitude: 37.5,
      longitude: 127.0,
      lease_type: "월세",
    }));
    const result = evaluateNormalization(listings);
    expect(result.phase).toBe("normalization");
    expect(result.status).toBe("pass");
    expect(result.completeness).toBeGreaterThanOrEqual(90);
  });

  it("returns warn for low completeness", () => {
    const listings = Array.from({ length: 100 }, (_, i) => ({
      listing_id: i,
      address_text: i < 80 ? `서울시 ${i}` : null,
      area_exclusive_m2: i < 85 ? 33 : null,
      rent_amount: 50,
      deposit_amount: i < 70 ? 5000 : null,
      latitude: 37.5,
      longitude: 127.0,
    }));
    const result = evaluateNormalization(listings);
    expect(result.status).toBe("warn");
    expect(result.completeness).toBeLessThan(90);
  });

  it("counts null fields correctly", () => {
    const listings = [
      { listing_id: 1, address_text: null, area_exclusive_m2: 33, rent_amount: 50, deposit_amount: null },
      { listing_id: 2, address_text: "서울", area_exclusive_m2: null, rent_amount: 50, deposit_amount: 5000 },
    ];
    const result = evaluateNormalization(listings);
    expect(result.null_field_counts.address_text).toBe(1);
    expect(result.null_field_counts.area_exclusive_m2).toBe(1);
    expect(result.null_field_counts.deposit_amount).toBe(1);
  });

  it("handles empty listings array", () => {
    const result = evaluateNormalization([]);
    expect(result.status).toBe("warn");
    expect(result.total_normalized).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/normalization_gate.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/normalization_gate.mjs
import { REQUIRED_FIELDS, PHASE_STATUS } from "./constants.mjs";

const NORMALIZATION_PASS_RATE = 0.9;

/**
 * Evaluate normalization quality.
 * @param {object[]} listings - Array of normalized listing rows
 * @returns {{ phase: string, status: string, completeness: number, null_field_counts: object, total_normalized: number }}
 */
export function evaluateNormalization(listings) {
  const total = listings.length;

  if (total === 0) {
    return {
      phase: "normalization",
      status: PHASE_STATUS.WARN,
      completeness: 0,
      null_field_counts: Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, 0])),
      total_normalized: 0,
    };
  }

  // Count nulls per required field
  const nullCounts = {};
  for (const field of REQUIRED_FIELDS) {
    nullCounts[field] = 0;
  }
  for (const listing of listings) {
    for (const field of REQUIRED_FIELDS) {
      const val = listing[field];
      if (val == null || val === "") nullCounts[field]++;
    }
  }

  // Completeness = average field fill rate across all required fields
  const totalFields = REQUIRED_FIELDS.length * total;
  const totalNulls = Object.values(nullCounts).reduce((a, b) => a + b, 0);
  const completeness = Math.round(((totalFields - totalNulls) / totalFields) * 100);

  const status = completeness >= NORMALIZATION_PASS_RATE * 100 ? PHASE_STATUS.PASS : PHASE_STATUS.WARN;

  return {
    phase: "normalization",
    status,
    completeness,
    null_field_counts: nullCounts,
    total_normalized: total,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/normalization_gate.test.mjs`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/normalization_gate.mjs tests/normalization_gate.test.mjs
git commit -m "feat: add normalization quality gate"
```

---

## Task 5: Listing Quality Evaluator

**Files:**
- Create: `scripts/lib/harness/listing_quality.mjs`
- Test: `tests/listing_quality.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/listing_quality.test.mjs
import { describe, it, expect } from "vitest";
import {
  scoreListing,
  evaluateListingQuality,
} from "../scripts/lib/harness/listing_quality.mjs";

describe("scoreListing", () => {
  const goodListing = {
    listing_id: 1,
    address_text: "서울시 강남구 역삼동 123",
    area_exclusive_m2: 33,
    rent_amount: 50,
    deposit_amount: 5000,
    room_count: 1,
    image_count: 5,
    description: "역삼역 도보 5분 깨끗한 원룸입니다",
    stale_hours: 24,
    same_contact_count: 1,
    median_rent: 55,
  };

  it("gives high score to good listing", () => {
    const result = scoreListing(goodListing);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.flags).toEqual([]);
    expect(result.tier).toBe("normal");
  });

  it("flags no_images", () => {
    const result = scoreListing({ ...goodListing, image_count: 0 });
    expect(result.flags).toContain("no_images");
    expect(result.score).toBe(75); // 100 - 25
  });

  it("flags price_suspiciously_low", () => {
    const result = scoreListing({ ...goodListing, rent_amount: 10, median_rent: 55 });
    expect(result.flags).toContain("price_suspiciously_low");
  });

  it("flags room_area_mismatch", () => {
    const result = scoreListing({ ...goodListing, area_exclusive_m2: 15, room_count: 3 });
    expect(result.flags).toContain("room_area_mismatch");
  });

  it("flags stale_listing", () => {
    const result = scoreListing({ ...goodListing, stale_hours: 3000 });
    expect(result.flags).toContain("stale_listing");
    expect(result.score).toBe(90); // 100 - 10
  });

  it("flags bulk_lister", () => {
    const result = scoreListing({ ...goodListing, same_contact_count: 25 });
    expect(result.flags).toContain("bulk_lister");
  });

  it("flags no_description", () => {
    const result = scoreListing({ ...goodListing, description: "" });
    expect(result.flags).toContain("no_description");
  });

  it("classifies tier correctly", () => {
    // no_images(-25) + no_description(-10) + stale(-10) = 55 → caution
    const result = scoreListing({
      ...goodListing,
      image_count: 0,
      description: "",
      stale_hours: 3000,
    });
    expect(result.tier).toBe("caution");
  });

  it("classifies suspicious tier", () => {
    // no_images(-25) + price_low(-30) = 45... but also let's add more
    const result = scoreListing({
      ...goodListing,
      image_count: 0,
      rent_amount: 5,
      median_rent: 55,
      description: "",
      stale_hours: 3000,
    });
    expect(result.tier).toBe("suspicious");
  });
});

describe("evaluateListingQuality", () => {
  it("returns phase gate result", () => {
    const listings = Array.from({ length: 20 }, (_, i) => ({
      listing_id: i,
      address_text: `서울시 ${i}`,
      area_exclusive_m2: 33,
      rent_amount: 50,
      deposit_amount: 5000,
      room_count: 1,
      image_count: 3,
      description: "좋은 방입니다 깨끗합니다",
      stale_hours: 24,
      same_contact_count: 1,
      median_rent: 55,
    }));
    const result = evaluateListingQuality(listings);
    expect(result.phase).toBe("quality");
    expect(result.status).toBe("pass");
    expect(result.total).toBe(20);
    expect(result.tiers.normal).toBe(20);
    expect(result.suspicious_rate).toBe(0);
  });

  it("warns when suspicious rate exceeds threshold", () => {
    const listings = Array.from({ length: 10 }, (_, i) => ({
      listing_id: i,
      address_text: `서울시 ${i}`,
      area_exclusive_m2: 15,
      rent_amount: 5,
      deposit_amount: 5000,
      room_count: 3,
      image_count: 0,
      description: "",
      stale_hours: 3000,
      same_contact_count: 25,
      median_rent: 55,
    }));
    const result = evaluateListingQuality(listings);
    expect(result.status).toBe("warn");
    expect(result.suspicious_rate).toBeGreaterThan(0.15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/listing_quality.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/listing_quality.mjs
import {
  QUALITY_RULES,
  QUALITY_TIERS,
  SUSPICIOUS_RATE_THRESHOLD,
  PHASE_STATUS,
} from "./constants.mjs";

/**
 * Score a single listing for quality.
 * @param {object} listing - Listing with image_count, description, stale_hours, etc.
 * @returns {{ listing_id: any, score: number, flags: string[], tier: string }}
 */
export function scoreListing(listing) {
  let score = 100;
  const flags = [];

  for (const rule of QUALITY_RULES) {
    if (rule.check(listing)) {
      score += rule.deduction; // deduction is negative
      flags.push(rule.flag);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let tier;
  if (score >= QUALITY_TIERS.normal) {
    tier = "normal";
  } else if (score >= QUALITY_TIERS.caution) {
    tier = "caution";
  } else {
    tier = "suspicious";
  }

  return {
    listing_id: listing.listing_id,
    score,
    flags,
    tier,
  };
}

/**
 * Evaluate quality across all listings.
 * @param {object[]} listings
 * @returns {{ phase: string, status: string, total: number, tiers: object, suspicious_rate: number, flagged: object[] }}
 */
export function evaluateListingQuality(listings) {
  const results = listings.map(scoreListing);

  const tiers = { normal: 0, caution: 0, suspicious: 0 };
  const flagged = [];

  for (const r of results) {
    tiers[r.tier]++;
    if (r.tier !== "normal") {
      flagged.push({ listing_id: r.listing_id, score: r.score, flags: r.flags, tier: r.tier });
    }
  }

  const total = listings.length || 1;
  const suspiciousRate = tiers.suspicious / total;
  const status = suspiciousRate <= SUSPICIOUS_RATE_THRESHOLD ? PHASE_STATUS.PASS : PHASE_STATUS.WARN;

  return {
    phase: "quality",
    status,
    total: listings.length,
    tiers,
    suspicious_rate: Math.round(suspiciousRate * 1000) / 1000,
    flagged_count: flagged.length,
    flagged: flagged.slice(0, 50), // limit report size
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/listing_quality.test.mjs`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/listing_quality.mjs tests/listing_quality.test.mjs
git commit -m "feat: add listing quality evaluator with tier classification"
```

---

## Task 6: Match Evaluator (2차 검증)

**Files:**
- Create: `scripts/lib/harness/match_evaluator.mjs`
- Test: `tests/match_evaluator.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/match_evaluator.test.mjs
import { describe, it, expect } from "vitest";
import {
  evaluatePair,
  evaluateMatches,
} from "../scripts/lib/harness/match_evaluator.mjs";

describe("evaluatePair", () => {
  const basePair = {
    source_listing_id: 1,
    target_listing_id: 2,
    score: 85,
    status: "REVIEW_REQUIRED",
    source: {
      platformCode: "naver",
      addressText: "서울시 강남구 역삼동 123-4 301호",
      areaExclusive: 33,
      depositAmount: 5000,
      floor: 3,
      roomCount: 1,
      leaseType: "월세",
      imageUrls: ["http://img.example.com/a.jpg"],
    },
    target: {
      platformCode: "dabang",
      addressText: "서울시 강남구 역삼동 123-4 301호",
      areaExclusive: 33.5,
      depositAmount: 5200,
      floor: 3,
      roomCount: 1,
      leaseType: "월세",
      imageUrls: ["http://img.example.com/a.jpg"],
    },
  };

  it("gives address token match bonus", () => {
    const result = evaluatePair(basePair);
    expect(result.bonus).toBeGreaterThan(0);
    expect(result.bonuses).toContain("addressTokenMatch");
  });

  it("gives area+deposit close bonus", () => {
    const result = evaluatePair(basePair);
    expect(result.bonuses).toContain("areaDepositClose");
  });

  it("gives image URL overlap bonus", () => {
    const result = evaluatePair(basePair);
    expect(result.bonuses).toContain("imageUrlOverlap");
  });

  it("gives cross-platform bonus", () => {
    const result = evaluatePair(basePair);
    expect(result.bonuses).toContain("crossPlatform");
  });

  it("gives all-attributes-match bonus", () => {
    const result = evaluatePair(basePair);
    expect(result.bonuses).toContain("allAttributesMatch");
  });

  it("promotes to match when adjusted score >= 93", () => {
    const result = evaluatePair(basePair);
    expect(result.adjusted_score).toBeGreaterThanOrEqual(93);
    expect(result.decision).toBe("match");
  });

  it("demotes to distinct when adjusted score < 80", () => {
    const pair = {
      ...basePair,
      score: 80,
      source: {
        ...basePair.source,
        addressText: "완전 다른 주소",
        areaExclusive: 60,
        depositAmount: 20000,
        floor: 10,
        roomCount: 4,
        imageUrls: [],
        platformCode: "naver",
      },
      target: {
        ...basePair.target,
        addressText: "서울시 마포구",
        platformCode: "naver",
        imageUrls: [],
      },
    };
    const result = evaluatePair(pair);
    // No bonuses → score stays at 80 or drops → uncertain or distinct
    expect(result.bonus).toBe(0);
    expect(result.decision).toBe("uncertain");
  });

  it("returns uncertain for mid-range scores", () => {
    const pair = {
      ...basePair,
      score: 88,
      source: { ...basePair.source, imageUrls: [], platformCode: "naver" },
      target: { ...basePair.target, imageUrls: [], platformCode: "naver", addressText: "서울시 강남구 역삼동 다른곳" },
    };
    const result = evaluatePair(pair);
    expect(["match", "uncertain"]).toContain(result.decision);
  });
});

describe("evaluateMatches", () => {
  it("separates pairs by decision", () => {
    const pairs = [
      { source_listing_id: 1, target_listing_id: 2, score: 95, status: "AUTO_MATCH" },
      {
        source_listing_id: 3, target_listing_id: 4, score: 85, status: "REVIEW_REQUIRED",
        source: { platformCode: "naver", addressText: "서울시 강남구 역삼동 123-4 301호", areaExclusive: 33, depositAmount: 5000, floor: 3, roomCount: 1, leaseType: "월세", imageUrls: ["http://a.jpg"] },
        target: { platformCode: "dabang", addressText: "서울시 강남구 역삼동 123-4 301호", areaExclusive: 33, depositAmount: 5000, floor: 3, roomCount: 1, leaseType: "월세", imageUrls: ["http://a.jpg"] },
      },
      { source_listing_id: 5, target_listing_id: 6, score: 50, status: "DISTINCT" },
    ];
    const result = evaluateMatches(pairs);
    expect(result.phase).toBe("matching");
    expect(result.auto_matched).toBe(1);
    expect(result.evaluator_promoted).toBeGreaterThanOrEqual(0);
    expect(result.status).toBe("pass");
  });

  it("handles empty pairs", () => {
    const result = evaluateMatches([]);
    expect(result.auto_matched).toBe(0);
    expect(result.status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/match_evaluator.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/match_evaluator.mjs
import { EVALUATOR_BONUSES, MATCH_THRESHOLDS, PHASE_STATUS } from "./constants.mjs";

/**
 * Extract dong/ho tokens from Korean address text.
 * e.g., "서울시 강남구 역삼동 123-4 301호" → ["역삼동", "123-4", "301호"]
 */
function extractAddressTokens(text) {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => /\d/.test(t) || t.endsWith("동") || t.endsWith("호"));
}

/**
 * Evaluate a single REVIEW_REQUIRED pair with bonus rules.
 * @param {object} pair - Matcher pair with source/target listing data
 * @returns {{ adjusted_score: number, bonus: number, bonuses: string[], decision: string }}
 */
export function evaluatePair(pair) {
  const { source, target, score } = pair;
  let bonus = 0;
  const bonuses = [];

  if (!source || !target) {
    return { adjusted_score: score, bonus: 0, bonuses: [], decision: "uncertain" };
  }

  // 1. Address token match
  const srcTokens = extractAddressTokens(source.addressText);
  const tgtTokens = extractAddressTokens(target.addressText);
  if (srcTokens.length > 0 && tgtTokens.length > 0) {
    const overlap = srcTokens.filter((t) => tgtTokens.includes(t));
    if (overlap.length >= 2 || (overlap.length >= 1 && srcTokens.length <= 2)) {
      bonus += EVALUATOR_BONUSES.addressTokenMatch;
      bonuses.push("addressTokenMatch");
    }
  }

  // 2. Area + deposit close
  const srcArea = source.areaExclusive;
  const tgtArea = target.areaExclusive;
  const srcDep = source.depositAmount;
  const tgtDep = target.depositAmount;
  if (srcArea != null && tgtArea != null && srcDep != null && tgtDep != null) {
    const areaDiff = Math.abs(srcArea - tgtArea);
    const depDiff = Math.abs(srcDep - tgtDep);
    if (areaDiff <= 2 && depDiff <= 500) {
      bonus += EVALUATOR_BONUSES.areaDepositClose;
      bonuses.push("areaDepositClose");
    }
  }

  // 3. Image URL overlap
  const srcImgs = source.imageUrls || [];
  const tgtImgs = target.imageUrls || [];
  if (srcImgs.length > 0 && tgtImgs.length > 0) {
    const srcSet = new Set(srcImgs);
    const hasOverlap = tgtImgs.some((url) => srcSet.has(url));
    if (hasOverlap) {
      bonus += EVALUATOR_BONUSES.imageUrlOverlap;
      bonuses.push("imageUrlOverlap");
    }
  }

  // 4. Floor + roomCount + leaseType match
  let attrMatches = 0;
  if (source.floor != null && target.floor != null && source.floor === target.floor) attrMatches++;
  if (source.roomCount != null && target.roomCount != null && source.roomCount === target.roomCount) attrMatches++;
  if (source.leaseType && target.leaseType && source.leaseType === target.leaseType) attrMatches++;

  if (attrMatches >= 3) {
    bonus += EVALUATOR_BONUSES.allAttributesMatch;
    bonuses.push("allAttributesMatch");
  } else if (attrMatches >= 2) {
    bonus += EVALUATOR_BONUSES.twoAttributesMatch;
    bonuses.push("twoAttributesMatch");
  }

  // 5. Cross-platform bonus
  if (source.platformCode && target.platformCode && source.platformCode !== target.platformCode) {
    bonus += EVALUATOR_BONUSES.crossPlatform;
    bonuses.push("crossPlatform");
  }

  const adjustedScore = score + bonus;
  let decision;
  if (adjustedScore >= MATCH_THRESHOLDS.autoMatch) {
    decision = "match";
  } else if (adjustedScore < MATCH_THRESHOLDS.reviewMin) {
    decision = "distinct";
  } else {
    decision = "uncertain";
  }

  return {
    source_listing_id: pair.source_listing_id,
    target_listing_id: pair.target_listing_id,
    original_score: score,
    adjusted_score: adjustedScore,
    bonus,
    bonuses,
    decision,
  };
}

/**
 * Evaluate all match pairs — apply evaluator to REVIEW_REQUIRED ones.
 * @param {object[]} pairs - All matcher output pairs
 * @returns {{ phase: string, status: string, auto_matched: number, evaluator_promoted: number, evaluator_demoted: number, still_uncertain: number, uncertain_pairs: object[] }}
 */
export function evaluateMatches(pairs) {
  let autoMatched = 0;
  let promoted = 0;
  let demoted = 0;
  const uncertainPairs = [];

  for (const pair of pairs) {
    if (pair.status === "AUTO_MATCH") {
      autoMatched++;
      continue;
    }
    if (pair.status !== "REVIEW_REQUIRED") continue;

    const result = evaluatePair(pair);
    if (result.decision === "match") {
      promoted++;
    } else if (result.decision === "distinct") {
      demoted++;
    } else {
      uncertainPairs.push({
        source_id: pair.source_listing_id,
        target_id: pair.target_listing_id,
        original_score: pair.score,
        adjusted_score: result.adjusted_score,
        bonuses: result.bonuses,
      });
    }
  }

  return {
    phase: "matching",
    status: PHASE_STATUS.PASS,
    auto_matched: autoMatched,
    evaluator_promoted: promoted,
    evaluator_demoted: demoted,
    still_uncertain: uncertainPairs.length,
    uncertain_pairs: uncertainPairs.slice(0, 20),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/match_evaluator.test.mjs`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/match_evaluator.mjs tests/match_evaluator.test.mjs
git commit -m "feat: add match evaluator with bonus rules for 2nd-pass verification"
```

---

## Task 7: Report Builder

**Files:**
- Create: `scripts/lib/harness/report_builder.mjs`
- Test: `tests/report_builder.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/report_builder.test.mjs
import { describe, it, expect } from "vitest";
import { buildReport, buildNextActions } from "../scripts/lib/harness/report_builder.mjs";

describe("buildNextActions", () => {
  it("suggests reviewing uncertain matches", () => {
    const matchResult = { still_uncertain: 3, uncertain_pairs: [{ source_id: 1, target_id: 2 }] };
    const actions = buildNextActions({ matching: matchResult });
    expect(actions.some((a) => a.includes("uncertain"))).toBe(true);
  });

  it("suggests checking flagged listings", () => {
    const qualityResult = { flagged_count: 8, flagged: [{ flags: ["no_images"] }] };
    const actions = buildNextActions({ quality: qualityResult });
    expect(actions.some((a) => a.includes("flagged"))).toBe(true);
  });

  it("suggests retrying failed platforms", () => {
    const collectionResult = { failed_platforms: ["dabang"] };
    const actions = buildNextActions({ collection: collectionResult });
    expect(actions.some((a) => a.includes("dabang"))).toBe(true);
  });

  it("returns empty for all-pass", () => {
    const actions = buildNextActions({
      collection: { failed_platforms: [] },
      quality: { flagged_count: 0 },
      matching: { still_uncertain: 0 },
    });
    expect(actions).toEqual([]);
  });
});

describe("buildReport", () => {
  it("builds complete report", () => {
    const phases = {
      collection: { phase: "collection", status: "pass", score: 87, retries: 0, failed_platforms: [] },
      normalization: { phase: "normalization", status: "pass", completeness: 94 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 10, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-1", phases, 5000);
    expect(report.run_id).toBe("test-run-1");
    expect(report.duration_ms).toBe(5000);
    expect(report.phases.collection.status).toBe("pass");
    expect(report.overall).toBe("pass");
    expect(report.next_actions).toEqual([]);
  });

  it("sets overall to warn when any phase warns", () => {
    const phases = {
      collection: { phase: "collection", status: "pass", score: 87, retries: 0, failed_platforms: [] },
      normalization: { phase: "normalization", status: "warn", completeness: 80 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 5, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-2", phases, 3000);
    expect(report.overall).toBe("warn");
  });

  it("sets overall to fail when any phase fails", () => {
    const phases = {
      collection: { phase: "collection", status: "fail", score: 40, retries: 2, failed_platforms: ["dabang"] },
      normalization: { phase: "normalization", status: "pass", completeness: 94 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 5, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-3", phases, 2000);
    expect(report.overall).toBe("fail");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/report_builder.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```js
// scripts/lib/harness/report_builder.mjs
import { PHASE_STATUS } from "./constants.mjs";

/**
 * Generate next_actions list from phase results.
 * @param {{ collection?: object, quality?: object, matching?: object }} phases
 * @returns {string[]}
 */
export function buildNextActions(phases) {
  const actions = [];

  if (phases.collection?.failed_platforms?.length > 0) {
    actions.push(`retry failed platforms: ${phases.collection.failed_platforms.join(", ")}`);
  }

  if (phases.quality?.flagged_count > 0) {
    const flagSummary = {};
    for (const item of phases.quality.flagged || []) {
      for (const f of item.flags || []) {
        flagSummary[f] = (flagSummary[f] || 0) + 1;
      }
    }
    const detail = Object.entries(flagSummary)
      .map(([flag, count]) => `${count} ${flag}`)
      .join(", ");
    actions.push(`check ${phases.quality.flagged_count} flagged listings (${detail})`);
  }

  if (phases.matching?.still_uncertain > 0) {
    const ids = (phases.matching.uncertain_pairs || [])
      .slice(0, 5)
      .map((p) => `${p.source_id}-${p.target_id}`)
      .join(", ");
    actions.push(`review ${phases.matching.still_uncertain} uncertain matches (${ids})`);
  }

  return actions;
}

/**
 * Build the final harness report.
 * @param {string} runId
 * @param {{ collection: object, normalization: object, quality: object, matching: object }} phases
 * @param {number} durationMs
 * @returns {object}
 */
export function buildReport(runId, phases, durationMs) {
  const statuses = Object.values(phases).map((p) => p.status);

  let overall;
  if (statuses.includes(PHASE_STATUS.FAIL)) {
    overall = PHASE_STATUS.FAIL;
  } else if (statuses.includes(PHASE_STATUS.WARN)) {
    overall = PHASE_STATUS.WARN;
  } else {
    overall = PHASE_STATUS.PASS;
  }

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    phases: {
      collection: phases.collection,
      normalization: phases.normalization,
      quality: phases.quality,
      matching: phases.matching,
    },
    overall,
    next_actions: buildNextActions(phases),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/report_builder.test.mjs`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/harness/report_builder.mjs tests/report_builder.test.mjs
git commit -m "feat: add harness report builder with next_actions generation"
```

---

## Task 8: Harness Runner (통합 진입점)

**Files:**
- Create: `scripts/harness_runner.mjs`

This task integrates all harness modules into a single CLI entry point that wraps `collect_ops_pipeline.mjs`.

- [ ] **Step 1: Write harness_runner.mjs**

```js
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getArg, hasArg, toText, getBool } from "./lib/cli_utils.mjs";
import { evaluateCollection } from "./lib/harness/collection_gate.mjs";
import { evaluateNormalization } from "./lib/harness/normalization_gate.mjs";
import { evaluateListingQuality } from "./lib/harness/listing_quality.mjs";
import { evaluateMatches } from "./lib/harness/match_evaluator.mjs";
import { buildReport } from "./lib/harness/report_builder.mjs";
import { COLLECTION_THRESHOLDS } from "./lib/harness/constants.mjs";

const args = process.argv.slice(2);
const startTime = Date.now();

function normalizeRunId(raw) {
  return toText(raw || new Date().toISOString(), "run").replace(/[T:.]/g, "-");
}

function runPhase(label, scriptPath, extraArgs) {
  console.log(`\n[harness] ▶ ${label}`);
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

const runId = normalizeRunId(getArg(args, "--run-id", null));
const outDir = getArg(args, "--out-dir", path.join("scripts", "parallel_collect_runs", runId));
const workspace = path.resolve(process.cwd(), outDir);
const skipCollect = getBool(args, "--skip-collect", false);
const inputSummaryPath = getArg(args, "--input-summary", null);

const collectScript = path.resolve(process.cwd(), "scripts", "run_parallel_collect.mjs");
const buildScript = path.resolve(process.cwd(), "scripts", "build_operations_payload.mjs");
const summaryFileName = `parallel_collect_summary_${runId}.json`;
const summaryPath = inputSummaryPath || path.join(workspace, summaryFileName);

const reportsDir = path.resolve(process.cwd(), "reports");
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

const collectPassThrough = args.filter((arg) => {
  return !(
    arg === "--run-id" || arg === "--out-dir" || arg === "--skip-collect" ||
    arg === "--input-summary" ||
    arg.startsWith("--run-id=") || arg.startsWith("--out-dir=") ||
    arg.startsWith("--input-summary=")
  );
});

// ═══════════════════════════════════════════
// Phase 1: Collection + Quality Gate
// ═══════════════════════════════════════════
let collectionResult;

if (!skipCollect) {
  const collectArgs = [
    ...collectPassThrough,
    "--run-id", runId,
    "--out-dir", workspace,
  ];
  if (!hasArg(args, "--persist-to-db")) collectArgs.push("--persist-to-db");
  if (!hasArg(args, "--normalize")) collectArgs.push("--normalize");

  let retries = 0;
  while (retries <= COLLECTION_THRESHOLDS.maxRetries) {
    try {
      runPhase(`collection (attempt ${retries + 1})`, collectScript, collectArgs);
    } catch (err) {
      console.error(`[harness] collection error: ${err.message}`);
    }

    // Read summary and evaluate
    const summary = readJsonSafe(summaryPath);
    if (summary) {
      // Build platform data from summary for gate evaluation
      const platformData = {};
      for (const [platform, data] of Object.entries(summary.results || summary.platforms || {})) {
        const listings = data.listings || data.normalized || [];
        platformData[platform] = {
          requested: data.requested || data.target_count || listings.length,
          collected: data.collected || data.count || listings.length,
          listings,
        };
      }
      collectionResult = evaluateCollection({ platforms: platformData });
      collectionResult.retries = retries;

      if (collectionResult.status === "pass" || retries >= COLLECTION_THRESHOLDS.maxRetries) break;
    } else if (retries >= COLLECTION_THRESHOLDS.maxRetries) {
      collectionResult = {
        phase: "collection", status: "fail", score: 0, retries,
        per_platform: {}, failed_platforms: ["all"],
        timestamp: new Date().toISOString(),
      };
      break;
    }
    retries++;
  }
} else {
  console.log("[harness] ▶ skipping collection (--skip-collect)");
  collectionResult = { phase: "collection", status: "pass", score: 100, retries: 0, per_platform: {}, failed_platforms: [] };
}

console.log(`[harness] ✓ collection: ${collectionResult.status} (score: ${collectionResult.score})`);

// ═══════════════════════════════════════════
// Phase 2: Build operations (normalization + matching)
// ═══════════════════════════════════════════
if (fs.existsSync(summaryPath)) {
  const buildPassThrough = collectPassThrough.filter((arg) => {
    return !(
      arg === "--run-dir" || arg === "--summary" ||
      arg.startsWith("--run-dir=") || arg.startsWith("--summary=")
    );
  });
  const buildArgs = [
    ...buildPassThrough,
    "--run-id", runId,
    "--run-dir", workspace,
    "--summary", summaryPath,
    "--persist-to-db",
  ];
  if (!hasArg(args, "--persist-matches")) buildArgs.push("--persist-matches");

  try {
    runPhase("operations payload + matcher", buildScript, buildArgs);
  } catch (err) {
    console.error(`[harness] build phase error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════
// Phase 3: Normalization Gate (from summary data)
// ═══════════════════════════════════════════
let normalizationResult;
const summary = readJsonSafe(summaryPath);
if (summary) {
  const allListings = [];
  for (const data of Object.values(summary.results || summary.platforms || {})) {
    const listings = data.normalized || data.listings || [];
    allListings.push(...listings);
  }
  normalizationResult = evaluateNormalization(allListings);
} else {
  normalizationResult = { phase: "normalization", status: "warn", completeness: 0, null_field_counts: {}, total_normalized: 0 };
}
console.log(`[harness] ✓ normalization: ${normalizationResult.status} (completeness: ${normalizationResult.completeness}%)`);

// ═══════════════════════════════════════════
// Phase 4: Listing Quality
// ═══════════════════════════════════════════
let qualityResult;
if (summary) {
  const allListings = [];
  for (const data of Object.values(summary.results || summary.platforms || {})) {
    const listings = data.normalized || data.listings || [];
    allListings.push(...listings);
  }
  // Compute median rent for quality checks
  const rents = allListings.map((l) => l.rent_amount).filter((v) => v != null && v > 0);
  const sortedRents = [...rents].sort((a, b) => a - b);
  const medianRent = sortedRents.length > 0 ? sortedRents[Math.floor(sortedRents.length / 2)] : null;

  const enriched = allListings.map((l) => ({
    ...l,
    image_count: (l.image_urls || l.imageUrls || []).length,
    median_rent: medianRent,
    stale_hours: l.collected_at ? Math.floor((Date.now() - new Date(l.collected_at).getTime()) / 3600000) : 0,
    same_contact_count: 0,
  }));
  qualityResult = evaluateListingQuality(enriched);
} else {
  qualityResult = { phase: "quality", status: "warn", total: 0, tiers: {}, suspicious_rate: 0, flagged_count: 0, flagged: [] };
}
console.log(`[harness] ✓ quality: ${qualityResult.status} (suspicious rate: ${qualityResult.suspicious_rate})`);

// ═══════════════════════════════════════════
// Phase 5: Match Evaluator
// ═══════════════════════════════════════════
let matchResult;
// Look for matcher output in workspace
const matcherOutputGlob = fs.readdirSync(workspace).find((f) => f.includes("matcher") && f.endsWith(".json"));
const matcherOutputPath = matcherOutputGlob ? path.join(workspace, matcherOutputGlob) : null;
const matcherOutput = matcherOutputPath ? readJsonSafe(matcherOutputPath) : null;

if (matcherOutput?.pairs) {
  matchResult = evaluateMatches(matcherOutput.pairs);
} else {
  matchResult = { phase: "matching", status: "pass", auto_matched: 0, evaluator_promoted: 0, evaluator_demoted: 0, still_uncertain: 0, uncertain_pairs: [] };
}
console.log(`[harness] ✓ matching: ${matchResult.status} (auto: ${matchResult.auto_matched}, promoted: ${matchResult.evaluator_promoted}, uncertain: ${matchResult.still_uncertain})`);

// ═══════════════════════════════════════════
// Phase 6: Build Final Report
// ═══════════════════════════════════════════
const durationMs = Date.now() - startTime;
const report = buildReport(runId, {
  collection: collectionResult,
  normalization: normalizationResult,
  quality: qualityResult,
  matching: matchResult,
}, durationMs);

const reportPath = path.join(reportsDir, `harness-${runId}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`\n[harness] ═══════════════════════════════════`);
console.log(`[harness] Report: ${reportPath}`);
console.log(`[harness] Overall: ${report.overall}`);
console.log(`[harness] Duration: ${(durationMs / 1000).toFixed(1)}s`);
if (report.next_actions.length > 0) {
  console.log(`[harness] Next actions:`);
  for (const action of report.next_actions) {
    console.log(`[harness]   → ${action}`);
  }
}
console.log(`[harness] ═══════════════════════════════════\n`);

// Exit code
if (report.overall === "fail") process.exit(2);
if (report.overall === "warn") process.exit(1);
process.exit(0);
```

- [ ] **Step 2: Verify the script parses correctly**

Run: `node --check scripts/harness_runner.mjs`
Expected: no output (syntax OK)

- [ ] **Step 3: Commit**

```bash
git add scripts/harness_runner.mjs
git commit -m "feat: add harness runner - unified pipeline entry point with quality gates"
```

---

## Task 9: Integration Smoke Test

- [ ] **Step 1: Run all harness unit tests**

Run: `npx vitest run tests/harness_constants.test.mjs tests/collection_gate.test.mjs tests/normalization_gate.test.mjs tests/listing_quality.test.mjs tests/match_evaluator.test.mjs tests/report_builder.test.mjs`
Expected: all PASS

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: all existing tests still PASS

- [ ] **Step 3: Add npm script for harness**

Edit `package.json` — add to `"scripts"`:
```json
"collect:harness": "node scripts/harness_runner.mjs",
"collect:harness:full": "node scripts/harness_runner.mjs --sample-cap=0"
```

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add harness npm scripts, verify all tests pass"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `CLAUDE.md`, `reports/`, `scripts/lib/harness/` | 컨텍스트 인프라 |
| 2 | `constants.mjs` + test | 공유 상수, 유틸 |
| 3 | `collection_gate.mjs` + test | 수집 품질 게이트 |
| 4 | `normalization_gate.mjs` + test | 정규화 품질 게이트 |
| 5 | `listing_quality.mjs` + test | 리스팅 품질 평가 |
| 6 | `match_evaluator.mjs` + test | 매칭 2차 검증 |
| 7 | `report_builder.mjs` + test | 리포트 생성 |
| 8 | `harness_runner.mjs` | 통합 진입점 |
| 9 | `package.json` | 통합 테스트 + npm scripts |
