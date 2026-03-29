import { describe, it, expect } from "vitest";
import { buildReport, buildNextActions } from "../scripts/lib/harness/report_builder.mjs";

describe("buildNextActions", () => {
  it("suggests reviewing uncertain matches", () => {
    const matchResult = { still_uncertain: 3, uncertain_pairs: [{ source_id: 1, target_id: 2 }] };
    const actions = buildNextActions({ matching: matchResult });
    expect(actions.some((a) => a.includes("uncertain"))).toBe(true);
  });

  it("suggests checking flagged listings", () => {
    const qualityResult = { flagged_count: 8, flagged: [{ flags: ["no_images"] }] };
    const actions = buildNextActions({ quality: qualityResult });
    expect(actions.some((a) => a.includes("flagged"))).toBe(true);
  });

  it("suggests retrying failed platforms", () => {
    const collectionResult = { failed_platforms: ["dabang"] };
    const actions = buildNextActions({ collection: collectionResult });
    expect(actions.some((a) => a.includes("dabang"))).toBe(true);
  });

  it("returns empty for all-pass", () => {
    const actions = buildNextActions({
      collection: { failed_platforms: [] },
      quality: { flagged_count: 0 },
      matching: { still_uncertain: 0 },
    });
    expect(actions).toEqual([]);
  });
});

describe("buildReport", () => {
  it("builds complete report", () => {
    const phases = {
      collection: { phase: "collection", status: "pass", score: 87, retries: 0, failed_platforms: [] },
      normalization: { phase: "normalization", status: "pass", completeness: 94 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 10, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-1", phases, 5000);
    expect(report.run_id).toBe("test-run-1");
    expect(report.duration_ms).toBe(5000);
    expect(report.phases.collection.status).toBe("pass");
    expect(report.overall).toBe("pass");
    expect(report.next_actions).toEqual([]);
  });

  it("sets overall to warn when any phase warns", () => {
    const phases = {
      collection: { phase: "collection", status: "pass", score: 87, retries: 0, failed_platforms: [] },
      normalization: { phase: "normalization", status: "warn", completeness: 80 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 5, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-2", phases, 3000);
    expect(report.overall).toBe("warn");
  });

  it("sets overall to fail when any phase fails", () => {
    const phases = {
      collection: { phase: "collection", status: "fail", score: 40, retries: 2, failed_platforms: ["dabang"] },
      normalization: { phase: "normalization", status: "pass", completeness: 94 },
      quality: { phase: "quality", status: "pass", flagged_count: 0, flagged: [] },
      matching: { phase: "matching", status: "pass", auto_matched: 5, still_uncertain: 0, uncertain_pairs: [] },
    };
    const report = buildReport("test-run-3", phases, 2000);
    expect(report.overall).toBe("fail");
  });
});
