import { describe, it, expect } from "vitest";

describe("smoke test", () => {
  it("should pass basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("should handle Korean text", () => {
    const text = "서울시 노원구";
    expect(text).toContain("노원구");
  });
});
