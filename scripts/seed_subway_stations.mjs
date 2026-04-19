#!/usr/bin/env node
// data/seoul_subway_stations.json → subway_stations 테이블 시드

import fs from "node:fs";
import path from "node:path";
import { withDbClient } from "./lib/db_client.mjs";

const JSON_PATH = path.resolve("data/seoul_subway_stations.json");

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`stations file not found: ${JSON_PATH}`);
    process.exit(1);
  }
  const stations = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  if (!Array.isArray(stations) || !stations.length) {
    console.error("no stations to seed");
    process.exit(1);
  }

  const result = await withDbClient(async (client) => {
    let inserted = 0;
    let updated = 0;
    for (const s of stations) {
      const lines = Array.isArray(s.lines) ? s.lines : (s.line ? [s.line] : []);
      const r = await client.query(
        `INSERT INTO subway_stations (name, lines, lat, lng, address)
         VALUES ($1, $2::jsonb, $3, $4, $5)
         ON CONFLICT (name, lat, lng) DO UPDATE SET
           lines = EXCLUDED.lines,
           address = COALESCE(EXCLUDED.address, subway_stations.address)
         RETURNING (xmax = 0) AS inserted`,
        [s.name, JSON.stringify(lines), s.lat, s.lng, s.address || null],
      );
      if (r.rows[0]?.inserted) inserted += 1;
      else updated += 1;
    }
    const count = await client.query("SELECT COUNT(*) AS n FROM subway_stations");
    return { inserted, updated, total: Number(count.rows[0].n) };
  });

  console.log(`seed 완료: inserted=${result.inserted} updated=${result.updated} total=${result.total}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
