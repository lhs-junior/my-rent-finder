import { describe, it, expect } from "vitest";

import { DabangListingAdapter } from "../scripts/adapters/dabang_listings_adapter.mjs";

const baseDetailPayload = {
  id: "69d389ba8e44ea4e94bebd4b",
  seq: 56725227,
  beds_num: 2,
  room_type_str: "투룸",
  room_floor_str: "3층",
  building_floor_str: "5층",
  address: "서울특별시 노원구 공릉동",
  full_jibun_address_str: "서울특별시 노원구 공릉동",
  priceTitle: "5000/65",
  price_info: [[5000, 65, 0]],
  bath_num: 1,
  building_approval_date_str: "1990.11.06",
  provision_size: 47,
  room_size: 46,
  // collector가 detail flatten 시 location[1]/[0]을 lat/lng로 풀어 저장한다
  lat: 37.620465,
  lng: 127.072222,
  location: [127.072222, 37.620465],
  random_location: [127.0721, 37.6204],
  image_list: [
    { id: "imgA", prefix_url: "https://d1774jszgerdmk.cloudfront.net/1024/" },
  ],
};

describe("dabang adapter jibun + near integration", () => {
  it("uses _near.result.address (with lot) to fill jibun_address", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/69d389ba8e44ea4e94bebd4b",
      sigungu: "노원구",
      payload_json: {
        ...baseDetailPayload,
        _near: {
          result: {
            location: { lat: 37.61768, lng: 127.074599 },
            address: "서울시 노원구 공릉동 683-20 1동 ",
          },
        },
      },
    });
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.jibun_address).toBe("공릉동 683-20");
    // _near.location 우선 사용 (detail의 location 무시)
    expect(it0.lat).toBeCloseTo(37.61768, 5);
    expect(it0.lng).toBeCloseTo(127.074599, 5);
  });

  it("handles comma-separated addresses (예: '...공릉동 683-20, 1동')", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/abc",
      sigungu: "노원구",
      payload_json: {
        ...baseDetailPayload,
        id: "abc",
        _near: {
          result: {
            location: { lat: 37.5, lng: 127.0 },
            address: "서울시 노원구 공릉동 683-20, 1동",
          },
        },
      },
    });
    expect(items[0].jibun_address).toBe("공릉동 683-20");
  });

  it("skips _near with empty/zero coordinates and falls back to detail location", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/abc",
      sigungu: "노원구",
      payload_json: {
        ...baseDetailPayload,
        id: "abc",
        _near: {
          result: {
            location: { lat: 0, lng: 0 },
            address: "서울특별시 노원구 공릉동", // dong-level만 → jibun 추출 실패
          },
        },
      },
    });
    expect(items[0].jibun_address ?? null).toBeNull();
    // detail.location으로 폴백
    expect(items[0].lat).toBeCloseTo(37.620465, 4);
    expect(items[0].lng).toBeCloseTo(127.072222, 4);
  });

  it("works when _near is missing entirely (legacy raw)", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/abc",
      sigungu: "노원구",
      payload_json: { ...baseDetailPayload, id: "abc" },
    });
    expect(items).toHaveLength(1);
    expect(items[0].jibun_address ?? null).toBeNull();
    expect(items[0].lat).toBeCloseTo(37.620465, 4);
    expect(items[0].lng).toBeCloseTo(127.072222, 4);
  });

  it("rejects '1동'-style suffix when there is no real dong name token", () => {
    const adapter = new DabangListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "dabang",
      source_url: "https://www.dabangapp.com/room/abc",
      sigungu: "노원구",
      payload_json: {
        ...baseDetailPayload,
        id: "abc",
        _near: {
          result: {
            location: { lat: 37.5, lng: 127.0 },
            // 동 이름 없이 호수만 있는 비정상 입력 — jibun 추출은 null 이어야 함
            address: "1동 200",
          },
        },
      },
    });
    expect(items[0].jibun_address ?? null).toBeNull();
  });
});
