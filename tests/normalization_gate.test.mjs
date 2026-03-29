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
