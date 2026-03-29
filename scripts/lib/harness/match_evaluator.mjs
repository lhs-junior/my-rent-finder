import { EVALUATOR_BONUSES, MATCH_THRESHOLDS, PHASE_STATUS } from "./constants.mjs";

function extractAddressTokens(text) {
  if (!text) return [];
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => /\d/.test(t) || t.endsWith("동") || t.endsWith("호"));
}

export function evaluatePair(pair) {
  const { source, target, score } = pair;
  let bonus = 0;
  const bonuses = [];

  if (!source || !target) {
    return { adjusted_score: score, bonus: 0, bonuses: [], decision: "uncertain" };
  }

  // 1. Address token match
  const srcTokens = extractAddressTokens(source.addressText);
  const tgtTokens = extractAddressTokens(target.addressText);
  if (srcTokens.length > 0 && tgtTokens.length > 0) {
    const overlap = srcTokens.filter((t) => tgtTokens.includes(t));
    if (overlap.length >= 2 || (overlap.length >= 1 && srcTokens.length <= 2)) {
      bonus += EVALUATOR_BONUSES.addressTokenMatch;
      bonuses.push("addressTokenMatch");
    }
  }

  // 2. Area + deposit close
  const srcArea = source.areaExclusive;
  const tgtArea = target.areaExclusive;
  const srcDep = source.depositAmount;
  const tgtDep = target.depositAmount;
  if (srcArea != null && tgtArea != null && srcDep != null && tgtDep != null) {
    const areaDiff = Math.abs(srcArea - tgtArea);
    const depDiff = Math.abs(srcDep - tgtDep);
    if (areaDiff <= 2 && depDiff <= 500) {
      bonus += EVALUATOR_BONUSES.areaDepositClose;
      bonuses.push("areaDepositClose");
    }
  }

  // 3. Image URL overlap
  const srcImgs = source.imageUrls || [];
  const tgtImgs = target.imageUrls || [];
  if (srcImgs.length > 0 && tgtImgs.length > 0) {
    const srcSet = new Set(srcImgs);
    const hasOverlap = tgtImgs.some((url) => srcSet.has(url));
    if (hasOverlap) {
      bonus += EVALUATOR_BONUSES.imageUrlOverlap;
      bonuses.push("imageUrlOverlap");
    }
  }

  // 4. Floor + roomCount + leaseType match
  let attrMatches = 0;
  if (source.floor != null && target.floor != null && source.floor === target.floor) attrMatches++;
  if (source.roomCount != null && target.roomCount != null && source.roomCount === target.roomCount) attrMatches++;
  if (source.leaseType && target.leaseType && source.leaseType === target.leaseType) attrMatches++;

  if (attrMatches >= 3) {
    bonus += EVALUATOR_BONUSES.allAttributesMatch;
    bonuses.push("allAttributesMatch");
  } else if (attrMatches >= 2) {
    bonus += EVALUATOR_BONUSES.twoAttributesMatch;
    bonuses.push("twoAttributesMatch");
  }

  // 5. Cross-platform bonus
  if (source.platformCode && target.platformCode && source.platformCode !== target.platformCode) {
    bonus += EVALUATOR_BONUSES.crossPlatform;
    bonuses.push("crossPlatform");
  }

  const adjustedScore = score + bonus;
  let decision;
  if (adjustedScore >= MATCH_THRESHOLDS.autoMatch) {
    decision = "match";
  } else if (adjustedScore < MATCH_THRESHOLDS.reviewMin) {
    decision = "distinct";
  } else {
    decision = "uncertain";
  }

  return {
    source_listing_id: pair.source_listing_id,
    target_listing_id: pair.target_listing_id,
    original_score: score,
    adjusted_score: adjustedScore,
    bonus,
    bonuses,
    decision,
  };
}

export function evaluateMatches(pairs) {
  let autoMatched = 0;
  let promoted = 0;
  let demoted = 0;
  const uncertainPairs = [];

  for (const pair of pairs) {
    if (pair.status === "AUTO_MATCH") {
      autoMatched++;
      continue;
    }
    if (pair.status !== "REVIEW_REQUIRED") continue;

    const result = evaluatePair(pair);
    if (result.decision === "match") {
      promoted++;
    } else if (result.decision === "distinct") {
      demoted++;
    } else {
      uncertainPairs.push({
        source_id: pair.source_listing_id,
        target_id: pair.target_listing_id,
        original_score: pair.score,
        adjusted_score: result.adjusted_score,
        bonuses: result.bonuses,
      });
    }
  }

  return {
    phase: "matching",
    status: PHASE_STATUS.PASS,
    auto_matched: autoMatched,
    evaluator_promoted: promoted,
    evaluator_demoted: demoted,
    still_uncertain: uncertainPairs.length,
    uncertain_pairs: uncertainPairs.slice(0, 20),
  };
}
