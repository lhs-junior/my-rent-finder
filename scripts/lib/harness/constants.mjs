// scripts/lib/harness/constants.mjs

/** Collection quality gate thresholds */
export const COLLECTION_THRESHOLDS = {
  successRate: 0.8,
  requiredFieldRate: 0.9,
  imageValidRate: 0.5,
  priceOutlierRate: 0.05,
  duplicateRate: 0.2,
  maxRetries: 2,
  passScore: 70,
};

/** Collection metric weights (sum = 1.0) */
export const COLLECTION_WEIGHTS = {
  successRate: 0.3,
  requiredFieldRate: 0.3,
  imageValidRate: 0.15,
  priceOutlierRate: 0.15,
  duplicateRate: 0.1,
};

/** Required fields that must be non-null in normalized_listings */
export const REQUIRED_FIELDS = [
  "address_text",
  "area_exclusive_m2",
  "rent_amount",
  "deposit_amount",
];

/** Listing quality scoring rules */
export const QUALITY_RULES = [
  {
    flag: "no_images",
    deduction: -25,
    check: (listing) => listing.image_count === 0,
  },
  {
    flag: "price_suspiciously_low",
    deduction: -30,
    check: (listing) => {
      if (listing.rent_amount == null || listing.median_rent == null) return false;
      return listing.rent_amount < listing.median_rent * 0.5;
    },
  },
  {
    flag: "room_area_mismatch",
    deduction: -20,
    check: (listing) => {
      if (listing.area_exclusive_m2 == null || listing.room_count == null) return false;
      return listing.area_exclusive_m2 < 20 && listing.room_count >= 3;
    },
  },
  {
    flag: "incomplete_data",
    deduction: -20,
    check: (listing) => {
      let missing = 0;
      for (const f of REQUIRED_FIELDS) {
        if (listing[f] == null || listing[f] === "") missing++;
      }
      return missing >= 3;
    },
  },
  {
    flag: "bulk_lister",
    deduction: -15,
    check: (listing) => listing.same_contact_count != null && listing.same_contact_count >= 20,
  },
  {
    flag: "stale_listing",
    deduction: -10,
    check: (listing) => listing.stale_hours != null && listing.stale_hours > 2160,
  },
  {
    flag: "no_description",
    deduction: -10,
    check: (listing) => {
      const desc = listing.description || "";
      return desc.length < 10;
    },
  },
];

/** Quality score tier thresholds */
export const QUALITY_TIERS = {
  normal: 70,
  caution: 40,
};

/** Suspicious listing rate threshold for phase gate */
export const SUSPICIOUS_RATE_THRESHOLD = 0.15;

/** Match evaluator bonus scores */
export const EVALUATOR_BONUSES = {
  addressTokenMatch: 8,
  areaDepositClose: 5,
  imageUrlOverlap: 10,
  allAttributesMatch: 5,
  twoAttributesMatch: 3,
  crossPlatform: 2,
};

/** Match evaluator thresholds (same as matcher_v1) */
export const MATCH_THRESHOLDS = {
  autoMatch: 93,
  reviewMin: 80,
};

/** Phase status enum */
export const PHASE_STATUS = {
  PASS: "pass",
  FAIL: "fail",
  WARN: "warn",
};

/**
 * Compute weighted score from metric results.
 * Each metric: { value: 0~1 actual rate, threshold: 0~1 required, weight: 0~1 }
 * Returns 0~100 score.
 */
export function computeWeightedScore(metrics) {
  let total = 0;
  let weightSum = 0;
  for (const m of metrics) {
    const ratio = m.threshold > 0 ? Math.min(1, m.value / m.threshold) : (m.value > 0 ? 1 : 0);
    total += ratio * m.weight * 100;
    weightSum += m.weight;
  }
  if (weightSum === 0) return 0;
  return Math.round(Math.max(0, Math.min(100, total / weightSum)));
}
