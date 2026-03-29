import {
  QUALITY_RULES,
  QUALITY_TIERS,
  SUSPICIOUS_RATE_THRESHOLD,
  PHASE_STATUS,
} from "./constants.mjs";

export function scoreListing(listing) {
  let score = 100;
  const flags = [];

  for (const rule of QUALITY_RULES) {
    if (rule.check(listing)) {
      score += rule.deduction;
      flags.push(rule.flag);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let tier;
  if (score >= QUALITY_TIERS.normal) {
    tier = "normal";
  } else if (score >= QUALITY_TIERS.caution) {
    tier = "caution";
  } else {
    tier = "suspicious";
  }

  return {
    listing_id: listing.listing_id,
    score,
    flags,
    tier,
  };
}

export function evaluateListingQuality(listings) {
  const results = listings.map(scoreListing);

  const tiers = { normal: 0, caution: 0, suspicious: 0 };
  const flagged = [];

  for (const r of results) {
    tiers[r.tier]++;
    if (r.tier !== "normal") {
      flagged.push({ listing_id: r.listing_id, score: r.score, flags: r.flags, tier: r.tier });
    }
  }

  const total = listings.length || 1;
  const suspiciousRate = tiers.suspicious / total;
  const status = suspiciousRate <= SUSPICIOUS_RATE_THRESHOLD ? PHASE_STATUS.PASS : PHASE_STATUS.WARN;

  return {
    phase: "quality",
    status,
    total: listings.length,
    tiers,
    suspicious_rate: Math.round(suspiciousRate * 1000) / 1000,
    flagged_count: flagged.length,
    flagged: flagged.slice(0, 50),
  };
}
