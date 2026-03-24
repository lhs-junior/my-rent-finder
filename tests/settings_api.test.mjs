// tests/settings_api.test.mjs
import { describe, it, expect } from "vitest";
import { validatePin, parseSettingsBody } from "../scripts/lib/api_routes/settings.mjs";

describe("settings PIN validation", () => {
  it("올바른 PIN 통과", () => {
    expect(validatePin("1234", "1234")).toBe(true);
  });

  it("틀린 PIN 거부", () => {
    expect(validatePin("wrong", "1234")).toBe(false);
  });

  it("PIN 미입력 거부", () => {
    expect(validatePin(undefined, "1234")).toBe(false);
    expect(validatePin("", "1234")).toBe(false);
  });
});

describe("parseSettingsBody", () => {
  it("유효한 설정값 파싱", () => {
    const body = { pin: "1234", key: "my_capital", value: "10000" };
    const result = parseSettingsBody(body);
    expect(result.key).toBe("my_capital");
    expect(result.value).toBe("10000");
  });

  it("허용되지 않는 key 거부", () => {
    const body = { pin: "1234", key: "unknown_key", value: "10000" };
    expect(() => parseSettingsBody(body)).toThrow();
  });
});
