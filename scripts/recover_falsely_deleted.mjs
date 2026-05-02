#!/usr/bin/env node

// 최근 deleted_at 마킹된 매물을 다시 status 체크하여, 실제로 살아있으면 deleted_at=NULL 복구.
// check_listing_status가 일시적 API 오류/anti-bot으로 false-positive 마킹한 케이스 복구용.
//
// 사용법:
//   node scripts/recover_falsely_deleted.mjs                       # 전 플랫폼, 24시간 이내 삭제분
//   node scripts/recover_falsely_deleted.mjs --platform=dabang     # 특정 플랫폼만
//   node scripts/recover_falsely_deleted.mjs --hours=48            # 더 긴 윈도우
//   node scripts/recover_falsely_deleted.mjs --limit=200           # 플랫폼당 최대 N건
//   node scripts/recover_falsely_deleted.mjs --dry-run             # 변경 없이 미리보기

import { withDbClient } from "./lib/db_client.mjs";
import { fetchDabangDetail } from "./adapters/dabang_listings_adapter.mjs";
import { fetchZigbangV3ItemDetail } from "./zigbang_auto_collector.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
function getArg(name, def) {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : def;
}
const platformFilter = getArg("platform", null);
const hours = parseInt(getArg("hours", "24"), 10);
const limit = parseInt(getArg("limit", "300"), 10);

// platform → async (externalId) → boolean (true if alive)
const checkers = {
  async dabang(externalId) {
    try {
      const detail = await fetchDabangDetail(externalId, { timeoutMs: 8000 });
      if (detail.ok && detail.room && detail.room.is_contract === false) return true;
      return false;
    } catch {
      return null; // unknown
    }
  },
  async zigbang(externalId) {
    try {
      const detail = await fetchZigbangV3ItemDetail(externalId);
      // detail이 객체로 돌아오면 살아있음. null이면 만료/실패.
      return detail && typeof detail === "object" ? true : false;
    } catch {
      return null;
    }
  },
  // 나머지 플랫폼은 status checker가 분리되어 있어 일단 dabang/zigbang부터
};

async function recoverPlatform(client, platform, items) {
  const checker = checkers[platform];
  if (!checker) {
    console.log(`[recover] ${platform}: 체커 미구현 — 스킵`);
    return { recovered: 0, kept: 0, unknown: 0 };
  }
  let recovered = 0;
  let kept = 0;
  let unknown = 0;
  let i = 0;
  for (const row of items) {
    i++;
    const alive = await checker(row.external_id);
    if (alive === true) {
      if (!dryRun) {
        await client.query(
          `UPDATE normalized_listings SET deleted_at = NULL, last_confirmed_at = NOW(), updated_at = NOW() WHERE listing_id = $1`,
          [row.listing_id],
        );
      }
      recovered++;
      if (recovered <= 10 || recovered % 25 === 0) {
        console.log(`[recover] ${platform} ✓ ${row.external_id} (${i}/${items.length}) ${dryRun ? "(dry-run)" : "복구"}`);
      }
    } else if (alive === false) {
      kept++;
    } else {
      unknown++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { recovered, kept, unknown };
}

await withDbClient(async (client) => {
  const platforms = platformFilter ? [platformFilter] : Object.keys(checkers);
  console.log(`[recover] 대상 플랫폼: ${platforms.join(", ")}`);
  console.log(`[recover] 윈도우: 최근 ${hours}시간, 플랫폼당 최대 ${limit}건, dry-run=${dryRun}`);

  const totals = { recovered: 0, kept: 0, unknown: 0 };
  for (const platform of platforms) {
    const { rows } = await client.query(
      `SELECT listing_id, external_id, deleted_at FROM normalized_listings
       WHERE platform_code = $1 AND deleted_at IS NOT NULL
         AND deleted_at > NOW() - ($2::int || ' hours')::interval
       ORDER BY deleted_at DESC LIMIT $3`,
      [platform, hours, limit],
    );
    console.log(`\n[recover] ─── ${platform}: ${rows.length}건 검사 ───`);
    if (rows.length === 0) continue;
    const r = await recoverPlatform(client, platform, rows);
    console.log(`[recover] ${platform} 결과: 복구 ${r.recovered} / 진짜만료 ${r.kept} / 모름 ${r.unknown}`);
    totals.recovered += r.recovered;
    totals.kept += r.kept;
    totals.unknown += r.unknown;
  }
  console.log(`\n[recover] ✅ 전체: 복구 ${totals.recovered} / 진짜만료 ${totals.kept} / 모름 ${totals.unknown} ${dryRun ? "(dry-run)" : ""}`);
});
process.exit(0);
