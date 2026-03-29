import { REQUIRED_FIELDS, PHASE_STATUS } from "./constants.mjs";

const NORMALIZATION_PASS_RATE = 0.9;

export function evaluateNormalization(listings) {
  const total = listings.length;

  if (total === 0) {
    return {
      phase: "normalization",
      status: PHASE_STATUS.WARN,
      completeness: 0,
      null_field_counts: Object.fromEntries(REQUIRED_FIELDS.map((f) => [f, 0])),
      total_normalized: 0,
    };
  }

  const nullCounts = {};
  for (const field of REQUIRED_FIELDS) {
    nullCounts[field] = 0;
  }
  for (const listing of listings) {
    for (const field of REQUIRED_FIELDS) {
      const val = listing[field];
      if (val == null || val === "") nullCounts[field]++;
    }
  }

  const totalFields = REQUIRED_FIELDS.length * total;
  const totalNulls = Object.values(nullCounts).reduce((a, b) => a + b, 0);
  const completeness = Math.round(((totalFields - totalNulls) / totalFields) * 100);

  const status = completeness >= NORMALIZATION_PASS_RATE * 100 ? PHASE_STATUS.PASS : PHASE_STATUS.WARN;

  return {
    phase: "normalization",
    status,
    completeness,
    null_field_counts: nullCounts,
    total_normalized: total,
  };
}
