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
