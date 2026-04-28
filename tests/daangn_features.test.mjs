import { describe, it, expect } from "vitest";

import { DaangnListingAdapter } from "../scripts/adapters/daangn_listings_adapter.mjs";

const baseDetailPayload = {
  id: "/kr/realty/test",
  source_ref: "3261207",
  name: "신당역 2분 방2",
  description: "방2 화1",
  schemaType: "RealtyPost",
  propertyType: "house",
  deposit: 2000,
  rent: 90,
  area: 46.2,
  areaClaimed: "exclusive",
  floor: 3,
  floorText: "3.0",
  topFloor: 5,
  total_floor: 5,
  buildingOrientation: "NORTH_EAST_FACING",
  direction: "북동향",
  directionText: "북동향",
  images: [],
  address: "서울특별시 중구 황학동",
  lat: 37.5746471,
  lng: 127.0135236,
  roomCnt: 2,
  _detail: {
    __typename: "RealtyPost",
    address: "서울특별시 중구 황학동",
    area: 46.2,
    bathroomCnt: 1,
    buildingApprovalDate: "1990-08-30",
    buildingOrientation: "NORTH_EAST_FACING",
    buildingUsage: "SINGLE_FAMILY_HOUSING",
    chatRoomCount: 7,
    coordinate: { lat: "37.5746471", lon: "127.0135236" },
    options: [
      { name: "PARKING", value: "NO", __typename: "ArticleOption" },
      { name: "FRIDGE", value: "YES", __typename: "ArticleOption" },
      { name: "AIRCON", value: "YES", __typename: "ArticleOption" },
      { name: "WASHER", value: "YES", __typename: "ArticleOption" },
      { name: "INDUCTION", value: "YES", __typename: "ArticleOption" },
    ],
    moveInDate: "2026-04-15",
    isHideAddress: true,
    isUnknownManageCost: false,
    isWriterVerified: true,
    isWriterVerifiedCorporate: false,
    viewCount: 2024,
    watchCount: 12,
    availableParkingSpots: 0,
    availableTotalParkingSpots: 0,
    totalManageCost: 50000,
    includeManageCostOptionV3: [
      { option: "WATERWORKS", payOption: "USED", __typename: "IncludeManageCostOptionV3" },
      { option: "ETC", payOption: "USED", __typename: "IncludeManageCostOptionV3" },
    ],
    excludeManageCostOption: [
      { option: "ELECTRICITY" },
      { option: "GAS" },
    ],
    floor: 3,
    floorText: "3",
    topFloor: 5,
    title: "신당역 2분",
    createdAt: "2026-04-06T03:31:53.293Z",
  },
};

describe("daangn adapter features", () => {
  it("builds features from detail payload (options/parking/maintenance/popularity/flags)", () => {
    const adapter = new DaangnListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "daangn",
      payload_json: baseDetailPayload,
    });
    expect(items).toHaveLength(1);
    const f = items[0].features;
    expect(f).toBeDefined();
    expect(f.options).toEqual(expect.arrayContaining(["냉장고", "에어컨", "세탁기", "인덕션"]));
    expect(f.options).not.toContain("주차"); // PARKING value=NO
    expect(f.parking).toBeDefined();
    expect(f.parking.possible).toBe(false);
    expect(f.parking.total).toBe(0);
    expect(f.maintenance).toBeDefined();
    expect(f.maintenance.cost).toBe(50000);
    expect(f.maintenance.items).toContain("수도");
    expect(f.maintenance.exclude).toContain("전기");
    expect(f.popularity).toEqual({ views: 2024, watches: 12, chats: 7 });
    expect(f.flags).toEqual({ writer_verified: true, hide_address: true });
    expect(f.approval_date).toBe("1990-08-30");
    expect(f.moving_date).toBe("2026-04-15");
  });

  it("returns no features when _detail is missing (legacy/list-only)", () => {
    const adapter = new DaangnListingAdapter();
    const { _detail, ...withoutDetail } = baseDetailPayload;
    void _detail;
    const items = adapter.normalizeFromRawRecord({
      platform_code: "daangn",
      payload_json: withoutDetail,
    });
    expect(items[0].features ?? null).toBeNull();
  });

  it("treats unknown manage cost flag", () => {
    const adapter = new DaangnListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "daangn",
      payload_json: {
        ...baseDetailPayload,
        _detail: { ...baseDetailPayload._detail, isUnknownManageCost: true, totalManageCost: null, includeManageCostOptionV3: [] },
      },
    });
    expect(items[0].features?.maintenance?.unknown).toBe(true);
  });
});
