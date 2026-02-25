#!/usr/bin/env node

/**
 * 매물 상태 체크 스크립트
 *
 * KB부동산 매물의 활성/종료 여부를 dtailInfo API로 확인하고,
 * 종료된 매물은 deleted_at을 설정하여 프론트엔드에서 숨깁니다.
 *
 * 사용법:
 *   node scripts/check_listing_status.mjs [--platform kbland] [--batch-size 50] [--delay-ms 200] [--dry-run]
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

const platform = getArg("--platform", "kbland");
const batchSize = Math.max(1, Number(getArg("--batch-size", "50")));
const delayMs = Math.max(100, Number(getArg("--delay-ms", "200")));
const dryRun = hasFlag("--dry-run");
const verbose = hasFlag("--verbose");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── KB부동산 상태 체크 ──

const KB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "application/json",
  Referer: "https://kbland.kr/",
};

async function checkKbListing(externalId) {
  const url = `https://api.kbland.kr/land-property/property/dtailInfo?${encodeURIComponent("매물일련번호")}=${externalId}`;
  const res = await fetch(url, { headers: KB_HEADERS });
  if (!res.ok) return { status: "error", httpStatus: res.status };

  const json = await res.json();
  const code = json?.dataBody?.resultCode;

  if (code === 30210) return { status: "expired" };
  if (json?.dataBody?.data?.dtailInfo) return { status: "active" };
  return { status: "unknown", resultCode: code };
}

// ── 플랫폼별 체커 맵 ──

const CHECKERS = {
  kbland: checkKbListing,
};

// ── 메인 ──

async function main() {
  const checker = CHECKERS[platform];
  if (!checker) {
    console.error(`[status-check] 지원하지 않는 플랫폼: ${platform}`);
    console.error(`[status-check] 가능한 플랫폼: ${Object.keys(CHECKERS).join(", ")}`);
    process.exit(1);
  }

  console.log(`[status-check] 플랫폼: ${platform}`);
  console.log(`[status-check] 배치 크기: ${batchSize}, 딜레이: ${delayMs}ms`);
  if (dryRun) console.log("[status-check] DRY RUN — DB 변경 없음");
  console.log("");

  const startTime = Date.now();

  await withDbClient(async (client) => {
    // 활성 매물 조회
    const { rows } = await client.query(
      `SELECT listing_id, external_id, title
       FROM normalized_listings
       WHERE platform_code = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT $2`,
      [platform, batchSize],
    );

    console.log(`[status-check] 체크 대상: ${rows.length}건\n`);

    if (rows.length === 0) {
      console.log("[status-check] 체크할 매물이 없습니다.");
      return;
    }

    let active = 0;
    let expired = 0;
    let errors = 0;
    const expiredIds = [];

    for (const row of rows) {
      try {
        const result = await checker(row.external_id);

        if (result.status === "expired") {
          expired++;
          expiredIds.push(row.listing_id);
          console.log(`  ✗ ${row.external_id} — 종료 (${row.title})`);
        } else if (result.status === "active") {
          active++;
          if (verbose) console.log(`  ✓ ${row.external_id} — 활성`);
        } else {
          errors++;
          console.log(`  ? ${row.external_id} — ${result.status} (code: ${result.resultCode || result.httpStatus})`);
        }
      } catch (e) {
        errors++;
        console.log(`  ! ${row.external_id} — 오류: ${e.message}`);
      }

      await sleep(delayMs);
    }

    // 종료된 매물 soft-delete
    if (expiredIds.length > 0 && !dryRun) {
      const placeholders = expiredIds.map((_, i) => `$${i + 1}`).join(",");
      const result = await client.query(
        `UPDATE normalized_listings SET deleted_at = NOW() WHERE listing_id IN (${placeholders})`,
        expiredIds,
      );
      console.log(`\n[status-check] DB 업데이트: ${result.rowCount}건 soft-delete 완료`);
    } else if (expiredIds.length > 0 && dryRun) {
      console.log(`\n[status-check] DRY RUN: ${expiredIds.length}건 soft-delete 예정`);
    }

    // 요약
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n=== 상태 체크 결과 ===");
    console.log(`  체크: ${rows.length}건`);
    console.log(`  활성: ${active}건`);
    console.log(`  종료: ${expired}건 (${Math.round((expired / rows.length) * 100)}%)`);
    console.log(`  오류: ${errors}건`);
    console.log(`  소요: ${elapsed}s`);

    // 남은 미체크 매물 수
    const remaining = await client.query(
      `SELECT COUNT(*) as cnt FROM normalized_listings WHERE platform_code = $1 AND deleted_at IS NULL`,
      [platform],
    );
    const remainingCount = Number(remaining.rows[0].cnt);
    console.log(`  남은 활성 매물: ${remainingCount}건`);
  });
}

main().catch((e) => {
  console.error(`[status-check] Fatal: ${e.message}`);
  process.exit(1);
});
