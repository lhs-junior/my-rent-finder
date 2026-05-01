import { describe, it, expect } from "vitest";

import {
  buildRawListingExternalId,
  consumeRawIdCleanupToken,
  extractExternalIdCandidates,
  filterAliveImageQueueEntries,
  normalizeRunMode,
} from "../scripts/lib/ops_db_persistence.mjs";

describe("normalizeRunMode", () => {
  it("'full', 'incremental' 그대로 반환", () => {
    expect(normalizeRunMode("full")).toBe("full");
    expect(normalizeRunMode("incremental")).toBe("incremental");
  });

  it("알 수 없는 값은 'full'로 폴백 (런타임 안전장치)", () => {
    expect(normalizeRunMode("INCREMENTAL")).toBe("full"); // 대소문자 구분
    expect(normalizeRunMode("partial")).toBe("full");
    expect(normalizeRunMode("")).toBe("full");
    expect(normalizeRunMode(null)).toBe("full");
    expect(normalizeRunMode(undefined)).toBe("full");
  });
});

describe("ops_db_persistence image queue filtering", () => {
  it("keeps alive queued images when DB rows return bigint ids as strings", () => {
    const imageQueue = [
      { listingId: 16469, rawId: 58925, sourceUrl: "https://img.example.com/a.jpg", isPrimary: true },
      { listingId: 16522, rawId: 63818, sourceUrl: "https://img.example.com/b.jpg", isPrimary: true },
    ];
    const aliveRows = [{ listing_id: "16469" }, { listing_id: "16522" }];

    const filtered = filterAliveImageQueueEntries(imageQueue, aliveRows);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((item) => item.listingId)).toEqual([16469, 16522]);
  });

  it("drops stale queue entries that are no longer alive", () => {
    const imageQueue = [
      { listingId: 16469, rawId: 58925, sourceUrl: "https://img.example.com/a.jpg", isPrimary: true },
      { listingId: 99999, rawId: 99999, sourceUrl: "https://img.example.com/stale.jpg", isPrimary: false },
    ];
    const aliveRows = [{ listing_id: "16469" }];

    const filtered = filterAliveImageQueueEntries(imageQueue, aliveRows);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].listingId).toBe(16469);
  });

  it("accepts mixed alive row shapes and string queue ids", () => {
    const imageQueue = [
      { listingId: "123", rawId: 1, sourceUrl: "https://img.example.com/a.jpg", isPrimary: true },
      { listingId: "456", rawId: 2, sourceUrl: "https://img.example.com/b.jpg", isPrimary: false },
    ];
    const aliveRows = [{ listingId: 123 }, "456"];

    const filtered = filterAliveImageQueueEntries(imageQueue, aliveRows);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((item) => item.listingId)).toEqual(["123", "456"]);
  });
});

describe("ops_db_persistence raw cleanup tokens", () => {
  it("cleans a raw_id only once even when multiple normalized items share it", () => {
    const cleaned = new Set();

    expect(consumeRawIdCleanupToken(cleaned, 101)).toBe(true);
    expect(consumeRawIdCleanupToken(cleaned, 101)).toBe(false);
    expect(consumeRawIdCleanupToken(cleaned, "101")).toBe(false);
    expect(consumeRawIdCleanupToken(cleaned, 202)).toBe(true);
  });
});

describe("ops_db_persistence raw listing identity", () => {
  it("collects every articleNo from a multi-item naver payload for raw-id mapping", () => {
    const rawLine = {
      payload_json: {
        articleList: [
          { articleNo: "2614770740" },
          { articleNo: "2611646028" },
          { articleNo: "2611180429" },
        ],
      },
    };

    expect(extractExternalIdCandidates(rawLine)).toEqual(
      expect.arrayContaining(["2614770740", "2611646028", "2611180429"]),
    );
  });

  it("uses a response-scoped raw id when a raw payload contains multiple listing ids", () => {
    const rawLine = {
      payload_json: {
        articleList: [
          { articleNo: "2614770740" },
          { articleNo: "2611646028" },
          { articleNo: "2611180429" },
        ],
      },
    };

    expect(buildRawListingExternalId(rawLine, "naver", "abc123")).toBe("raw:abc123");
  });

  it("keeps the single listing id when a raw payload maps to one listing", () => {
    const rawLine = {
      payload_json: {
        articleList: [{ articleNo: "2611646028" }],
      },
    };

    expect(buildRawListingExternalId(rawLine, "naver", "def456")).toBe("2611646028");
  });
});
