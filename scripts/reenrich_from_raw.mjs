#!/usr/bin/env node
/**
 * raw_listings에 저장된 기존 payload를 수정된 어댑터로 재정규화하여
 * normalized_listings의 잘못 들어간/누락된 컬럼을 즉시 수정한다.
 *
 * Usage:
 *   node scripts/reenrich_from_raw.mjs [--dry-run] [platform ...]
 *   node scripts/reenrich_from_raw.mjs               # kbland + dabang + peterpanz
 *   node scripts/reenrich_from_raw.mjs kbland         # kbland만
 *   node scripts/reenrich_from_raw.mjs --dry-run      # 실제 UPDATE 없이 미리보기
 */
import { withDbClient } from "./lib/db_client.mjs";
import { KblandListingAdapter } from "./adapters/kbland_listings_adapter.mjs";
import { DabangListingAdapter } from "./adapters/dabang_listings_adapter.mjs";
import { PeterpanzListingAdapter } from "./adapters/peterpanz_listings_adapter.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const ARG_PLATFORMS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const ADAPTERS = {
  kbland:    new KblandListingAdapter(),
  dabang:    new DabangListingAdapter(),
  peterpanz: new PeterpanzListingAdapter(),
};

const PATCH_COLS = [
  "room_count", "direction", "floor", "total_floor",
  "bathroom_count", "building_year", "monthly_management_cost",
  "parking_possible", "available_date", "description_text",
];

await withDbClient(async (db) => {
  const platforms = ARG_PLATFORMS.length > 0 ? ARG_PLATFORMS : Object.keys(ADAPTERS);
  console.log(`대상 플랫폼: ${platforms.join(", ")} (dry_run=${DRY_RUN})\n`);

  for (const platform of platforms) {
    const adapter = ADAPTERS[platform];
    if (!adapter) {
      console.error(`알 수 없는 플랫폼: ${platform} (지원: ${Object.keys(ADAPTERS).join(", ")})`);
      continue;
    }

    const { rows } = await db.query(`
      SELECT DISTINCT ON (nl.external_id)
        nl.listing_id,
        rl.payload_json,
        rl.collected_at,
        rl.source_url
      FROM normalized_listings nl
      JOIN raw_listings rl
        ON rl.external_id = nl.external_id
       AND rl.platform_code = nl.platform_code
      WHERE nl.platform_code = $1
        AND nl.deleted_at IS NULL
      ORDER BY nl.external_id, rl.collected_at DESC
    `, [platform]);

    console.log(`[${platform}] 대상: ${rows.length}개`);

    let updated = 0;
    let skipped = 0;
    let failed  = 0;

    for (const row of rows) {
      let normalized;
      try {
        const results = adapter.normalizeFromRawRecord({
          payload_json: row.payload_json,
          collected_at: row.collected_at,
          source_url:   row.source_url,
        });
        normalized = results?.[0];
      } catch (e) {
        console.log(`  FAIL listing_id=${row.listing_id}: ${e.message}`);
        failed++;
        continue;
      }

      if (!normalized) {
        skipped++;
        continue;
      }

      const patch = Object.fromEntries(PATCH_COLS.map((col) => [col, normalized[col] ?? null]));

      console.log(
        `  ${platform}/${row.listing_id}:` +
        ` bath=${patch.bathroom_count} year=${patch.building_year}` +
        ` mgmt=${patch.monthly_management_cost}` +
        ` dir=${patch.direction}` +
        ` desc=${patch.description_text?.slice(0, 25) ?? null}`,
      );

      if (!DRY_RUN) {
        await db.query(
          `UPDATE normalized_listings SET
             room_count              = $2,
             direction               = $3,
             floor                   = $4,
             total_floor             = $5,
             bathroom_count          = $6,
             building_year           = $7,
             monthly_management_cost = $8,
             parking_possible        = $9,
             available_date          = $10,
             description_text        = $11,
             updated_at              = NOW()
           WHERE listing_id = $1`,
          [
            row.listing_id,
            patch.room_count,
            patch.direction,
            patch.floor,
            patch.total_floor,
            patch.bathroom_count,
            patch.building_year,
            patch.monthly_management_cost,
            patch.parking_possible,
            patch.available_date,
            patch.description_text,
          ],
        );
      }
      updated++;
    }

    console.log(`  → updated=${updated}, skipped=${skipped}, failed=${failed}\n`);
  }

  console.log("완료");
});
