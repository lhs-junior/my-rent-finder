import { describe, it, expect } from "vitest";
import { getExistingWithImages, getExistingWithSufficientImages, getExistingWithImagesAndFields } from "../scripts/lib/known_listings.mjs";

function makeClient(rows) {
  return { query: async () => ({ rows }) };
}

describe("getExistingWithImages", () => {
  it("존재하고 이미지도 있는 매물 → Set에 포함", async () => {
    const client = makeClient([{ external_id: "abc123" }, { external_id: "def456" }]);
    const result = await getExistingWithImages("zigbang", ["abc123", "def456", "new999"], client);
    expect(result).toBeInstanceOf(Set);
    expect(result.has("abc123")).toBe(true);
    expect(result.has("def456")).toBe(true);
    expect(result.has("new999")).toBe(false);
  });

  it("이미지 없는 매물(JOIN 결과 없음) → Set에 미포함", async () => {
    const client = makeClient([]);
    const result = await getExistingWithImages("dabang", ["id_no_image"], client);
    expect(result.has("id_no_image")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("deleted_at 있는 매물 → WHERE 절에서 필터링 → Set에 미포함", async () => {
    const client = makeClient([]);
    const result = await getExistingWithImages("peterpanz", ["deleted_item"], client);
    expect(result.has("deleted_item")).toBe(false);
  });

  it("빈 배열 입력 → DB 쿼리 없이 빈 Set 반환", async () => {
    let queryCalled = false;
    const client = { query: async () => { queryCalled = true; return { rows: [] }; } };
    const result = await getExistingWithImages("zigbang", [], client);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
    expect(queryCalled).toBe(false);
  });

  it("숫자 id도 문자열로 변환하여 처리", async () => {
    const client = makeClient([{ external_id: "42" }]);
    const result = await getExistingWithImages("kbland", [42], client);
    expect(result.has("42")).toBe(true);
  });

  it("null/undefined externalIds → 빈 Set 반환", async () => {
    const client = makeClient([]);
    expect((await getExistingWithImages("naver", null, client)).size).toBe(0);
    expect((await getExistingWithImages("naver", undefined, client)).size).toBe(0);
  });

  it("query에 올바른 platformCode와 ids가 전달됨", async () => {
    let capturedParams = null;
    const client = {
      query: async (sql, params) => { capturedParams = params; return { rows: [] }; },
    };
    await getExistingWithImages("dabang", ["r1", "r2"], client);
    expect(capturedParams[0]).toBe("dabang");
    expect(capturedParams[1]).toEqual(["r1", "r2"]);
  });

  it("maxAgeHours 지정 시 params에 시간 값 추가 및 쿼리에 staleness 조건 포함", async () => {
    let capturedSql = null;
    let capturedParams = null;
    const client = {
      query: async (sql, params) => { capturedSql = sql; capturedParams = params; return { rows: [] }; },
    };
    await getExistingWithImages("zigbang", ["id1"], { maxAgeHours: 72, client });
    expect(capturedParams).toHaveLength(3);
    expect(capturedParams[2]).toBe(72);
    expect(capturedSql).toContain("$3");
    expect(capturedSql).toContain("updated_at");
  });
});

describe("getExistingWithImagesAndFields", () => {
  it("이미지 있고 requiredFields 모두 non-null → known으로 반환", async () => {
    const client = makeClient([{ external_id: "abc" }]);
    const result = await getExistingWithImagesAndFields("kbland", ["abc", "new"], ["direction"], { client });
    expect(result.has("abc")).toBe(true);
    expect(result.has("new")).toBe(false);
  });

  it("requiredFields 빈 배열 → getExistingWithImages 동일 동작", async () => {
    let capturedSql = "";
    const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
    await getExistingWithImagesAndFields("dabang", ["x"], [], { client });
    expect(capturedSql).not.toContain("IS NOT NULL");
  });

  it("허용되지 않는 필드는 SQL에 포함되지 않음 (injection 방지)", async () => {
    let capturedSql = "";
    const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
    await getExistingWithImagesAndFields("dabang", ["x"], ["direction", "DROP TABLE"], { client });
    expect(capturedSql).toContain("direction IS NOT NULL");
    expect(capturedSql).not.toContain("DROP TABLE");
  });

  it("maxAgeHours 지정 시 staleness 조건이 쿼리에 포함됨", async () => {
    let capturedSql = "";
    let capturedParams = null;
    const client = { query: async (sql, params) => { capturedSql = sql; capturedParams = params; return { rows: [] }; } };
    await getExistingWithImagesAndFields("kbland", ["id1"], ["bathroom_count"], { maxAgeHours: 72, client });
    expect(capturedSql).toContain("updated_at");
    expect(capturedParams).toContain(72);
  });

  it("빈 externalIds → DB 쿼리 없이 빈 Set 반환", async () => {
    let queryCalled = false;
    const client = { query: async () => { queryCalled = true; return { rows: [] }; } };
    const result = await getExistingWithImagesAndFields("kbland", [], ["direction"], { client });
    expect(result.size).toBe(0);
    expect(queryCalled).toBe(false);
  });
});

describe("getExistingWithSufficientImages", () => {
  it("maxAgeHours 지정 시 params=[platform,ids,minCount,hours], 쿼리에 $4 포함", async () => {
    let capturedSql = null;
    let capturedParams = null;
    const client = {
      query: async (sql, params) => { capturedSql = sql; capturedParams = params; return { rows: [] }; },
    };
    await getExistingWithSufficientImages("naver", ["a1"], 3, { maxAgeHours: 72, client });
    expect(capturedParams).toHaveLength(4);
    expect(capturedParams[2]).toBe(3);
    expect(capturedParams[3]).toBe(72);
    expect(capturedSql).toContain("$4");
    expect(capturedSql).toContain("updated_at");
  });
});
