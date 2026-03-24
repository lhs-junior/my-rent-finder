import { describe, it, expect } from "vitest";

import { PeterpanzListingAdapter } from "../scripts/adapters/peterpanz_listings_adapter.mjs";

describe("PeterpanzListingAdapter", () => {
  it("upgrades thumb images to origin URLs and dedupes duplicates", () => {
    const adapter = new PeterpanzListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "peterpanz",
      source_url: "https://www.peterpanz.com/house/19009753",
      payload_json: {
        hidx: 19009753,
        info: {
          subject: "태릉입구역 도보5분 투룸",
          thumbnail: "https://img.peterpanz.com/photo/20260311/19009753/69b10ca2015e4_thumb.jpg",
          real_size: 42.98,
          supplied_size: 50.21,
          room_count: 2,
          room_type: "투룸",
        },
        type: {
          contract_type: "월세",
          building_type_text: "빌라",
        },
        price: {
          deposit: 30000000,
          monthly_fee: 750000,
          maintenance_cost: 30000,
        },
        floor: {
          target: 3,
          total: 5,
        },
        location: {
          coordinate: {
            latitude: "37.6204636",
            longitude: "127.0722352",
          },
          address: {
            sido: "서울특별시",
            sigungu: "노원구",
            dong: "공릉동",
          },
        },
        images: {
          S: [
            { path: "https://img.peterpanz.com/photo/20260311/19009753/69b10ca2015e4_thumb.jpg" },
            { path: "https://img.peterpanz.com/photo/20260311/19009753/69b10ca27c710_thumb.jpg" },
          ],
        },
        image_urls: [
          "https://img.peterpanz.com/photo/20260311/19009753/69b10ca27c710_thumb.jpg",
        ],
      },
    });

    expect(items).toHaveLength(1);
    expect([...items[0].image_urls].sort()).toEqual([
      "https://img.peterpanz.com/photo/20260311/19009753/69b10ca2015e4_origin.jpg",
      "https://img.peterpanz.com/photo/20260311/19009753/69b10ca27c710_origin.jpg",
    ].sort());
  });

  it("keeps image_urls empty when the source payload genuinely has no images", () => {
    const adapter = new PeterpanzListingAdapter();
    const items = adapter.normalizeFromRawRecord({
      platform_code: "peterpanz",
      source_url: "https://www.peterpanz.com/house/19066411",
      payload_json: {
        hidx: 19066411,
        info: {
          subject: "태릉입구역 도보 5분이내",
          real_size: 52.9,
          room_count: 2,
          room_type: "투룸",
          thumbnail: null,
        },
        type: {
          contract_type: "월세",
          building_type_text: "빌라",
        },
        price: {
          deposit: 50000000,
          monthly_fee: 650000,
          maintenance_cost: 30000,
        },
        floor: {
          target: 4,
          total: 5,
        },
        location: {
          coordinate: {
            latitude: "37.6204636",
            longitude: "127.0722352",
          },
          address: {
            sido: "서울특별시",
            sigungu: "노원구",
            dong: "공릉동",
          },
        },
        images: null,
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0].image_urls).toEqual([]);
  });
});
