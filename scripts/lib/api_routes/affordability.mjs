// scripts/lib/api_routes/affordability.mjs
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";
import { calcAffordability } from "../affordability.mjs";

const DEFAULTS = {
  my_capital: "10000",
  my_income: "7000",
  loan_type: "bogeumjari",
  ltv_ratio: "0.70",
  dti_limit: "0.60",
};

export async function handleAffordability(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const salePriceParam = url.searchParams.get("salePrice");
  const salePrice = salePriceParam ? parseInt(salePriceParam, 10) : null;

  if (!salePrice || isNaN(salePrice) || salePrice <= 0) {
    sendJson(res, 400, { error: "salePrice query param required (만원 단위)" });
    return;
  }

  let stored = {};
  try {
    const rows = await withDbClient((client) =>
      client.query("SELECT key, value FROM user_settings")
    );
    stored = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
  } catch (_e) {
    // fall back to defaults if DB unavailable
  }

  const merged = { ...DEFAULTS, ...stored };

  const settings = {
    my_capital: parseFloat(merged.my_capital),
    my_income: parseFloat(merged.my_income),
    ltv_ratio: parseFloat(merged.ltv_ratio),
    dti_limit: parseFloat(merged.dti_limit),
    loan_rate: merged.loan_type === "bogeumjari" ? 0.035 : 0.045,
    loan_years: 30,
  };

  try {
    const result = calcAffordability(salePrice, settings);
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}
