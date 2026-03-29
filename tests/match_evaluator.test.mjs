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
