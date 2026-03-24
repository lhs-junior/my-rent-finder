#!/usr/bin/env node

import { toInt, toNumber, toText, withDbClient } from "./lib/db_client.mjs";

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const index = args.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index === -1) return fallback;
  if (args[index] === name) return args[index + 1] ?? fallback;
  return args[index].split("=").slice(1).join("=") ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const apply = hasFlag("--apply");
const minArea = Math.max(0, Number(getArg("--min-area", "40")) || 40);
const limit = Math.max(0, Number(getArg("--limit", "0")) || 0);

function printPreview(rows) {
  if (!rows.length) {
    console.log("No invalid daangn listings found.");
    return;
  }

  for (const row of rows) {
    console.log([
      `listing_id=${toInt(row.listing_id, null)}`,
      `raw_id=${toInt(row.raw_id, null)}`,
      `area=${toNumber(row.area_exclusive_m2, null)}`,
      `claimed=${toText(row.area_claimed, "-")}`,
      `title=${toText(row.title, "-")}`,
      `source_url=${toText(row.source_url, "-")}`,
    ].join(" | "));
  }
}

await withDbClient(async (client) => {
  const rows = await client.query(
    `
      SELECT listing_id, raw_id, title, source_url, area_exclusive_m2, area_claimed
      FROM normalized_listings
      WHERE platform_code = 'daangn'
        AND (
          COALESCE(area_exclusive_m2, 0) <= 0
          OR area_claimed <> 'exclusive'
          OR area_exclusive_m2 < $1
        )
      ORDER BY listing_id
      ${limit > 0 ? `LIMIT ${limit}` : ""}
    `,
    [minArea],
  );

  const listingIds = (rows.rows || [])
    .map((row) => toInt(row.listing_id, null))
    .filter((value) => value !== null);

  console.log(`Invalid daangn listings: ${listingIds.length}`);
  printPreview(rows.rows || []);

  if (!apply || listingIds.length === 0) {
    console.log(apply ? "Nothing to delete." : "Dry run only. Re-run with --apply to delete these rows.");
    return;
  }

  await client.query(`DELETE FROM image_fetch_jobs WHERE listing_id = ANY($1::bigint[])`, [listingIds]);
  await client.query(`DELETE FROM contract_violations WHERE listing_id = ANY($1::bigint[])`, [listingIds]);
  await client.query(`DELETE FROM quality_reports WHERE listing_id = ANY($1::bigint[])`, [listingIds]);
  await client.query(`DELETE FROM match_group_members WHERE listing_id = ANY($1::bigint[])`, [listingIds]);
  await client.query(
    `DELETE FROM listing_matches
     WHERE source_listing_id = ANY($1::bigint[])
        OR target_listing_id = ANY($1::bigint[])`,
    [listingIds],
  );
  await client.query(`DELETE FROM listing_images WHERE listing_id = ANY($1::bigint[])`, [listingIds]);
  await client.query(`DELETE FROM normalized_listings WHERE listing_id = ANY($1::bigint[])`, [listingIds]);

  console.log(`Deleted ${listingIds.length} invalid daangn listings.`);
});
