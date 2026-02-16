import { describe, it, expect } from "vitest";
import {
  platformNameFromCode,
  mimeFor,
  isInside,
  inferItemQuality,
  mapGradeToTone,
  statusFromCode,
  hasDbConnectionError,
  mapServerError,
  parseRunIdFilter,
  normalizeBaseRunId,
} from "../scripts/api_server.mjs";

describe("api_server utility functions", () => {
  describe("platformNameFromCode", () => {
    it("should return correct Korean name for known platforms", () => {
      expect(platformNameFromCode("naver")).toBe("네이버 부동산");
      expect(platformNameFromCode("zigbang")).toBe("직방");
      expect(platformNameFromCode("dabang")).toBe("다방");
      expect(platformNameFromCode("kbland")).toBe("KB부동산");
      expect(platformNameFromCode("r114")).toBe("부동산114");
      expect(platformNameFromCode("peterpanz")).toBe("피터팬");
      expect(platformNameFromCode("daangn")).toBe("당근부동산");
    });

    it("should return the code itself for unknown platforms", () => {
      expect(platformNameFromCode("unknown_platform")).toBe("unknown_platform");
      expect(platformNameFromCode("xyz")).toBe("xyz");
    });

    it("should return 'unknown' for null or empty input", () => {
      expect(platformNameFromCode(null)).toBe("unknown");
      expect(platformNameFromCode("")).toBe("unknown");
    });
  });

  describe("mimeFor", () => {
    it("should return correct MIME types for text files", () => {
      expect(mimeFor("index.html")).toBe("text/html; charset=utf-8");
      expect(mimeFor("style.css")).toBe("text/css; charset=utf-8");
      expect(mimeFor("script.js")).toBe("application/javascript; charset=utf-8");
      expect(mimeFor("module.mjs")).toBe("application/javascript; charset=utf-8");
      expect(mimeFor("data.json")).toBe("application/json; charset=utf-8");
      expect(mimeFor("readme.txt")).toBe("text/plain; charset=utf-8");
    });

    it("should return correct MIME types for image files", () => {
      expect(mimeFor("photo.png")).toBe("image/png");
      expect(mimeFor("photo.jpg")).toBe("image/jpeg");
      expect(mimeFor("photo.jpeg")).toBe("image/jpeg");
      expect(mimeFor("icon.webp")).toBe("image/webp");
      expect(mimeFor("logo.svg")).toBe("image/svg+xml");
      expect(mimeFor("favicon.ico")).toBe("image/x-icon");
    });

    it("should return octet-stream for unknown extensions", () => {
      expect(mimeFor("file.xyz")).toBe("application/octet-stream");
      expect(mimeFor("file.unknown")).toBe("application/octet-stream");
      expect(mimeFor("noext")).toBe("application/octet-stream");
    });

    it("should be case-insensitive", () => {
      expect(mimeFor("FILE.HTML")).toBe("text/html; charset=utf-8");
      expect(mimeFor("IMAGE.PNG")).toBe("image/png");
    });
  });

  describe("isInside", () => {
    it("should return true for paths inside base directory", () => {
      const base = "/app/public";
      expect(isInside(base, "/app/public/index.html")).toBe(true);
      expect(isInside(base, "/app/public/css/style.css")).toBe(true);
      expect(isInside(base, "/app/public/deep/nested/file.js")).toBe(true);
    });

    it("should return false for paths outside base directory", () => {
      const base = "/app/public";
      expect(isInside(base, "/app/secret/config.json")).toBe(false);
      expect(isInside(base, "/etc/passwd")).toBe(false);
      expect(isInside(base, "/app/public/../secret/file.txt")).toBe(false);
    });

    it("should return false for paths with .. traversal", () => {
      const base = "/app/public";
      expect(isInside(base, "/app/public/../app/secret")).toBe(false);
    });

    it("should return false for absolute paths outside base", () => {
      const base = "/app/public";
      expect(isInside(base, "/home/user/file.txt")).toBe(false);
    });
  });

  describe("inferItemQuality", () => {
    it("should return perfect scores for items with all fields", () => {
      const items = [
        {
          address_text: "서울시 강남구 테헤란로",
          rent_amount: 100,
          deposit_amount: 5000,
          area_exclusive_m2: 33.5,
          image_count: 5,
        },
        {
          addressText: "서울시 송파구 잠실동",
          rentAmount: 80,
          depositAmount: 3000,
          area_gross_m2: 40.2,
          image_count: 3,
        },
      ];

      const quality = inferItemQuality(items);

      expect(quality.requiredFieldsRate).toBe(1.0);
      expect(quality.addressRate).toBe(1.0);
      expect(quality.imageRate).toBe(1.0);
      expect(quality.areaRate).toBe(1.0);
      expect(quality.priceRate).toBe(1.0);
    });

    it("should return lower scores for items with missing fields", () => {
      const items = [
        {
          address_text: "서울시 강남구",
          rent_amount: 100,
          deposit_amount: 5000,
          area_exclusive_m2: 33.5,
          image_count: 5,
        },
        {
          // Missing address
          rent_amount: 80,
          deposit_amount: 3000,
          area_exclusive_m2: 40.2,
          image_count: 0, // No images
        },
      ];

      const quality = inferItemQuality(items);

      expect(quality.addressRate).toBe(0.5); // Only 1 out of 2 has address
      expect(quality.imageRate).toBe(0.5); // Only 1 out of 2 has images
      expect(quality.areaRate).toBe(1.0); // Both have area
      expect(quality.priceRate).toBe(1.0); // Both have price
      expect(quality.requiredFieldsRate).toBe(0.5); // Only 1 has all required fields
    });

    it("should handle items with missing price", () => {
      const items = [
        {
          address_text: "서울시 강남구",
          area_exclusive_m2: 33.5,
          image_count: 5,
        },
      ];

      const quality = inferItemQuality(items);

      expect(quality.priceRate).toBe(0);
      expect(quality.requiredFieldsRate).toBe(0); // Missing price fails required fields
    });

    it("should return zero rates for empty array", () => {
      const quality = inferItemQuality([]);

      expect(quality.requiredFieldsRate).toBe(0);
      expect(quality.addressRate).toBe(0);
      expect(quality.imageRate).toBe(0);
      expect(quality.areaRate).toBe(0);
      expect(quality.priceRate).toBe(0);
    });

    it("should handle items with only deposit or only rent", () => {
      const items = [
        {
          address_text: "서울시 강남구",
          deposit_amount: 5000, // Only deposit
          area_exclusive_m2: 33.5,
        },
        {
          address_text: "서울시 송파구",
          rent_amount: 100, // Only rent
          area_exclusive_m2: 40.2,
        },
      ];

      const quality = inferItemQuality(items);

      expect(quality.priceRate).toBe(1.0); // Both have at least one price field
    });
  });

  describe("mapGradeToTone", () => {
    it("should map GOOD to ok", () => {
      expect(mapGradeToTone("GOOD")).toBe("ok");
    });

    it("should map PARTIAL to partial", () => {
      expect(mapGradeToTone("PARTIAL")).toBe("partial");
    });

    it("should map SKIP to partial", () => {
      expect(mapGradeToTone("SKIP")).toBe("partial");
    });

    it("should map unknown grades to no", () => {
      expect(mapGradeToTone("FAIL")).toBe("no");
      expect(mapGradeToTone("ERROR")).toBe("no");
      expect(mapGradeToTone("UNKNOWN")).toBe("no");
      expect(mapGradeToTone(null)).toBe("no");
    });
  });

  describe("statusFromCode", () => {
    it("should map DONE to DONE", () => {
      expect(statusFromCode("DONE")).toBe("DONE");
    });

    it("should map PARTIAL to DONE", () => {
      expect(statusFromCode("PARTIAL")).toBe("DONE");
    });

    it("should map SKIP to SKIP", () => {
      expect(statusFromCode("SKIP")).toBe("SKIP");
    });

    it("should map FAILED to FAIL", () => {
      expect(statusFromCode("FAILED")).toBe("FAIL");
    });

    it("should map unknown codes to FAIL", () => {
      expect(statusFromCode("ERROR")).toBe("FAIL");
      expect(statusFromCode("UNKNOWN")).toBe("FAIL");
      expect(statusFromCode(null)).toBe("FAIL");
      expect(statusFromCode("")).toBe("FAIL");
    });
  });

  describe("hasDbConnectionError", () => {
    it("should return true for ECONNREFUSED errors", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for password authentication errors", () => {
      const error = new Error("password authentication failed for user 'postgres'");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for connection to server errors", () => {
      const error = new Error("connection to server at localhost failed");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for password must be a string errors", () => {
      const error = new Error("password must be a string");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for SASL errors", () => {
      const error = new Error("SASL authentication failed");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for server closed connection errors", () => {
      const error = new Error("server closed the connection unexpectedly");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return true for could not connect errors", () => {
      const error = new Error("could not connect to server");
      expect(hasDbConnectionError(error)).toBe(true);
    });

    it("should return false for regular errors", () => {
      const error = new Error("Some other database error");
      expect(hasDbConnectionError(error)).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(hasDbConnectionError(null)).toBe(false);
      expect(hasDbConnectionError(undefined)).toBe(false);
    });
  });

  describe("mapServerError", () => {
    it("should return 503 for DB connection errors", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
      const mapped = mapServerError(error);

      expect(mapped.status).toBe(503);
      expect(mapped.code).toBe("DB_CONNECTION_ERROR");
      expect(mapped.retryAfter).toBe("10");
      expect(mapped.message.includes("데이터베이스 연결")).toBeTruthy();
      expect(mapped.detail.includes("ECONNREFUSED")).toBeTruthy();
    });

    it("should return 503 for password authentication failures", () => {
      const error = new Error("password authentication failed");
      const mapped = mapServerError(error);

      expect(mapped.status).toBe(503);
      expect(mapped.code).toBe("DB_CONNECTION_ERROR");
      expect(mapped.retryAfter).toBe("10");
    });

    it("should return 500 for regular errors", () => {
      const error = new Error("Some internal error");
      const mapped = mapServerError(error);

      expect(mapped.status).toBe(500);
      expect(mapped.code).toBe("INTERNAL_ERROR");
      expect(mapped.message).toBe("Some internal error");
      expect(mapped.retryAfter).toBe(undefined);
    });

    it("should handle errors without message property", () => {
      const mapped = mapServerError("string error");

      expect(mapped.status).toBe(500);
      expect(mapped.code).toBe("INTERNAL_ERROR");
      expect(mapped.message).toBe("string error");
    });
  });

  describe("parseRunIdFilter", () => {
    it("should format run ID with wildcard pattern", () => {
      expect(parseRunIdFilter("run123")).toBe("run123::%");
    });

    it("should return wildcard pattern for null input", () => {
      expect(parseRunIdFilter(null)).toBe("%::%");
    });

    it("should return wildcard pattern for empty string", () => {
      expect(parseRunIdFilter("")).toBe("%::%");
    });

    it("should return wildcard pattern for undefined", () => {
      expect(parseRunIdFilter(undefined)).toBe("%::%");
    });
  });

  describe("normalizeBaseRunId", () => {
    it("should extract base run ID from compound ID", () => {
      expect(normalizeBaseRunId("run123::naver")).toBe("run123");
      expect(normalizeBaseRunId("abc-xyz::kbland")).toBe("abc-xyz");
      expect(normalizeBaseRunId("run_2024_01::zigbang")).toBe("run_2024_01");
    });

    it("should return the ID itself if no delimiter", () => {
      expect(normalizeBaseRunId("run123")).toBe("run123");
      expect(normalizeBaseRunId("simple_id")).toBe("simple_id");
    });

    it("should return null for null input", () => {
      expect(normalizeBaseRunId(null)).toBe(null);
    });

    it("should return null for empty string", () => {
      expect(normalizeBaseRunId("")).toBe(null);
    });

    it("should return null for whitespace-only string", () => {
      expect(normalizeBaseRunId("   ")).toBe(null);
    });

    it("should handle ID with only delimiter", () => {
      expect(normalizeBaseRunId("::")).toBe(null);
      expect(normalizeBaseRunId("::naver")).toBe(null);
    });

    it("should handle multiple delimiters", () => {
      expect(normalizeBaseRunId("run123::naver::extra")).toBe("run123");
    });
  });
});
