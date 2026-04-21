import { describe, it, expect } from "vitest";
import { enrichPeterpanzListingsWithDetailImages } from "../scripts/peterpanz_auto_collector.mjs";

function makeItem(hidx, hasImages = false) {
  return {
    hidx,
    info: { thumbnail: hasImages ? "https://img.peterpanz.com/a.jpg" : null },
    images: hasImages ? { S: [{ path: "https://img.peterpanz.com/a.jpg" }] } : null,
  };
}

// mockFetcher는 fetchPeterpanzDetailData 시그니처를 따름: { imageUrls, ...extraFields }
function makeMockFetcher(called, imageUrls = []) {
  return async (hidx) => { called.push(hidx); return { imageUrls }; };
}

describe("enrichPeterpanzListingsWithDetailImages — known listing skip", () => {
  it("known + 이미지 있음만 skip, known + 이미지 없음은 fetch", async () => {
    const called = [];
    const mockFetcher = makeMockFetcher(called, ["https://img.example.com/a.jpg"]);

    // 111: known + 이미지 없음 → fetch
    // 222: unknown + 이미지 없음 → fetch
    // 333: known + 이미지 있음 → skip
    const items = [makeItem(111), makeItem(222), makeItem(333, true)];
    const knownIds = new Set(["111", "333"]);

    const result = await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });

    expect(called).toEqual([111, 222]);
    expect(result.enrichedCount).toBe(2);
  });

  it("unknown + 이미지 있음도 fetch (추가 필드 채우기)", async () => {
    const called = [];
    const mockFetcher = makeMockFetcher(called);

    const items = [makeItem(10, true), makeItem(20, false)];
    const knownIds = new Set();

    await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });

    expect(called).toEqual([10, 20]);
  });

  it("모두 unknown → 전부 fetch 시도", async () => {
    const called = [];
    const mockFetcher = makeMockFetcher(called);

    const items = [makeItem(1), makeItem(2), makeItem(3)];
    await enrichPeterpanzListingsWithDetailImages(items, { imageFetcher: mockFetcher });

    expect(called).toEqual([1, 2, 3]);
  });

  it("known + 이미지 있음 → skip, enrichedCount에 포함 안 됨", async () => {
    const mockFetcher = makeMockFetcher([]);
    const items = [makeItem(99, true)];
    const knownIds = new Set(["99"]);

    const result = await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });
    expect(result.enrichedCount).toBe(0);
  });
});
