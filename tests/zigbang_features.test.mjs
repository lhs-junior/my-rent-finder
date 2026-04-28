import { describe, it, expect } from "vitest";

import { ZigbangListingAdapter } from "../scripts/adapters/zigbang_listings_adapter.mjs";

const baseDetailPayload = {
  item_id: 48511395,
  itemId: 48511395,
  area: 70,
  size_m2: 70,
  area2: 90,
  bathroomCount: 3,
  building_floor: 4,
  floor_string: 4,
  floor: { allFloors: "4", floor: "4" },
  approveDate: "1995.11.8.",
  deposit: 5000,
  rentPrice: 100,
  description: "방3개, 화장실3, 풀옵션",
  direction: "W",
  directionCriterion: "거실",
  elevator: false,
  jibunAddress: "중랑구 망우동 517-2",
  location: { lat: 37.5942791294406, lng: 127.095204553434 },
  manageCost: {
    amount: 0,
    includes: [],
    notIncludes: ["전기", "가스", "수도", "인터넷"],
  },
  moveinDate: "즉시 입주 가능",
  is_new: false,
  isHomepage: false,
  nonCompliantBuilding: false,
  addressOrigin: { local1: "서울시", local2: "중랑구", local3: "망우동", fullText: "서울시 중랑구 망우동" },
  address1: "서울시 중랑구 망우동",
  bjdCode: 1126010500,
  roomType: "쓰리룸",
  service_type: "빌라",
};

describe("zigbang adapter features", () => {
  it("builds features from detail payload (elevator/manageCost/direction_base/moving_date)", () => {
    const adapter = new ZigbangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "zigbang",
      payload_json: baseDetailPayload,
    });
    expect(items).toHaveLength(1);
    const f = items[0].features;
    expect(f).toBeDefined();
    expect(f.elevator).toBe("없음");
    expect(f.direction_base).toBe("거실");
    expect(f.moving_date).toBe("즉시 입주 가능");
    expect(f.approval_date).toBe("1995.11.8.");
    expect(f.maintenance).toBeDefined();
    expect(f.maintenance.exclude).toContain("전기");
    expect(f.maintenance.exclude).toContain("가스");
  });

  it("populates jibun_address + accurate lat/lng from detail", () => {
    const adapter = new ZigbangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "zigbang",
      payload_json: baseDetailPayload,
    });
    expect(items[0].jibun_address).toBe("망우동 517-2");
    expect(items[0].lat).toBeCloseTo(37.59427, 4);
    expect(items[0].lng).toBeCloseTo(127.09520, 4);
  });

  it("flags zigbang_plus via item_bm_type", () => {
    const adapter = new ZigbangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "zigbang",
      payload_json: { ...baseDetailPayload, item_bm_type: "ZIGBANG_PLUS" },
    });
    expect(items[0].features?.flags?.zigbang_plus).toBe(true);
  });

  it("returns no features when payload is list-only (no detail attributes)", () => {
    const adapter = new ZigbangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "zigbang",
      payload_json: {
        item_id: 100,
        deposit: 5000,
        rentPrice: 50,
        size_m2: 30,
        addressOrigin: { local1: "서울시", local2: "노원구", local3: "공릉동" },
        address1: "서울시 노원구 공릉동",
      },
    });
    // detail-only 필드(elevator/manageCost 등)가 없으면 features 자체가 null/undefined
    expect(items[0].features ?? null).toBeNull();
  });
});
