import { describe, expect, it } from "vitest";

import { DaangnListingAdapter } from "../scripts/adapters/daangn_listings_adapter.mjs";

function makeRawRecord(detail = {}) {
  return {
    platform_code: "daangn",
    collected_at: "2026-03-24T00:00:00.000Z",
    source_url: "https://www.daangn.com/kr/realty/test-listing-abc123",
    payload_json: {
      id: "abc123",
      source_ref: "abc123",
      name: "투룸이상 3,000만원/70만원 - 테스트 매물 | 당근부동산",
      propertyType: "투룸",
      deposit: 3000,
      rent: 70,
      address: {
        streetAddress: "서울특별시 광진구 자양동 1-1",
        addressLocality: "광진구",
        addressRegion: "서울특별시",
      },
      _detail: detail,
    },
    list_data: {
      source_ref: "abc123",
      priceTitle: "3000/70",
      roomTitle: "투룸이상 3,000만원/70만원 - 테스트 매물",
      dongName: "서울특별시 광진구 자양동 1-1",
      propertyType: "투룸",
    },
  };
}

describe("DaangnListingAdapter", () => {
  it("treats detail floorSize as exclusive area and keeps >=40m² listings", () => {
    const adapter = new DaangnListingAdapter();
    const rawRecord = makeRawRecord({
      floorSize: { value: 42, unitCode: "MTR" },
      floor: "2.0",
      topFloor: "4",
      roomCnt: 2,
      bathroomCnt: 1,
    });

    const result = adapter.normalizeFromRawRecord(rawRecord);

    expect(result).toHaveLength(1);
    expect(result[0].area_exclusive_m2).toBe(42);
    expect(result[0].area_claimed).toBe("exclusive");
    expect(result[0].floor).toBe(2);
    expect(result[0].total_floor).toBe(4);
  });

  it("rejects listings whose detail floorSize is below the 40m² threshold", () => {
    const adapter = new DaangnListingAdapter();
    const rawRecord = makeRawRecord({
      floorSize: { value: 21, unitCode: "MTR" },
      floor: "2.0",
      topFloor: "4",
      roomCnt: 1,
      bathroomCnt: 1,
    });

    const result = adapter.normalizeFromRawRecord(rawRecord);

    expect(result).toEqual([]);
  });

  it("rejects legacy list-only raw records with no exclusive area detail", () => {
    const adapter = new DaangnListingAdapter();
    const rawRecord = makeRawRecord({});

    const result = adapter.normalizeFromRawRecord(rawRecord);

    expect(result).toEqual([]);
  });
});
