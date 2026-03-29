import { PHASE_STATUS } from "./constants.mjs";

export function buildNextActions(phases) {
  const actions = [];

  if (phases.collection?.failed_platforms?.length > 0) {
    actions.push(`retry failed platforms: ${phases.collection.failed_platforms.join(", ")}`);
  }

  if (phases.quality?.flagged_count > 0) {
    const flagSummary = {};
    for (const item of phases.quality.flagged || []) {
      for (const f of item.flags || []) {
        flagSummary[f] = (flagSummary[f] || 0) + 1;
      }
    }
    const detail = Object.entries(flagSummary)
      .map(([flag, count]) => `${count} ${flag}`)
      .join(", ");
    actions.push(`check ${phases.quality.flagged_count} flagged listings (${detail})`);
  }

  if (phases.matching?.still_uncertain > 0) {
    const ids = (phases.matching.uncertain_pairs || [])
      .slice(0, 5)
      .map((p) => `${p.source_id}-${p.target_id}`)
      .join(", ");
    actions.push(`review ${phases.matching.still_uncertain} uncertain matches (${ids})`);
  }

  return actions;
}

export function buildReport(runId, phases, durationMs) {
  const statuses = Object.values(phases).map((p) => p.status);

  let overall;
  if (statuses.includes(PHASE_STATUS.FAIL)) {
    overall = PHASE_STATUS.FAIL;
  } else if (statuses.includes(PHASE_STATUS.WARN)) {
    overall = PHASE_STATUS.WARN;
  } else {
    overall = PHASE_STATUS.PASS;
  }

  return {
    run_id: runId,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    phases: {
      collection: phases.collection,
      normalization: phases.normalization,
      quality: phases.quality,
      matching: phases.matching,
    },
    overall,
    next_actions: buildNextActions(phases),
  };
}
