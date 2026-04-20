import { describe, it, expect } from "vitest";
import { filterKnownFromDetail } from "../scripts/dabang_auto_collector.mjs";

describe("filterKnownFromDetail — known listing skip", () => {
  it("known id → needDetail에서 제외", () => {
    const items = [{ id: "111" }, { id: "222" }, { id: "333" }];
    const knownIds = new Set(["111", "333"]);
    const result = filterKnownFromDetail(items, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("222");
  });

  it("known 없으면 전체 반환", () => {
    const items = [{ id: "aaa" }, { id: "bbb" }];
    const result = filterKnownFromDetail(items, new Set());
    expect(result).toHaveLength(2);
  });

  it("전부 known이면 빈 배열 반환", () => {
    const items = [{ id: "x" }, { id: "y" }];
    const knownIds = new Set(["x", "y"]);
    expect(filterKnownFromDetail(items, knownIds)).toHaveLength(0);
  });

  it("숫자 id도 문자열로 비교", () => {
    const items = [{ id: 42 }, { id: 99 }];
    const knownIds = new Set(["42"]);
    const result = filterKnownFromDetail(items, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(99);
  });
});
