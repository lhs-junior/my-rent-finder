#!/usr/bin/env node
import { withDbClient } from "./lib/db_client.mjs";
import { fetchZigbangV3ItemDetail, mergeZigbangDetail } from "./zigbang_auto_collector.mjs";
import { ZigbangListingAdapter } from "./adapters/zigbang_listings_adapter.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 200;

const adapter = new ZigbangListingAdapter();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await withDbClient(async (db) => {
  const { rows } = await db.query(`
    SELECT listing_id, source_ref, raw_id, direction, floor, total_floor
    FROM normalized_listings
    WHERE platform_code = 'zigbang' AND deleted_at IS NULL
    ORDER BY listing_id
  `);

  console.log(`대상: ${rows.length}개 직방 매물 (dry_run=${DRY_RUN})\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const detail = await fetchZigbangV3ItemDetail(row.source_ref);
    if (!detail) {
      console.log(`  SKIP ${row.source_ref}: v3 API 응답 없음`);
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    const rawMerged = mergeZigbangDetail({ item_id: row.source_ref }, detail);
    const derived = adapter.postProcess(
      { image_urls: [] },
      { payload_json: rawMerged },
    );

    const patch = {
      room_count:              derived.room_count            ?? null,
      direction:               derived.direction             ?? null,
      floor:                   derived.floor                 ?? null,
      total_floor:             derived.total_floor           ?? null,
      bathroom_count:          derived.bathroom_count        ?? null,
      building_year:           derived.building_year         ?? null,
      monthly_management_cost: derived.monthly_management_cost ?? null,
      parking_possible:        derived.parking_possible      ?? null,
      available_date:          derived.available_date        ?? null,
      description_text:        derived.description_text      ?? null,
    };

    const imgUrls = Array.isArray(derived.image_urls) ? derived.image_urls : [];

    console.log(
      `  ${row.source_ref}: room=${patch.room_count} dir=${patch.direction}` +
      ` floor=${patch.floor}/${patch.total_floor} bath=${patch.bathroom_count}` +
      ` year=${patch.building_year} mgmt=${patch.monthly_management_cost}` +
      ` imgs=${imgUrls.length}`,
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

      if (imgUrls.length > 0) {
        await db.query(`DELETE FROM listing_images WHERE listing_id = $1`, [row.listing_id]);
        for (let i = 0; i < imgUrls.length; i++) {
          await db.query(
            `INSERT INTO listing_images (listing_id, raw_id, source_url, status, is_primary)
             VALUES ($1, $2, $3, 'queued', $4)
             ON CONFLICT (listing_id, source_url) DO NOTHING`,
            [row.listing_id, row.raw_id ?? null, imgUrls[i], i === 0],
          );
        }
      }
    }

    updated++;
    await sleep(DELAY_MS);
  }

  console.log(`\n완료: updated=${updated}, skipped=${skipped}`);
});
