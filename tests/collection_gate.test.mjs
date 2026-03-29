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
