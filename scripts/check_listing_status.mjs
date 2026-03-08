#!/usr/bin/env node

/**
 * 매물 상태 체크 스크립트
 *
 * 각 플랫폼 매물의 활성/종료 여부를 API로 확인하고,
 * 종료된 매물은 deleted_at을 설정하여 프론트엔드에서 숨깁니다.
 *
 * 사용법:
 *   node scripts/check_listing_status.mjs [--platform kbland|zigbang|dabang|peterpanz|naver|daangn|all] [--batch-size 50] [--delay-ms 200] [--dry-run]
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

const platform = getArg("--platform", "all");
const batchSize = Math.max(1, Number(getArg("--batch-size", "999")));
const delayMs = Math.max(100, Number(getArg("--delay-ms", "200")));
const dryRun = hasFlag("--dry-run");
const verbose = hasFlag("--verbose");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMMON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── KB부동산 상태 체크 ──

const KB_HEADERS = {
  "User-Agent": COMMON_UA,
  Accept: "application/json",
  Referer: "https://kbland.kr/",
};

async function checkKbListing(externalId) {
  const url = `https://api.kbland.kr/land-property/property/dtailInfo?${encodeURIComponent("매물일련번호")}=${externalId}`;
  const res = await fetch(url, { headers: KB_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return { status: "error", httpStatus: res.status };

  const json = await res.json();
  const code = json?.dataBody?.resultCode;

  if (code === 30210) return { status: "expired" };
  if (json?.dataBody?.data?.dtailInfo) return { status: "active" };
  return { status: "unknown", resultCode: code };
}

// ── 직방 상태 체크 ──

async function checkZigbangListing(externalId) {
  const numId = Number(externalId);
  if (!Number.isFinite(numId) || numId <= 0) return { status: "expired", resultCode: "invalid_id" };

  const res = await fetch("https://apis.zigbang.com/house/property/v1/items/list", {
    method: "POST",
    headers: { "User-Agent": COMMON_UA, "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "zigbang", item_ids: [numId] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { status: "error", httpStatus: res.status };

  const body = await res.json();
  const items = body?.items ?? [];
  if (items.length === 0) return { status: "expired", resultCode: "not_found" };

  const item = items[0];
  if (item?.status === true || item?.status === "open") return { status: "active" };
  return { status: "expired", resultCode: "closed" };
}

// ── 다방 상태 체크 ──

async function checkDabangListing(externalId) {
  // API requires browser session — use public room page instead
  const url = `https://www.dabangapp.com/room/${externalId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      "Accept": "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status === 410) return { status: "expired", resultCode: "gone" };
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    // Redirect to main page or search = listing removed
    if (!location.includes(`/room/${externalId}`)) return { status: "expired", resultCode: "redirect" };
    return { status: "active" };
  }
  if (res.status === 200) {
    const html = await res.text();
    if (html.includes("해당 방을 찾을 수 없") || html.includes("삭제된 방") || html.includes("존재하지 않는")) {
      return { status: "expired", resultCode: "page_expired" };
    }
    return { status: "active" };
  }
  return { status: "error", httpStatus: res.status };
}

// ── 피터팬 상태 체크 ──

async function checkPeterpanzListing(externalId) {
  // Try fetching the detail page URL — returns 200 for active, 404/redirect for expired
  const url = `https://www.peterpanz.com/house/${externalId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      "Accept": "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });

  // 200 = page exists = active
  if (res.status === 200) {
    const html = await res.text();
    // Check if page contains actual listing content or a "not found" message
    if (html.includes("해당 매물을 찾을 수 없") || html.includes("삭제된 매물") || html.includes("존재하지 않는")) {
      return { status: "expired", resultCode: "deleted_page" };
    }
    return { status: "active" };
  }
  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  // 301/302 redirect often means listing was removed
  if (res.status >= 300 && res.status < 400) return { status: "expired", resultCode: "redirect" };
  return { status: "error", httpStatus: res.status };
}

// ── 네이버 부동산 상태 체크 ──

async function checkNaverListing(externalId) {
  // API is heavily rate-limited (429). Use the public article page instead.
  const url = `https://fin.land.naver.com/articles/${externalId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    // Redirect to search/main = listing gone
    if (location.includes("/articles/") && location.includes(externalId)) return { status: "active" };
    return { status: "expired", resultCode: "redirect" };
  }
  if (res.status === 200) {
    const html = await res.text();
    // Check for expired/deleted indicators
    if (html.includes("삭제된 매물") || html.includes("존재하지 않는 매물") || html.includes("거래가 완료")) {
      return { status: "expired", resultCode: "page_expired" };
    }
    // Check for active listing indicators
    if (html.includes("articleDetail") || html.includes("매물번호") || html.includes("articleNo")) {
      return { status: "active" };
    }
    // If we got a page without clear indicators, treat as active
    if (html.length > 5000) return { status: "active" };
    return { status: "expired", resultCode: "empty_page" };
  }
  return { status: "error", httpStatus: res.status };
}

// ── 당근 부동산 상태 체크 ──

async function checkDaangnListing(externalId, _row) {
  // Use source_url from DB if available, otherwise construct URL
  const sourceUrl = _row?.source_url;
  const url = sourceUrl || `https://www.daangn.com/kr/realty/${externalId}`;

  const res = await fetch(url, {
    headers: { "User-Agent": COMMON_UA, "Accept": "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status >= 300 && res.status < 400) {
    // Check if redirect target is a "not found" or homepage
    const location = res.headers.get("location") || "";
    if (location.includes("/realty") && !location.includes("error") && !location.includes("not-found")) {
      return { status: "active" };
    }
    return { status: "expired", resultCode: "redirect" };
  }
  if (res.status === 200) {
    const html = await res.text();
    if (html.includes("RealEstateListing") || html.includes("realty_post")) {
      return { status: "active" };
    }
    if (html.includes("삭제") || html.includes("존재하지 않") || html.includes("만료")) {
      return { status: "expired", resultCode: "page_expired" };
    }
    // If we got a page but can't determine, assume active
    return { status: "active" };
  }
  return { status: "error", httpStatus: res.status };
}

// ── 플랫폼별 체커 맵 ──

const CHECKERS = {
  kbland: checkKbListing,
  zigbang: checkZigbangListing,
  dabang: checkDabangListing,
  peterpanz: checkPeterpanzListing,
  naver: checkNaverListing,
  daangn: checkDaangnListing,
};

// ── 단일 플랫폼 체크 ──

async function checkPlatform(platformCode, client) {
  const checker = CHECKERS[platformCode];
  if (!checker) {
    console.log(`[status-check] 지원하지 않는 플랫폼: ${platformCode}, 건너뜀`);
    return null;
  }

  console.log(`\n[status-check] ── ${platformCode} ──`);

  const { rows } = await client.query(
    `SELECT listing_id, external_id, title, source_url
     FROM normalized_listings
     WHERE platform_code = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT $2`,
    [platformCode, batchSize],
  );

  console.log(`[status-check] 체크 대상: ${rows.length}건`);

  if (rows.length === 0) {
    console.log("[status-check] 체크할 매물이 없습니다.");
    return { platform: platformCode, checked: 0, active: 0, expired: 0, errors: 0 };
  }

  let active = 0;
  let expired = 0;
  let errors = 0;
  const expiredIds = [];

  for (const row of rows) {
    try {
      const result = await checker(row.external_id, row);

      if (result.status === "expired") {
        expired++;
        expiredIds.push(row.listing_id);
        console.log(`  ✗ ${row.external_id} — 종료 (${row.title || "제목없음"})`);
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
    console.log(`[status-check] DB 업데이트: ${result.rowCount}건 soft-delete 완료`);
  } else if (expiredIds.length > 0 && dryRun) {
    console.log(`[status-check] DRY RUN: ${expiredIds.length}건 soft-delete 예정`);
  }

  return { platform: platformCode, checked: rows.length, active, expired, errors };
}

// ── 메인 ──

async function main() {
  const platformList = platform === "all"
    ? Object.keys(CHECKERS)
    : [platform];

  // Validate platforms
  for (const p of platformList) {
    if (!CHECKERS[p]) {
      console.error(`[status-check] 지원하지 않는 플랫폼: ${p}`);
      console.error(`[status-check] 가능한 플랫폼: ${Object.keys(CHECKERS).join(", ")}, all`);
      process.exit(1);
    }
  }

  console.log(`[status-check] 대상 플랫폼: ${platformList.join(", ")}`);
  console.log(`[status-check] 배치 크기: ${batchSize}, 딜레이: ${delayMs}ms`);
  if (dryRun) console.log("[status-check] DRY RUN — DB 변경 없음");

  const startTime = Date.now();
  const results = [];

  await withDbClient(async (client) => {
    for (const p of platformList) {
      const result = await checkPlatform(p, client);
      if (result) results.push(result);
    }
  });

  // 전체 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n=== 전체 상태 체크 결과 ===");
  console.log(`  소요시간: ${elapsed}s\n`);

  let totalChecked = 0, totalActive = 0, totalExpired = 0, totalErrors = 0;
  for (const r of results) {
    console.log(`  [${r.platform}] 체크: ${r.checked} | 활성: ${r.active} | 종료: ${r.expired} | 오류: ${r.errors}`);
    totalChecked += r.checked;
    totalActive += r.active;
    totalExpired += r.expired;
    totalErrors += r.errors;
  }
  console.log(`  ────────────────────────────────────`);
  console.log(`  [합계]  체크: ${totalChecked} | 활성: ${totalActive} | 종료: ${totalExpired} | 오류: ${totalErrors}`);
}

main().catch((e) => {
  console.error(`[status-check] Fatal: ${e.message}`);
  process.exit(1);
});
