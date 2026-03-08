import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the adapter
let KblandListingAdapter;
try {
  const module = await import("../scripts/adapters/kbland_listings_adapter.mjs");
  KblandListingAdapter = module.default || module.KblandListingAdapter;
} catch (err) {
  // Expected to fail - adapter not yet implemented
  console.warn("⚠️  kbland_listings_adapter.mjs not found (expected during RED phase)");
}

// Load fixture data from JSONL
function loadFixtures() {
  const fixturePath = path.join(__dirname, "../scripts/kbland_raw_samples.jsonl");
  const content = fs.readFileSync(fixturePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.map((line) => JSON.parse(line));
}

describe("kbland_adapter - normalization tests", () => {
  let fixtures;

  // Load fixtures before tests
  try {
    fixtures = loadFixtures();
  } catch (err) {
    console.error("Failed to load fixtures:", err.message);
    fixtures = [];
  }

  it("should have loaded 10 fixture records", () => {
    expect(fixtures.length).toBe(10);
  });

  it("should have platform_code as 'kbland' in all fixtures", () => {
    fixtures.forEach((record) => {
      expect(record.platform_code).toBe("kbland");
    });
  });

  describe("normalized output validation", () => {
    let adapter;

    // Initialize adapter if available
    if (KblandListingAdapter) {
      adapter = new KblandListingAdapter();
    }

    it("should normalize platform_code to 'kbland'", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.platform_code).toBe("kbland");
    });

    it("should normalize address_text to start with '서울특별시'", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.address_text).toBeDefined();
      expect(item.address_text).toMatch(/^서울특별시/);
    });

    it("should normalize rent_amount as positive number", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.rent_amount).toBeDefined();
      expect(typeof item.rent_amount).toBe("number");
      expect(item.rent_amount).toBeGreaterThan(0);
    });

    it("should normalize deposit_amount as number or null", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.deposit_amount === null || typeof item.deposit_amount === "number").toBe(true);
      if (item.deposit_amount !== null) {
        expect(item.deposit_amount).toBeGreaterThanOrEqual(0);
      }
    });

    it("should normalize area_exclusive_m2 as positive number", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.area_exclusive_m2).toBeDefined();
      expect(typeof item.area_exclusive_m2).toBe("number");
      expect(item.area_exclusive_m2).toBeGreaterThan(0);
    });

    it("should normalize lease_type to '월세'", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.lease_type).toBe("월세");
    });

    it("should normalize source_url to start with kbland domain", () => {
      if (!adapter) {
        expect.fail("Adapter not loaded - expected RED phase");
      }

      const fixture = fixtures[0];
      const normalized = adapter.normalizeFromRawRecord(fixture);

      expect(normalized).toBeDefined();
      expect(normalized.length).toBeGreaterThan(0);

      const item = normalized[0];
      expect(item.source_url).toBeDefined();
      expect(
        item.source_url.startsWith("https://kbland.kr/p/") || item.source_url.startsWith("https://www.kbland.kr/p/"),
      ).toBe(true);
    });
  });

  describe("edge cases", () => {
    let adapter;
    if (KblandListingAdapter) {
      adapter = new KblandListingAdapter();
    }

    function makeRawRecord(payloadOverrides = {}) {
      return {
        platform_code: "kbland",
        external_id: "999999999",
        collected_at: new Date().toISOString(),
        source_url: "https://kbland.kr/p/999999999",
        sigungu: "노원구",
        payload_json: {
          매물일련번호: 999999999,
          propertyType: "다가구주택",
          dealType: "월세",
          address: "서울특별시 노원구 상계동 1-1",
          dong: "상계동",
          buildingName: "테스트빌라",
          deposit: 500,
          rent: 50,
          area: 45,
          supplyArea: 60,
          rooms: 2,
          floor: "3층",
          totalFloor: 5,
          lat: 37.654,
          lng: 127.057,
          registeredDate: "2026.01.01",
          agencyName: "테스트공인중개사",
          description: "테스트 매물",
          imageCount: 0,
          imageUrls: [],
          ...payloadOverrides,
        },
      };
    }

    it("should parse floor '4층' as 4", () => {
      if (!adapter) return;
      const record = makeRawRecord({ floor: "4층" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].floor).toBe(4);
    });

    it("should parse floor 'B1층' as -1", () => {
      if (!adapter) return;
      const record = makeRawRecord({ floor: "B1층" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].floor).toBe(-1);
    });

    it("should parse floor 'B2층' as -2", () => {
      if (!adapter) return;
      const record = makeRawRecord({ floor: "B2층" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].floor).toBe(-2);
    });

    it("should handle null floor gracefully", () => {
      if (!adapter) return;
      const record = makeRawRecord({ floor: null });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].floor == null || typeof normalized[0].floor === "number").toBe(true);
    });

    it("should map propertyType '다가구주택' to '단독/다가구'", () => {
      if (!adapter) return;
      const record = makeRawRecord({ propertyType: "다가구주택" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].building_use).toBe("단독/다가구");
    });

    it("should map propertyType '연립/다세대' to '빌라/연립'", () => {
      if (!adapter) return;
      const record = makeRawRecord({ propertyType: "연립/다세대" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].building_use).toBe("빌라/연립");
    });

    it("should map propertyType '단독주택' to '단독/다가구'", () => {
      if (!adapter) return;
      const record = makeRawRecord({ propertyType: "단독주택" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalized[0].building_use).toBe("단독/다가구");
    });

    it("should handle empty imageUrls array", () => {
      if (!adapter) return;
      const record = makeRawRecord({ imageUrls: [] });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      expect(Array.isArray(normalized[0].image_urls)).toBe(true);
    });

    it("should handle registeredDate '2026.01.23' format", () => {
      if (!adapter) return;
      const record = makeRawRecord({ registeredDate: "2026.01.23" });
      const normalized = adapter.normalizeFromRawRecord(record);
      expect(normalized.length).toBeGreaterThan(0);
      // listed_at may be null or a string - just verify it doesn't crash
      expect(normalized[0]).toBeDefined();
    });
  });
});
