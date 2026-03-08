import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the adapter (will fail with RED since file doesn't exist yet)
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
});
