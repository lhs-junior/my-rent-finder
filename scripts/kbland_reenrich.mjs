#!/usr/bin/env node
import { withDbClient } from "./lib/db_client.mjs";
import { fetchKbDetailInfo } from "./kbland_auto_collector.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseKbYear(raw) {
  if (!raw) return null;
  const s = String(raw).trim().slice(0, 4);
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null;
}

await withDbClient(async (db) => {
  const { rows } = await db.query(`
    SELECT listing_id, external_id
    FROM normalized_listings
    WHERE platform_code = 'kbland'
      AND deleted_at IS NULL
      AND (direction IS NULL OR bathroom_count IS NULL OR building_year IS NULL)
    ORDER BY listing_id
  `);

  console.log(`대상: ${rows.length}개 kbland 매물 (direction/bath/year 누락, dry_run=${DRY_RUN})\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const detail = await fetchKbDetailInfo(row.external_id);
    if (!detail) {
      console.log(`  SKIP ${row.external_id}: API 응답 없음`);
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    const patch = {
      direction:      detail.방향명 || null,
      bathroom_count: detail.욕실수 != null ? parseInt(detail.욕실수, 10) : null,
      building_year:  parseKbYear(detail.사용승인일),
    };

    console.log(
      `  ${row.external_id}: dir=${patch.direction} bath=${patch.bathroom_count} year=${patch.building_year}`,
    );

    if (!DRY_RUN) {
      await db.query(
        `UPDATE normalized_listings SET
           direction      = COALESCE($2, direction),
           bathroom_count = COALESCE($3, bathroom_count),
           building_year  = COALESCE($4, building_year),
           updated_at     = NOW()
         WHERE listing_id = $1`,
        [row.listing_id, patch.direction, patch.bathroom_count, patch.building_year],
      );
    }

    updated++;
    await sleep(DELAY_MS);
  }

  console.log(`\n완료: updated=${updated}, skipped=${skipped}`);
});
