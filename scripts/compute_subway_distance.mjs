#!/usr/bin/env node
// 전 매물 × 지하철역을 매칭해서 nearest_subway_* 컬럼을 채운다.
// 사용:
//   node --env-file=.env scripts/compute_subway_distance.mjs            # 누락분만 (null)
//   node --env-file=.env scripts/compute_subway_distance.mjs --all      # 전체 재계산
//   node --env-file=.env scripts/compute_subway_distance.mjs --listing-id=1234

import { withDbClient } from "./lib/db_client.mjs";
import { findNearestStation } from "./lib/subway_distance.mjs";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getArg = (name, fallback = null) => {
  const prefix = `${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const recomputeAll = hasFlag("--all");
const onlyListingId = getArg("--listing-id", null);

async function main() {
  const started = Date.now();
  const result = await withDbClient(async (client) => {
    const stationsRes = await client.query(
      "SELECT name, lines, lat, lng FROM subway_stations",
    );
    const stations = stationsRes.rows.map((r) => ({
      name: r.name,
      lines: Array.isArray(r.lines) ? r.lines : (typeof r.lines === "string" ? JSON.parse(r.lines) : []),
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
    if (!stations.length) {
      console.error("subway_stations 비어있음 → seed_subway_stations 먼저 실행");
      process.exit(1);
    }

    const where = onlyListingId
      ? "WHERE listing_id = $1"
      : recomputeAll
        ? "WHERE lat IS NOT NULL AND lng IS NOT NULL AND deleted_at IS NULL"
        : "WHERE lat IS NOT NULL AND lng IS NOT NULL AND deleted_at IS NULL AND subway_distance_m IS NULL";
    const params = onlyListingId ? [Number(onlyListingId)] : [];

    const listings = await client.query(
      `SELECT listing_id, lat, lng FROM normalized_listings ${where}`,
      params,
    );

    let updated = 0;
    let skipped = 0;
    const batch = [];
    const BATCH_SIZE = 200;

    const flush = async () => {
      if (!batch.length) return;
      const values = [];
      const placeholders = batch.map((row, i) => {
        const base = i * 5;
        values.push(row.listing_id, row.name, row.line, row.walk_m, row.walk_min);
        return `($${base + 1}::bigint, $${base + 2}::text, $${base + 3}::text, $${base + 4}::integer, $${base + 5}::smallint)`;
      });
      await client.query(
        `UPDATE normalized_listings nl SET
            nearest_subway_station = v.name,
            nearest_subway_line = v.line,
            subway_distance_m = v.walk_m,
            subway_walk_min = v.walk_min,
            updated_at = NOW()
         FROM (VALUES ${placeholders.join(",")}) AS v(listing_id, name, line, walk_m, walk_min)
         WHERE nl.listing_id = v.listing_id`,
        values,
      );
      updated += batch.length;
      batch.length = 0;
    };

    for (const row of listings.rows) {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped += 1;
        continue;
      }
      const n = findNearestStation(lat, lng, stations);
      if (!n) { skipped += 1; continue; }
      batch.push({
        listing_id: row.listing_id,
        name: n.station.name,
        line: Array.isArray(n.station.lines) && n.station.lines.length > 0 ? n.station.lines[0] : null,
        walk_m: n.walk_m,
        walk_min: n.walk_min,
      });
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    return { total: listings.rows.length, updated, skipped };
  });

  console.log(`지하철 거리 계산 완료: 대상=${result.total} 업데이트=${result.updated} 스킵=${result.skipped} ${Date.now() - started}ms`);
}

main().catch((e) => { console.error(e); process.exit(1); });
