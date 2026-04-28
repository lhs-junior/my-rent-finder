#!/usr/bin/env node

/**
 * 다방 매물 설명 보강 스크립트
 *
 * description_text가 null인 dabang 매물에 상세 API를 호출해서
 * room.memo → description_text를 DB에 업데이트합니다.
 *
 * 사용법:
 *   node scripts/enrich_dabang_details.mjs           # dry-run (변경 없음)
 *   node scripts/enrich_dabang_details.mjs --apply   # 실제 DB 업데이트
 *   node scripts/enrich_dabang_details.mjs --apply --limit=50
 */

import { withDbClient } from "./lib/db_client.mjs";

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

const COMMON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DETAIL_DELAY_MS = 550;
const MIN_MEMO_LEN = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[enrich-dabang] ${msg}`);
const vlog = (msg) => { if (verbose) process.stderr.write(`[enrich-dabang]   ${msg}\n`); };

async function fetchDabangDetail(roomId) {
  const url =
    `https://www.dabangapp.com/api/3/new-room/detail?room_id=${encodeURIComponent(roomId)}&api_version=3.0.1&call_type=web&version=1`;
  const res = await fetch(url, {
    headers: {
      "accept": "application/json, text/plain, */*",
      "user-agent": COMMON_UA,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  return json?.room ?? null;
}

async function main() {
  log(`모드: ${applyMode ? "APPLY" : "DRY-RUN"}${limit !== null ? ` (최대 ${limit}건)` : ""}`);

  const rows = await withDbClient(async (client) => {
    const sql = `
      SELECT listing_id, external_id
      FROM normalized_listings
      WHERE platform_code = 'dabang'
        AND deleted_at IS NULL
        AND description_text IS NULL
      ORDER BY listed_at DESC
      ${limit !== null ? `LIMIT ${limit}` : ""}
    `;
    return (await client.query(sql)).rows;
  });

  log(`대상 매물: ${rows.length}건 (description_text NULL)`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const { listing_id, external_id } = rows[i];
    vlog(`[${i + 1}/${rows.length}] ${external_id} 조회 중...`);

    let room;
    try {
      room = await fetchDabangDetail(external_id);
    } catch (err) {
      vlog(`  오류: ${err.message}`);
      failCount++;
      await sleep(DETAIL_DELAY_MS);
      continue;
    }

    if (!room) {
      vlog(`  스킵 (room 없음 — 매물 종료 가능성)`);
      skipCount++;
      await sleep(DETAIL_DELAY_MS);
      continue;
    }

    const rawMemo = typeof room.memo === "string" ? room.memo.trim() : null;
    const descriptionText =
      rawMemo && rawMemo.length >= MIN_MEMO_LEN && !/^\d+[\s/]*\d*$/.test(rawMemo)
        ? rawMemo
        : null;

    vlog(`  memo=${JSON.stringify(descriptionText?.slice(0, 60))}`);

    if (!descriptionText) {
      vlog(`  스킵 (유효한 memo 없음)`);
      skipCount++;
      await sleep(DETAIL_DELAY_MS);
      continue;
    }

    if (applyMode) {
      try {
        await withDbClient(async (client) => {
          await client.query(
            `UPDATE normalized_listings
             SET description_text = $1, updated_at = NOW()
             WHERE listing_id = $2`,
            [descriptionText, listing_id],
          );
        });
        successCount++;
      } catch (err) {
        vlog(`  DB 업데이트 오류: ${err.message}`);
        failCount++;
      }
    } else {
      successCount++;
    }

    await sleep(DETAIL_DELAY_MS);
  }

  log("");
  log(`완료: ${successCount}건 업데이트, ${failCount}건 실패, ${skipCount}건 스킵`);
  if (!applyMode) {
    log("(dry-run 모드 — DB 변경 없음. 실제 적용은 --apply 플래그 사용)");
  }
}

main().catch((err) => {
  console.error(`[enrich-dabang] Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
