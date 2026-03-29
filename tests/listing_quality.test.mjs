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
    expect(result.score).toBe(75);
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
    expect(result.score).toBe(90);
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
    const result = scoreListing({
      ...goodListing,
      image_count: 0,
      description: "",
      stale_hours: 3000,
    });
    expect(result.tier).toBe("caution");
  });

  it("classifies suspicious tier", () => {
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
