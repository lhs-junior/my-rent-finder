import { describe, it, expect } from "vitest";
import {
  enrichListingsWithV3Detail,
  getItemId,
} from "../scripts/zigbang_auto_collector.mjs";

function makeItem(id, extra = {}) {
  return { item_id: String(id), size_m2: 50, ...extra };
}

describe("enrichListingsWithV3Detail — known listing skip", () => {
  it("known id → detailFetcher 미호출, 목록 데이터 그대로 유지", async () => {
    const called = [];
    const mockFetcher = async (id) => { called.push(id); return { images: [] }; };

    const listings = [makeItem("111"), makeItem("222"), makeItem("333")];
    const knownIds = new Set(["111", "333"]);

    const result = await enrichListingsWithV3Detail(listings, { knownIds, detailFetcher: mockFetcher });

    expect(called).toEqual(["222"]);
    expect(result.skipped).toBe(2);
    expect(result.attempted).toBe(1);
    expect(result.listings).toHaveLength(3);
  });

  it("unknown id → detailFetcher 정상 호출", async () => {
    const called = [];
    const mockFetcher = async (id) => { called.push(id); return null; };

    const listings = [makeItem("999")];
    const knownIds = new Set();

    const result = await enrichListingsWithV3Detail(listings, { knownIds, detailFetcher: mockFetcher });

    expect(called).toContain("999");
    expect(result.attempted).toBe(1);
  });

  it("knownIds 없이 호출 시 기존 동작 유지", async () => {
    const called = [];
    const mockFetcher = async (id) => { called.push(id); return null; };

    const listings = [makeItem("aaa"), makeItem("bbb")];

    const result = await enrichListingsWithV3Detail(listings, { detailFetcher: mockFetcher });

    expect(called).toEqual(["aaa", "bbb"]);
    expect(result.attempted).toBe(2);
  });

  it("getItemId가 item_id 필드 추출", () => {
    expect(getItemId({ item_id: "42" })).toBe("42");
    expect(getItemId({ itemId: "99" })).toBe("99");
    expect(getItemId({})).toBeFalsy();
  });
});
