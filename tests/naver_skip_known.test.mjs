import { describe, it, expect } from "vitest";

// naver는 browser-bound이므로 known 필터 로직을 직접 단위 테스트
function filterNaverDetailCandidates(candidates, knownIds, maxCount = 300) {
  return candidates
    .filter((art) => !knownIds.has(String(art.articleNo)))
    .slice(0, maxCount);
}

describe("filterNaverDetailCandidates — known listing skip", () => {
  it("known articleNo → detailCandidates에서 제외", () => {
    const candidates = [
      { articleNo: "111" },
      { articleNo: "222" },
      { articleNo: "333" },
    ];
    const knownIds = new Set(["111", "333"]);
    const result = filterNaverDetailCandidates(candidates, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].articleNo).toBe("222");
  });

  it("known 없으면 전체 반환 (DETAIL_ENRICH_MAX 내)", () => {
    const candidates = [{ articleNo: "a" }, { articleNo: "b" }, { articleNo: "c" }];
    const result = filterNaverDetailCandidates(candidates, new Set(), 300);
    expect(result).toHaveLength(3);
  });

  it("DETAIL_ENRICH_MAX로 상한 적용", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ articleNo: String(i) }));
    const result = filterNaverDetailCandidates(candidates, new Set(), 5);
    expect(result).toHaveLength(5);
  });

  it("known 제거 후 maxCount 적용", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ articleNo: String(i) }));
    const knownIds = new Set(["0", "1", "2"]);
    const result = filterNaverDetailCandidates(candidates, knownIds, 5);
    expect(result).toHaveLength(5);
    expect(result.map((a) => a.articleNo)).not.toContain("0");
    expect(result.map((a) => a.articleNo)).not.toContain("1");
    expect(result.map((a) => a.articleNo)).not.toContain("2");
  });

  it("숫자 articleNo도 문자열로 비교", () => {
    const candidates = [{ articleNo: 42 }, { articleNo: 99 }];
    const knownIds = new Set(["42"]);
    const result = filterNaverDetailCandidates(candidates, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].articleNo).toBe(99);
  });
});
