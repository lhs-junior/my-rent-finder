#!/usr/bin/env node

/**
 * 다방 매물 jibun_address + 정확 좌표 보강 스크립트
 *
 * /api/v5/room/{external_id}/near 를 호출하여
 *   - normalized_listings.jibun_address (예: "공릉동 683-20")
 *   - normalized_listings.lat / lng (정확한 좌표, randomLocation 대체)
 * 를 채웁니다.
 *
 * 다방 anti-bot은 csrf + d-api-version 같은 magic 헤더로 우회 가능.
 * Playwright 없이 pure Node fetch로 ~500ms/건.
 *
 * 사용법:
 *   node scripts/enrich_dabang_jibun.mjs                     # dry-run (기본)
 *   node scripts/enrich_dabang_jibun.mjs --apply             # 실제 DB 업데이트
 *   node scripts/enrich_dabang_jibun.mjs --apply --limit=200
 *   node scripts/enrich_dabang_jibun.mjs --verbose
 */

import { withDbClient } from "./lib/db_client.mjs";
import { extractJibunKey, fetchDabangNear } from "./adapters/dabang_listings_adapter.mjs";

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

const NEAR_DELAY_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[enrich-jibun] ${msg}`);
const vlog = (msg) => { if (verbose) process.stderr.write(`[enrich-jibun]   ${msg}\n`); };

async function main() {
  log(`모드: ${applyMode ? "APPLY" : "DRY-RUN"}${limit !== null ? ` (최대 ${limit}건)` : ""}`);

  const rows = await withDbClient(async (client) => {
    const sql = `
      SELECT listing_id, external_id, lat, lng
      FROM normalized_listings
      WHERE platform_code = 'dabang'
        AND deleted_at IS NULL
        AND (jibun_address IS NULL OR jibun_address = '')
      ORDER BY listed_at DESC NULLS LAST, created_at DESC
      ${limit !== null ? `LIMIT ${limit}` : ""}
    `;
    return (await client.query(sql)).rows;
  });

  log(`대상 매물: ${rows.length}건 (jibun_address NULL)`);
  if (rows.length === 0) return;

  let jibunFilled = 0;
  let coordFixed = 0;
  let failCount = 0;
  let noJibunCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const { listing_id, external_id, lat: oldLat, lng: oldLng } = rows[i];
    vlog(`[${i + 1}/${rows.length}] ${external_id}`);

    let near = null;
    try {
      near = await fetchDabangNear(external_id);
    } catch (err) {
      vlog(`  near 오류: ${err.message}`);
      failCount++;
      await sleep(NEAR_DELAY_MS);
      continue;
    }

    if (!near) {
      vlog(`  near 응답 없음`);
      failCount++;
      await sleep(NEAR_DELAY_MS);
      continue;
    }

    const rawAddr = typeof near.address === "string" ? near.address.trim() : null;
    const jibun = rawAddr ? extractJibunKey(rawAddr) : null;
    const newLat = Number(near?.location?.lat);
    const newLng = Number(near?.location?.lng);
    const validNewCoord =
      Number.isFinite(newLat) && Number.isFinite(newLng) && newLat !== 0 && newLng !== 0;

    if (!jibun) {
      vlog(`  jibun 추출 실패 — addr=${JSON.stringify(rawAddr)}`);
      noJibunCount++;
      await sleep(NEAR_DELAY_MS);
      continue;
    }

    vlog(`  jibun=${jibun}${validNewCoord ? `  lat/lng=${newLat},${newLng}` : ""}`);

    if (applyMode) {
      try {
        await withDbClient(async (client) => {
          if (validNewCoord) {
            await client.query(
              `UPDATE normalized_listings
               SET jibun_address = $1, lat = $2, lng = $3, updated_at = NOW()
               WHERE listing_id = $4`,
              [jibun, newLat, newLng, listing_id],
            );
          } else {
            await client.query(
              `UPDATE normalized_listings
               SET jibun_address = $1, updated_at = NOW()
               WHERE listing_id = $2`,
              [jibun, listing_id],
            );
          }
        });
        jibunFilled++;
        if (validNewCoord && (oldLat !== newLat || oldLng !== newLng)) coordFixed++;
      } catch (err) {
        vlog(`  DB 오류: ${err.message}`);
        failCount++;
      }
    } else {
      jibunFilled++;
      if (validNewCoord && (oldLat !== newLat || oldLng !== newLng)) coordFixed++;
    }

    await sleep(NEAR_DELAY_MS);
  }

  log("");
  log(
    `완료: jibun ${jibunFilled}건${applyMode ? " 업데이트" : " (예정)"}, 좌표 ${coordFixed}건 정정, 추출불가 ${noJibunCount}건, 실패 ${failCount}건`,
  );
  if (!applyMode) {
    log("(dry-run 모드 — DB 변경 없음. 실제 적용은 --apply 플래그 사용)");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[enrich-jibun] Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
