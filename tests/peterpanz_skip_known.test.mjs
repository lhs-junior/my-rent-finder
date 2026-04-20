import { describe, it, expect } from "vitest";
import { enrichPeterpanzListingsWithDetailImages } from "../scripts/peterpanz_auto_collector.mjs";

function makeItem(hidx, hasImages = false) {
  return {
    hidx,
    info: { thumbnail: hasImages ? "https://img.peterpanz.com/a.jpg" : null },
    images: hasImages ? { S: [{ path: "https://img.peterpanz.com/a.jpg" }] } : null,
  };
}

describe("enrichPeterpanzListingsWithDetailImages — known listing skip", () => {
  it("known hidx → imageFetcher 미호출", async () => {
    const called = [];
    const mockFetcher = async (hidx) => { called.push(hidx); return ["https://img.example.com/a.jpg"]; };

    const items = [makeItem(111), makeItem(222), makeItem(333)];
    const knownIds = new Set(["111", "333"]);

    const result = await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });

    expect(called).toEqual([222]);
    expect(result.enrichedCount).toBe(1);
  });

  it("이미 이미지 있는 항목은 known 여부와 무관하게 fetch 스킵", async () => {
    const called = [];
    const mockFetcher = async (hidx) => { called.push(hidx); return []; };

    const items = [makeItem(10, true), makeItem(20, false)];
    const knownIds = new Set();

    await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });

    expect(called).toEqual([20]);
  });

  it("모두 unknown → 전부 fetch 시도", async () => {
    const called = [];
    const mockFetcher = async (hidx) => { called.push(hidx); return []; };

    const items = [makeItem(1), makeItem(2), makeItem(3)];
    await enrichPeterpanzListingsWithDetailImages(items, { imageFetcher: mockFetcher });

    expect(called).toEqual([1, 2, 3]);
  });

  it("known인 경우 item은 그대로 보존(이미지 없어도 통과)", async () => {
    const mockFetcher = async () => [];
    const items = [makeItem(99)];
    const knownIds = new Set(["99"]);

    const result = await enrichPeterpanzListingsWithDetailImages(items, { knownIds, imageFetcher: mockFetcher });
    expect(result.enrichedCount).toBe(0);
  });
});
