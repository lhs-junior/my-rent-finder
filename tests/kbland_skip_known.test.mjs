import { describe, it, expect } from "vitest";

// KB Land는 browser-bound 함수들이 많아 unit 테스트는 known 필터 로직에 집중
// getExistingWithImages의 동작은 known_listings.test.mjs에서 검증됨

function filterKbKnownRecords(records, knownIds) {
  return records.filter((r) => !knownIds.has(String(r.매물일련번호)));
}

describe("kbland known listing filter", () => {
  it("known 매물일련번호 → 필터에서 제외", () => {
    const records = [
      { 매물일련번호: "AAA001" },
      { 매물일련번호: "BBB002" },
      { 매물일련번호: "CCC003" },
    ];
    const knownIds = new Set(["AAA001", "CCC003"]);
    const result = filterKbKnownRecords(records, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].매물일련번호).toBe("BBB002");
  });

  it("known 없으면 전체 반환", () => {
    const records = [{ 매물일련번호: "X1" }, { 매물일련번호: "X2" }];
    expect(filterKbKnownRecords(records, new Set())).toHaveLength(2);
  });

  it("전부 known이면 빈 배열", () => {
    const records = [{ 매물일련번호: "K1" }, { 매물일련번호: "K2" }];
    const knownIds = new Set(["K1", "K2"]);
    expect(filterKbKnownRecords(records, knownIds)).toHaveLength(0);
  });

  it("숫자 매물일련번호도 문자열로 비교", () => {
    const records = [{ 매물일련번호: 12345 }, { 매물일련번호: 99999 }];
    const knownIds = new Set(["12345"]);
    const result = filterKbKnownRecords(records, knownIds);
    expect(result).toHaveLength(1);
    expect(result[0].매물일련번호).toBe(99999);
  });

  it("이미지수 > 0 이고 known이면 이미지 fetch 대상에서도 제외", () => {
    const capped = [
      { 매물일련번호: "A", 이미지수: 3 },
      { 매물일련번호: "B", 이미지수: 0 },
      { 매물일련번호: "C", 이미지수: 2 },
    ];
    const knownIds = new Set(["A"]);
    const withImages = capped.filter((r) => r.이미지수 > 0 && !knownIds.has(String(r.매물일련번호)));
    expect(withImages).toHaveLength(1);
    expect(withImages[0].매물일련번호).toBe("C");
  });
});
