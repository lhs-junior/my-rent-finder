#!/usr/bin/env node

/**
 * 당근 매물 features JSONB 백필 — raw_listings.payload_json에서 추출 (네트워크 호출 없음).
 *
 * 사용:
 *   node scripts/enrich_daangn_features.mjs              # dry-run
 *   node scripts/enrich_daangn_features.mjs --apply
 */

import { withDbClient } from "./lib/db_client.mjs";
import { DaangnListingAdapter } from "./adapters/daangn_listings_adapter.mjs";

const args = process.argv.slice(2);
function getArg(name, fallback = null) {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return fallback;
  if (args[idx] === name) return args[idx + 1] ?? fallback;
  return args[idx].split("=").slice(1).join("=") ?? fallback;
}
const hasFlag = (name) => args.includes(name);

const applyMode = hasFlag("--apply");
const verbose = hasFlag("--verbose");
const limitArg = getArg("--limit", null);
const limit = limitArg !== null ? Math.max(1, Math.floor(Number(limitArg))) : null;

const log = (m) => console.log(`[enrich-daangn-features] ${m}`);
const vlog = (m) => { if (verbose) process.stderr.write(`[enrich-daangn-features]   ${m}\n`); };

const adapter = new DaangnListingAdapter();

function extractFeatures(payload) {
  if (!payload || typeof payload !== "object") return null;
  const items = adapter.normalizeFromRawRecord({
    platform_code: "daangn",
    payload_json: payload,
  });
  return items[0]?.features ?? null;
}

async function main() {
  log(`모드: ${applyMode ? "APPLY" : "DRY-RUN"}${limit !== null ? ` (최대 ${limit}건)` : ""}`);

  const rows = await withDbClient(async (client) => {
    const sql = `
      SELECT nl.listing_id, nl.external_id, rl.payload_json
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE nl.platform_code = 'daangn'
        AND nl.deleted_at IS NULL
        AND nl.features IS NULL
      ORDER BY nl.listed_at DESC NULLS LAST, nl.created_at DESC
      ${limit !== null ? `LIMIT ${limit}` : ""}
    `;
    return (await client.query(sql)).rows;
  });

  log(`대상 매물: ${rows.length}건 (features NULL)`);
  if (rows.length === 0) return;

  let filled = 0, empty = 0, failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const { listing_id, external_id, payload_json } = rows[i];
    let features;
    try { features = extractFeatures(payload_json); }
    catch (err) { vlog(`[${i + 1}] ${external_id} 파싱 오류: ${err.message}`); failed++; continue; }

    if (!features) { vlog(`[${i + 1}] ${external_id} features 없음`); empty++; continue; }
    vlog(`[${i + 1}] ${external_id} keys=[${Object.keys(features).join(",")}]`);

    if (applyMode) {
      try {
        await withDbClient((client) =>
          client.query(
            `UPDATE normalized_listings SET features = $1::jsonb, updated_at = NOW() WHERE listing_id = $2`,
            [JSON.stringify(features), listing_id],
          ),
        );
        filled++;
      } catch (err) { vlog(`[${i + 1}] DB 오류: ${err.message}`); failed++; }
    } else {
      filled++;
    }
  }

  log("");
  log(`완료: ${filled}건 features 채움${applyMode ? "" : " (예정)"}, ${empty}건 데이터 없음, ${failed}건 실패`);
  if (!applyMode) log("(dry-run 모드. 실제 적용은 --apply)");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`[enrich-daangn-features] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
