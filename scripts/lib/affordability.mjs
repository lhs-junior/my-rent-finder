/**
 * 월 원리금 균등상환 계수 계산 (PMT)
 * @param {number} rate - 연 금리 (예: 0.035)
 * @param {number} years - 대출 기간 (년)
 */
function monthlyPaymentFactor(rate, years) {
  const r = rate / 12;
  const n = years * 12;
  if (r === 0) return 1 / n;
  return (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/**
 * 구매 가능 여부 계산
 * @param {number} salePrice - 매매가 (만원)
 * @param {Object} settings - user_settings 값
 */
export function calcAffordability(salePrice, settings) {
  if (!salePrice || salePrice <= 0) throw new Error("salePrice must be positive");

  const {
    my_capital,
    my_income,
    ltv_ratio = 0.70,
    dti_limit = 0.60,
    loan_rate = 0.035,
    loan_years = 30,
  } = settings;

  const requiredCapital = Math.round(salePrice * (1 - ltv_ratio));
  const loanAmount = salePrice - requiredCapital;
  const factor = monthlyPaymentFactor(loan_rate, loan_years);
  const monthlyPayment = Math.round(loanAmount * factor);
  const annualPayment = monthlyPayment * 12;
  const dti = annualPayment / my_income;
  const capitalOk = my_capital >= requiredCapital;
  const dtiOk = dti <= dti_limit;

  return {
    feasible: capitalOk && dtiOk,
    shortage: capitalOk ? 0 : requiredCapital - my_capital,
    requiredCapital,
    loanAmount,
    monthlyPayment,
    dti: Math.round(dti * 100) / 100,
  };
}
