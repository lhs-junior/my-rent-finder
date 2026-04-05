import {
  COLLECTION_THRESHOLDS,
  COLLECTION_WEIGHTS,
  REQUIRED_FIELDS,
  PHASE_STATUS,
  computeWeightedScore,
} from "./constants.mjs";

export function evaluatePlatform(platform, data) {
  const { requested, collected, listings } = data;
  const total = listings.length || 1;

  const successRate = requested > 0 ? collected / requested : 0;

  let fieldComplete = 0;
  for (const listing of listings) {
    const hasAll = REQUIRED_FIELDS.every((f) => listing[f] != null && listing[f] !== "");
    if (hasAll) fieldComplete++;
  }
  const requiredFieldRate = total > 0 ? fieldComplete / total : 0;

  let withImages = 0;
  for (const listing of listings) {
    const urls = listing.image_urls || listing.imageUrls || [];
    if (Array.isArray(urls) && urls.length > 0) withImages++;
  }
  const imageValidRate = total > 0 ? withImages / total : 0;

  const rents = listings.map((l) => l.rent_amount ?? l.rentAmount).filter((v) => v != null && v > 0);
  let outlierCount = 0;
  if (rents.length > 0) {
    const sorted = [...rents].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const r of rents) {
      if (r < median * 0.25 || r > median * 4) outlierCount++;
    }
  }
  const priceOutlierRate = rents.length > 0 ? outlierCount / rents.length : 0;

  const addrSet = new Set();
  let dupeCount = 0;
  for (const listing of listings) {
    const addr = (listing.address_text || listing.addressText || "").trim();
    if (addr && addrSet.has(addr)) dupeCount++;
    else addrSet.add(addr);
  }
  const duplicateRate = total > 0 ? dupeCount / total : 0;

  const metrics = [
    { value: successRate, threshold: COLLECTION_THRESHOLDS.successRate, weight: COLLECTION_WEIGHTS.successRate },
    { value: requiredFieldRate, threshold: COLLECTION_THRESHOLDS.requiredFieldRate, weight: COLLECTION_WEIGHTS.requiredFieldRate },
    { value: imageValidRate, threshold: COLLECTION_THRESHOLDS.imageValidRate, weight: COLLECTION_WEIGHTS.imageValidRate },
    { value: 1 - priceOutlierRate, threshold: 1 - COLLECTION_THRESHOLDS.priceOutlierRate, weight: COLLECTION_WEIGHTS.priceOutlierRate },
    { value: 1 - duplicateRate, threshold: 1 - COLLECTION_THRESHOLDS.duplicateRate, weight: COLLECTION_WEIGHTS.duplicateRate },
  ];

  const rawScore = computeWeightedScore(metrics);
  // Hard gate: if collection success rate is below threshold, cap score below pass threshold
  const hardFail = successRate < COLLECTION_THRESHOLDS.successRate;
  const score = hardFail ? Math.min(rawScore, COLLECTION_THRESHOLDS.passScore - 1) : rawScore;
  const status = score >= COLLECTION_THRESHOLDS.passScore ? PHASE_STATUS.PASS : PHASE_STATUS.FAIL;

  return {
    platform,
    status,
    score,
    metrics: {
      successRate: Math.round(successRate * 1000) / 1000,
      requiredFieldRate: Math.round(requiredFieldRate * 1000) / 1000,
      imageValidRate: Math.round(imageValidRate * 1000) / 1000,
      priceOutlierRate: Math.round(priceOutlierRate * 1000) / 1000,
      duplicateRate: Math.round(duplicateRate * 1000) / 1000,
    },
  };
}

// CDP가 필요해서 launchd 환경에서 실패해도 전체 gate에 영향 없는 플랫폼
const OPTIONAL_PLATFORMS = new Set(["kbland"]);

export function evaluateCollection(summary) {
  const perPlatform = {};
  const scores = [];
  const failedPlatforms = [];

  for (const [platform, data] of Object.entries(summary.platforms)) {
    const result = evaluatePlatform(platform, data);
    perPlatform[platform] = result;
    if (!OPTIONAL_PLATFORMS.has(platform)) {
      scores.push(result.score);
      if (result.status === PHASE_STATUS.FAIL) failedPlatforms.push(platform);
    }
  }

  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const status = avgScore >= COLLECTION_THRESHOLDS.passScore ? PHASE_STATUS.PASS : PHASE_STATUS.FAIL;

  return {
    phase: "collection",
    status,
    score: avgScore,
    retries: 0,
    per_platform: perPlatform,
    failed_platforms: failedPlatforms,
    timestamp: new Date().toISOString(),
  };
}
