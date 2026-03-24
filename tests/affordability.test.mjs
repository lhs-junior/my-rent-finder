import { describe, it, expect } from "vitest";
import { calcAffordability } from "../scripts/lib/affordability.mjs";

describe("calcAffordability", () => {
  const settings = {
    my_capital: 10000,   // 1억 (만원)
    my_income: 7000,     // 7천만원 (만원)
    ltv_ratio: 0.70,
    dti_limit: 0.60,
    loan_rate: 0.035,
    loan_years: 30,
  };

  it("가능: 3.3억 이하 매물", () => {
    const result = calcAffordability(33000, settings);
    expect(result.feasible).toBe(true);
    expect(result.shortage).toBe(0);
    expect(result.requiredCapital).toBe(9900);
    expect(result.loanAmount).toBe(23100);
    expect(result.monthlyPayment).toBeGreaterThan(0);
    expect(result.dti).toBeLessThanOrEqual(0.60);
  });

  it("불가: 5억 매물, 자본 1억 (4천만원 부족)", () => {
    const result = calcAffordability(50000, settings);
    expect(result.feasible).toBe(false);
    expect(result.shortage).toBe(5000); // 1.5억 - 1억 = 5000만원
    expect(result.requiredCapital).toBe(15000);
  });

  it("DTI 초과 시 불가", () => {
    const lowIncome = { ...settings, my_income: 500 }; // 500만원 연소득
    const result = calcAffordability(33000, lowIncome);
    expect(result.feasible).toBe(false);
  });

  it("매매가 0 이하면 에러", () => {
    expect(() => calcAffordability(0, settings)).toThrow();
  });
});
