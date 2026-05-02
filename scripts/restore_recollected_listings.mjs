#!/usr/bin/env node

/**
 * Patch B (Day 7) — 일회성 회복 SQL
 *
 * ops_db_persistence.mjs:1521에서 ON CONFLICT 시 deleted_at을 보존하던
 * 옛 동작 때문에, 한 번 마킹된 매물이 다음 cron에 재수집돼도 사이트에서
 * 안 보이는 누락 버그가 누적됨.
 *
 * 이 스크립트는 누적된 backlog를 한 번에 회복:
 *   "deleted_at IS NOT NULL이지만 deleted_at 이후에 raw_listings에 다시 수집된 매물"
 *
 * Day 7 패치(deleted_at = NULL on ON CONFLICT)가 적용된 이후에는 cron마다 자동
 * 회복되므로, 이 스크립트는 1회 실행으로 충분.
 *
 * --apply 없으면 dry-run.
 */

import { withDbClient } from "./lib/db_client.mjs";

const apply = process.argv.includes("--apply");

await withDbClient(async (client) => {
  // 회복 대상 카운트
  const { rows: countRows } = await client.query(`
    SELECT COUNT(*)::int AS recoverable
    FROM normalized_listings nl
    WHERE nl.deleted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM raw_listings r
        WHERE r.platform_code = nl.platform_code
          AND r.external_id = nl.external_id
          AND r.collected_at > nl.deleted_at
      )
  `);
  const total = countRows[0].recoverable;

  // 플랫폼별 분포
  const { rows: byPlat } = await client.query(`
    SELECT nl.platform_code, COUNT(*)::int AS recoverable
    FROM normalized_listings nl
    WHERE nl.deleted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM raw_listings r
        WHERE r.platform_code = nl.platform_code
          AND r.external_id = nl.external_id
          AND r.collected_at > nl.deleted_at
      )
    GROUP BY nl.platform_code
    ORDER BY nl.platform_code
  `);

  console.log(`[restore] 회복 대상: ${total}건`);
  for (const r of byPlat) {
    console.log(`  - ${r.platform_code}: ${r.recoverable}건`);
  }

  if (!apply) {
    console.log("\n[restore] DRY RUN — --apply 플래그를 추가해야 실제 회복됩니다.");
    return;
  }

  const { rowCount } = await client.query(`
    UPDATE normalized_listings nl
    SET deleted_at = NULL,
        updated_at = NOW()
    WHERE nl.deleted_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM raw_listings r
        WHERE r.platform_code = nl.platform_code
          AND r.external_id = nl.external_id
          AND r.collected_at > nl.deleted_at
      )
  `);

  console.log(`\n[restore] ✅ ${rowCount}건 deleted_at 클리어 완료.`);
  console.log("[restore] 다음 status check가 진짜 expired 매물은 다시 마킹할 것.");
});
