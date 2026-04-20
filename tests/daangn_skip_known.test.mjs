import { describe, it, expect } from "vitest";
import {
  hydrateItemsWithDetail,
  extractDaangnItemKey,
} from "../scripts/daangn_auto_collector.mjs";

describe("extractDaangnItemKey", () => {
  it("identifier 필드에서 key 추출", () => {
    expect(extractDaangnItemKey({ identifier: "https://www.daangn.com/kr/realty/abc123" })).toBe("abc123");
  });

  it("source_ref 필드에서 key 추출", () => {
    expect(extractDaangnItemKey({ source_ref: "xyz789" })).toBe("xyz789");
  });

  it("id 필드에서 key 추출", () => {
    expect(extractDaangnItemKey({ id: "item42" })).toBe("item42");
  });

  it("null/undefined → null 반환", () => {
    expect(extractDaangnItemKey(null)).toBeNull();
    expect(extractDaangnItemKey({})).toBeNull();
  });
});

describe("hydrateItemsWithDetail — known listing skip", () => {
  it("known key → detailFetcher 미호출", async () => {
    const called = [];
    const mockFetcher = async (input) => { called.push(input); return { salesType: "monthly" }; };

    const items = [
      { identifier: "https://daangn.com/kr/realty/known001", "@type": "Apartment" },
      { identifier: "https://daangn.com/kr/realty/unknown002", "@type": "Apartment" },
    ];
    const knownIds = new Set(["known001"]);

    await hydrateItemsWithDetail(items, { knownIds, detailFetcher: mockFetcher });

    const calledIds = called.map((input) => input.split("/").pop().split("?")[0]);
    expect(calledIds.some((id) => id.includes("known001"))).toBe(false);
    expect(calledIds.some((id) => id.includes("unknown002"))).toBe(true);
  });

  it("known 없으면 전체 fetch 시도", async () => {
    const called = [];
    const mockFetcher = async (input) => { called.push(input); return null; };

    const items = [
      { identifier: "https://daangn.com/kr/realty/a1", "@type": "Apartment" },
      { identifier: "https://daangn.com/kr/realty/b2", "@type": "Apartment" },
    ];

    await hydrateItemsWithDetail(items, { detailFetcher: mockFetcher });

    expect(called.length).toBeGreaterThan(0);
  });
});
