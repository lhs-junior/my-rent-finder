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

import fs from "node:fs";
import { withDbClient } from "./lib/db_client.mjs";
import { TARGET_DISTRICTS } from "./lib/target_districts.mjs";
import { fetchDabangDetail } from "./adapters/dabang_listings_adapter.mjs";

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
const MAX_CONSECUTIVE_TIMEOUTS = 8; // 연속 타임아웃 8회 → 해당 플랫폼 중단
const NAVER_DELAY_MS = 500; // 네이버는 rate limit 회피를 위해 더 긴 딜레이

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
  const res = await fetch(url, { headers: KB_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return { status: "error", httpStatus: res.status };

  const json = await res.json();
  const code = json?.dataBody?.resultCode;

  if (code === 30210) return { status: "expired", resultCode: "deleted" };
  const info = json?.dataBody?.data?.dtailInfo;
  if (info) {
    // 매물상태구분 "4" = 노출종료/기간만료 (API returns string, not number)
    if (
      String(info["매물상태구분"]) === "4" ||
      /노출종료|거래완료|삭제|기간만료/.test(info["매물상태변경사유"] || "")
    ) {
      return { status: "expired", resultCode: "exposure_ended" };
    }
    return { status: "active" };
  }
  return { status: "unknown", resultCode: code };
}

// ── 직방 상태 체크 ──
// API는 item_ids 배열을 받음. 검증 결과 10건/req 안전, 20건+에서 400(BadRequestException).
// batch 처리로 단건 직렬 호출 대비 ~10x throughput 향상.

const ZIGBANG_BATCH_SIZE = 10;

async function fetchZigbangBatch(numIds) {
  const res = await fetch("https://apis.zigbang.com/house/property/v1/items/list", {
    method: "POST",
    headers: { "User-Agent": COMMON_UA, "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "zigbang", item_ids: numIds }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = new Error(`zigbang http ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  const body = await res.json();
  return Array.isArray(body?.items) ? body.items : [];
}

function classifyZigbangItem(item) {
  if (!item) return { status: "expired", resultCode: "not_found" };
  if (item.status === true || item.status === "open") return { status: "active" };
  return { status: "expired", resultCode: "closed" };
}

async function checkZigbangListing(externalId) {
  const numId = Number(externalId);
  if (!Number.isFinite(numId) || numId <= 0) return { status: "expired", resultCode: "invalid_id" };
  try {
    const items = await fetchZigbangBatch([numId]);
    return classifyZigbangItem(items[0]);
  } catch (e) {
    return { status: "error", httpStatus: e.httpStatus };
  }
}

// ── 다방 상태 체크 ──

function isActiveDabangRedirect(location, externalId) {
  const id = String(externalId || "");
  if (!id || !location) return false;
  try {
    const url = new URL(location, "https://www.dabangapp.com");
    if (url.pathname.includes(`/room/${id}`)) return true;
    if (url.searchParams.get("detail_id") === id) return true;
    if (url.searchParams.get("room_id") === id) return true;
    return false;
  } catch {
    return location.includes(`/room/${id}`) || location.includes(`detail_id=${id}`);
  }
}

async function checkDabangListing(externalId) {
  // 1차: detail API로 정확하게 판정 (magic 헤더로 anti-bot 우회 가능).
  // 200 + room.is_contract=false → active, room.is_contract=true → 계약완료(expired).
  // 400/404 → 매물 없음(expired). 그 외/실패 시 HTML fallback.
  try {
    const detail = await fetchDabangDetail(externalId, { timeoutMs: 6000 });
    if (detail.ok && detail.room) {
      if (detail.room.is_contract === true) {
        return { status: "expired", resultCode: "contracted" };
      }
      return { status: "active" };
    }
    if (detail.status === 400 || detail.status === 404 || detail.status === 410) {
      return { status: "expired", resultCode: `api_${detail.status}` };
    }
    // 그 외 응답 — HTML fallback으로
  } catch {
    // detail API 호출 실패 — HTML fallback으로
  }

  // 2차: HTML 페이지 redirect/문구 검사 (fallback).
  const url = `https://www.dabangapp.com/room/${externalId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      Accept: "text/html",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status === 410) return { status: "expired", resultCode: "gone" };
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (isActiveDabangRedirect(location, externalId)) return { status: "active" };
    return { status: "expired", resultCode: "redirect" };
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
// 검증된 응답 패턴 (2026-04-29):
//   활성: 200 + 본문 ~280K~310K
//   만료: 404, 또는 200 + ~39K + "존재하지 않는"/"매물을 찾을 수 없"
// 길이 + 마커 이중 판정으로 한국어 메시지 변경에도 robust.

const PETERPANZ_ACTIVE_MIN_LEN = 60000;

async function checkPeterpanzListing(externalId) {
  const url = `https://www.peterpanz.com/house/${externalId}`;
  const res = await fetch(url, {
    headers: { "User-Agent": COMMON_UA, Accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 200) {
    const html = await res.text();
    if (
      html.length < PETERPANZ_ACTIVE_MIN_LEN ||
      html.includes("해당 매물을 찾을 수 없") ||
      html.includes("삭제된 매물") ||
      html.includes("존재하지 않는")
    ) {
      return { status: "expired", resultCode: "deleted_page" };
    }
    return { status: "active" };
  }
  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status >= 300 && res.status < 400) return { status: "expired", resultCode: "redirect" };
  return { status: "error", httpStatus: res.status };
}

// ── 네이버 부동산 상태 체크 ──
// fin.land.naver.com/articles/{id} → redirect:follow 후 SSR 결과로 판별
// 활성: HTTP 200 + 본문 ~127k (매물 상세 SSR 성공)
// 만료: HTTP 500 + 본문 ~43k (SSR이 매물 없음으로 실패)
// 검증: 가짜 ID, 확인된 만료 ID → 모두 500 반환 / 활성 13건 → 모두 200 반환 (2025-04-21)

const NAVER_SESSION_PATH = `${process.env.HOME}/.naver-realestate-session.json`;
let _naverCookieHeader = null;

function getNaverCookieHeader() {
  if (_naverCookieHeader !== null) return _naverCookieHeader;
  try {
    if (fs.existsSync(NAVER_SESSION_PATH)) {
      const raw = JSON.parse(fs.readFileSync(NAVER_SESSION_PATH, "utf8"));
      const cookies = (raw?.cookies ?? [])
        .filter((c) => c.domain?.includes("naver"))
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      _naverCookieHeader = cookies || "";
    } else {
      _naverCookieHeader = "";
    }
  } catch {
    _naverCookieHeader = "";
  }
  return _naverCookieHeader;
}

async function checkNaverListing(externalId) {
  const url = `https://fin.land.naver.com/articles/${externalId}`;
  const cookieHeader = getNaverCookieHeader();
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://fin.land.naver.com/",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });

  // SSR이 매물을 찾지 못하면 500 반환 (검증된 패턴)
  if (res.status === 500) return { status: "expired", resultCode: "ssr_not_found" };
  if (res.status === 404) return { status: "expired", resultCode: "not_found" };
  if (res.status === 429) return { status: "error", httpStatus: 429 };

  if (res.status === 200) {
    const html = await res.text();
    // 짧은 응답(~43k)은 SSR 에러 페이지 = 만료
    if (html.length < 60000) return { status: "expired", resultCode: "short_page" };
    return { status: "active" };
  }

  return { status: "error", httpStatus: res.status };
}

// ── 당근 부동산 상태 체크 ──

const DAANGN_GRAPHQL_URL = "https://realty.kr.karrotmarket.com/graphql";
const DAANGN_ARTICLE_QUERY_HASH =
  "0065aa69a4cc93a814e30877615c8793479e18b78d485e32bebd9486575a7124";

function extractDaangnArticleId(value) {
  if (!value) return null;
  const s = String(value);
  const match = s.match(/\/articles\/(\d+)/);
  if (match) return match[1];
  if (/^\d{5,}$/.test(s.trim())) return s.trim();
  return null;
}

async function checkDaangnListing(externalId, _row) {
  const sourceUrl = _row?.source_url;
  const payloadWebUrl = _row?.payload_json?.webUrl;

  const articleId = extractDaangnArticleId(payloadWebUrl)
    || extractDaangnArticleId(sourceUrl)
    || extractDaangnArticleId(externalId);

  // numeric articleId 확보 — 없으면 SEO URL(https://www.daangn.com/kr/realty/{slugId})에서
  // 리다이렉트를 따라가 realty.daangn.com/articles/{numericId} 패턴을 추출.
  // (현재 daangn은 numeric → /articles/{slug-...-{numericId}} 로 redirect하므로 marker로 사용 가능)
  let resolvedArticleId = articleId;
  if (!resolvedArticleId) {
    const seoUrl = sourceUrl || `https://www.daangn.com/kr/realty/${externalId}`;
    try {
      const seoRes = await fetch(seoUrl, {
        headers: { "User-Agent": COMMON_UA, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      // 410/404 → 즉시 종료 처리
      if (seoRes.status === 410) return { status: "expired", resultCode: "gone" };
      if (seoRes.status === 404) return { status: "expired", resultCode: "not_found" };
      // 리다이렉트된 최종 URL에서 numeric articleId 추출
      resolvedArticleId = extractDaangnArticleId(seoRes.url);
    } catch {
      // 무시하고 다음 단계로
    }
    // 그래도 못 찾으면 종료 판정 (SEO 패턴이 더 이상 존재하지 않거나 외부ID 자체가 의미 없음)
    if (!resolvedArticleId) return { status: "expired", resultCode: "no_article_id" };
  }

  // GraphQL API로 canonical 상태 판별
  try {
    const res = await fetch(DAANGN_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": COMMON_UA,
        Origin: "https://realty.daangn.com",
        Referer: "https://realty.daangn.com/",
      },
      body: JSON.stringify({
        variables: { articleId: String(resolvedArticleId) },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: DAANGN_ARTICLE_QUERY_HASH },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: "error", httpStatus: res.status };
    const json = await res.json();
    // recordNotFound 에러 → 게시글 삭제됨
    if (Array.isArray(json?.errors) && json.errors.some((e) => e?.extensions?.code === "recordNotFound")) {
      return { status: "expired", resultCode: "not_found" };
    }
    const a = json?.data?.articleByOriginalArticleId;
    if (!a) return { status: "expired", resultCode: "not_found" };
    if (a.isHide === true) return { status: "expired", resultCode: "hidden" };
    if (a.status === "CLOSED") return { status: "expired", resultCode: "closed" };
    // RESERVED: 임대인이 임차인과 협의·예약 상태 — 신규 임차 불가하므로 종료 처리
    if (a.status === "RESERVED") return { status: "expired", resultCode: "reserved" };
    if (a.status === "ON_GOING") return { status: "active" };
    return { status: "unknown", resultCode: a.status };
  } catch (e) {
    return { status: "error", resultCode: e?.name || "exception" };
  }
}

// ── 부동산써브 상태 체크 ──

async function checkServeListing(externalId) {
  const url = `https://www.serve.co.kr/good/v1/map/getAtclDetail?atclNo=${encodeURIComponent(externalId)}&tabNo=2`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": COMMON_UA,
      Accept: "application/json",
      Referer: "https://www.serve.co.kr/good/map",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) return { status: "error", httpStatus: res.status };

  const json = await res.json();
  const resultList = json?.data?.resultList;

  // 결과 없음 → 매물 삭제/종료
  if (!resultList || resultList.length === 0) {
    return { status: "expired", resultCode: "not_found" };
  }

  const item = resultList[0];
  // atclStusCd: "7" = 활성 (관찰된 값), 다른 값이면 종료 가능
  if (item.atclStusCd && item.atclStusCd !== "7") {
    return { status: "expired", resultCode: `status_${item.atclStusCd}` };
  }

  return { status: "active" };
}

// ── 플랫폼별 체커 맵 ──

const CHECKERS = {
  kbland: checkKbListing,
  zigbang: checkZigbangListing,
  dabang: checkDabangListing,
  peterpanz: checkPeterpanzListing,
  naver: checkNaverListing,
  daangn: checkDaangnListing,
  serve: checkServeListing,
};

// ── batch 처리: rows[] -> result[] (idx 정합 보장) ──

async function checkZigbangBatchRows(rows) {
  const results = new Array(rows.length);
  for (let i = 0; i < rows.length; i += ZIGBANG_BATCH_SIZE) {
    const slice = rows.slice(i, i + ZIGBANG_BATCH_SIZE);
    const numIds = [];
    const indexById = new Map(); // numId(string) -> 원래 index
    for (let k = 0; k < slice.length; k++) {
      const numId = Number(slice[k].external_id);
      if (!Number.isFinite(numId) || numId <= 0) {
        results[i + k] = { status: "expired", resultCode: "invalid_id" };
      } else {
        numIds.push(numId);
        indexById.set(String(numId), i + k);
      }
    }
    if (numIds.length === 0) continue;

    let items;
    try {
      items = await fetchZigbangBatch(numIds);
    } catch (e) {
      // chunk 전체 error — 해당 매물들은 다음 회차에 재시도
      for (const idx of indexById.values()) {
        results[idx] = { status: "error", httpStatus: e.httpStatus };
      }
      await sleep(delayMs);
      continue;
    }

    // 응답에 포함된 ID는 classify, 누락된 ID는 not_found
    const itemMap = new Map();
    for (const it of items) itemMap.set(String(it.item_id), it);
    for (const [idStr, idx] of indexById) {
      results[idx] = classifyZigbangItem(itemMap.get(idStr));
    }
    await sleep(delayMs);
  }
  return results;
}

const BATCH_CHECKERS = {
  zigbang: checkZigbangBatchRows,
};

// 플랫폼별 동시성 (단건 체커 한정).
// naver: 1 (기존 rate limit), kbland/dabang/daangn/peterpanz/serve: 검증된 안전치
const CONCURRENCY = {
  naver: 1,
  kbland: 4,
  dabang: 4,
  daangn: 4,
  peterpanz: 5,
  serve: 8,
};

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  let aborted = false;
  async function lane() {
    while (!aborted) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i, () => { aborted = true; });
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

// DB 기반 만료: HTTP 체크가 불가능한 플랫폼 (서버 IP 차단 등)
const DB_ONLY_PLATFORMS = new Set([]);
const EXPIRE_DAYS_WITH_STALE = 30; // STALE_SUSPECT + 30일 경과 → 만료
const EXPIRE_DAYS_ABSOLUTE = 60;   // 무조건 만료


async function checkPlatformByDb(platformCode, client) {
  console.log(`\n[status-check] ── ${platformCode} (DB 기반) ──`);

  // Hybrid: updated_at 기준 나이 + STALE_SUSPECT 플래그 결합
  const { rows: expiredRows } = await client.query(
    `SELECT listing_id, external_id, title, updated_at, quality_flags
     FROM normalized_listings
     WHERE platform_code = $1 AND deleted_at IS NULL
       AND (
         updated_at < NOW() - INTERVAL '${EXPIRE_DAYS_ABSOLUTE} days'
         OR (
           updated_at < NOW() - INTERVAL '${EXPIRE_DAYS_WITH_STALE} days'
           AND quality_flags::text LIKE '%STALE_SUSPECT%'
         )
       )
     ORDER BY updated_at ASC
     LIMIT $2`,
    [platformCode, batchSize],
  );

  console.log(`[status-check] 만료 대상: ${expiredRows.length}건`);

  if (expiredRows.length === 0) {
    // 전체 활성 건수 조회
    const { rows: [{ count }] } = await client.query(
      `SELECT COUNT(*)::int as count FROM normalized_listings WHERE platform_code = $1 AND deleted_at IS NULL`,
      [platformCode],
    );
    console.log(`[status-check] 활성 매물: ${count}건, 만료 대상 없음`);
    return { platform: platformCode, checked: count, active: count, expired: 0, errors: 0 };
  }

  for (const row of expiredRows) {
    const daysSince = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86400000);
    const isStale = (row.quality_flags || []).includes?.("STALE_SUSPECT") ||
                    String(row.quality_flags).includes("STALE_SUSPECT");
    const reason = daysSince >= EXPIRE_DAYS_ABSOLUTE ? `${daysSince}일 경과` : `${daysSince}일+STALE`;
    console.log(`  ✗ ${row.external_id} — 만료 (${reason}) (${row.title || "제목없음"})`);
  }

  if (!dryRun) {
    const ids = expiredRows.map((r) => r.listing_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const result = await client.query(
      `UPDATE normalized_listings SET deleted_at = NOW() WHERE listing_id IN (${placeholders})`,
      ids,
    );
    console.log(`[status-check] DB 업데이트: ${result.rowCount}건 soft-delete 완료`);
  } else {
    console.log(`[status-check] DRY RUN: ${expiredRows.length}건 soft-delete 예정`);
  }

  // 남은 활성 건수
  const { rows: [{ count: activeCount }] } = await client.query(
    `SELECT COUNT(*)::int as count FROM normalized_listings WHERE platform_code = $1 AND deleted_at IS NULL`,
    [platformCode],
  );

  return { platform: platformCode, checked: expiredRows.length + activeCount, active: activeCount, expired: expiredRows.length, errors: 0 };
}

// ── 단일 플랫폼 체크 ──

function summarizeResult(row, result, counters, expiredIds) {
  if (result?.status === "expired") {
    counters.expired++;
    expiredIds.push(row.listing_id);
    console.log(`  ✗ ${row.external_id} — 종료 [${result.resultCode}] (${row.title || "제목없음"})`);
    return false; // not a timeout
  }
  if (result?.status === "active") {
    counters.active++;
    if (verbose) console.log(`  ✓ ${row.external_id} — 활성`);
    return false;
  }
  counters.errors++;
  console.log(`  ? ${row.external_id} — ${result?.status || "error"} (code: ${result?.resultCode || result?.httpStatus})`);
  return result?.httpStatus === 429; // rate-limit은 timeout-like로 취급
}

async function persistExpired(client, expiredIds) {
  if (expiredIds.length === 0) return 0;
  if (dryRun) {
    console.log(`[status-check] DRY RUN: ${expiredIds.length}건 soft-delete 예정`);
    return expiredIds.length;
  }
  const placeholders = expiredIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await client.query(
    `UPDATE normalized_listings SET deleted_at = NOW() WHERE listing_id IN (${placeholders})`,
    expiredIds,
  );
  console.log(`[status-check] DB 업데이트: ${result.rowCount}건 soft-delete 완료`);
  return result.rowCount;
}

async function checkPlatform(platformCode, client) {
  if (DB_ONLY_PLATFORMS.has(platformCode)) {
    return checkPlatformByDb(platformCode, client);
  }

  const batchChecker = BATCH_CHECKERS[platformCode];
  const singleChecker = CHECKERS[platformCode];
  if (!batchChecker && !singleChecker) {
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

  const counters = { active: 0, expired: 0, errors: 0 };
  const expiredIds = [];

  if (batchChecker) {
    // batch 체커: rows를 받아 idx 정합된 result[] 반환 (zigbang 등)
    const results = await batchChecker(rows);
    for (let i = 0; i < rows.length; i++) summarizeResult(rows[i], results[i], counters, expiredIds);
  } else {
    // 단건 체커: concurrency pool로 처리. 연속 타임아웃 N회면 abort.
    const concurrency = CONCURRENCY[platformCode] ?? 1;
    const isNaver = platformCode === "naver";
    const platformDelay = isNaver ? Math.max(delayMs, NAVER_DELAY_MS) : delayMs;
    let consecutiveTimeouts = 0;

    await runWithConcurrency(rows, concurrency, async (row, _i, abort) => {
      if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
        counters.errors++;
        return { status: "error", resultCode: "aborted" };
      }
      let result;
      try {
        result = await singleChecker(row.external_id, row);
      } catch (e) {
        const isTimeout = e.name === "TimeoutError" || /timeout|aborted/i.test(e.message);
        if (isTimeout) consecutiveTimeouts++;
        else consecutiveTimeouts = 0;
        counters.errors++;
        console.log(`  ! ${row.external_id} — 오류: ${e.message}`);
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          console.log(`  ⚠ 연속 타임아웃 ${consecutiveTimeouts}회 — ${platformCode} 체크 중단`);
          abort();
        }
        await sleep(platformDelay);
        return { status: "error", resultCode: "exception" };
      }
      const isTimeoutLike = summarizeResult(row, result, counters, expiredIds);
      if (isTimeoutLike) consecutiveTimeouts++;
      else consecutiveTimeouts = 0;
      if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
        console.log(`  ⚠ 연속 타임아웃 ${consecutiveTimeouts}회 — ${platformCode} 체크 중단`);
        abort();
      }
      await sleep(platformDelay);
      return result;
    });
  }

  await persistExpired(client, expiredIds);
  return { platform: platformCode, checked: rows.length, ...counters };
}

// ── 메인 ──

async function expireOutOfScopeDistricts(client) {
  const placeholders = TARGET_DISTRICTS.map((_, i) => `$${i + 1}`).join(",");
  // address_text 포맷 두 가지 모두 처리:
  //   1) "서울특별시 X구 동" (naver/kbland/dabang 등)
  //   2) "X구 동" — prefix 없음 (zigbang)
  const whereClause = `
    WHERE deleted_at IS NULL
      AND address_text IS NOT NULL
      AND (
        -- 서울 접두어 O: 구가 대상 밖
        (address_text LIKE '서울%'
         AND SUBSTRING(address_text FROM '서울[특별시]* ([^ ]+구)') NOT IN (${placeholders}))
        -- 서울 접두어 X, 첫 토큰이 구: 대상 밖
        OR (address_text !~ '^서울'
            AND address_text ~ '^[^ ]+구 '
            AND SUBSTRING(address_text FROM '^([^ ]+구)') NOT IN (${placeholders}))
        -- 그 외 지역 (경기도 등) — 수집 대상 아님
        OR (address_text NOT LIKE '서울%'
            AND address_text !~ '^[^ ]+구 ')
      )
  `;
  if (dryRun) {
    const { rows } = await client.query(`SELECT listing_id FROM normalized_listings ${whereClause}`, TARGET_DISTRICTS);
    console.log(`[scope-check] DRY RUN: 수집 대상 밖 구 ${rows.length}건 soft-delete 예정`);
    return rows.length;
  }
  const { rowCount } = await client.query(
    `UPDATE normalized_listings SET deleted_at = NOW() ${whereClause} RETURNING listing_id`,
    TARGET_DISTRICTS,
  );
  if (rowCount > 0) console.log(`[scope-check] 수집 대상 밖 구 ${rowCount}건 soft-delete 완료`);
  return rowCount;
}

// bbox 기준 (수집기와 동일)
const DISTRICT_BBOX = {
  성동구:   { sw_lat: 37.540, ne_lat: 37.585, sw_lng: 127.010, ne_lng: 127.075 },
  광진구:   { sw_lat: 37.517, ne_lat: 37.570, sw_lng: 127.055, ne_lng: 127.110 },
  동대문구: { sw_lat: 37.555, ne_lat: 37.595, sw_lng: 127.010, ne_lng: 127.085 },
  성북구:   { sw_lat: 37.570, ne_lat: 37.600, sw_lng: 127.019, ne_lng: 127.070 },
  중랑구:   { sw_lat: 37.570, ne_lat: 37.635, sw_lng: 127.055, ne_lng: 127.120 },
  중구:     { sw_lat: 37.545, ne_lat: 37.580, sw_lng: 127.000, ne_lng: 127.030 },
  종로구:   { sw_lat: 37.565, ne_lat: 37.595, sw_lng: 127.000, ne_lng: 127.030 },
};

async function expireBboxOutliers(client) {
  const conditions = Object.entries(DISTRICT_BBOX).map(([gu, b]) =>
    `(address_text LIKE '%${gu}%' AND lat IS NOT NULL AND lng IS NOT NULL AND ` +
    `(lat < ${b.sw_lat} OR lat > ${b.ne_lat} OR lng < ${b.sw_lng} OR lng > ${b.ne_lng}))`
  ).join("\n    OR ");

  const sql = `
    UPDATE normalized_listings SET deleted_at = NOW()
    WHERE deleted_at IS NULL AND (${conditions})
    RETURNING listing_id
  `;

  if (dryRun) {
    const { rows } = await client.query(sql.replace("UPDATE normalized_listings SET deleted_at = NOW()", "SELECT listing_id FROM normalized_listings").replace("RETURNING listing_id", ""));
    console.log(`[scope-check] DRY RUN: bbox 이탈 ${rows.length}건 soft-delete 예정`);
    return rows.length;
  }
  const { rowCount } = await client.query(sql);
  if (rowCount > 0) console.log(`[scope-check] bbox 이탈 ${rowCount}건 soft-delete 완료`);
  return rowCount;
}

async function main() {
  const platformList = platform === "all" ? Object.keys(CHECKERS) : [platform];

  // 수집 대상 밖 구 매물 선제 정리 (all 모드에서만)
  if (platform === "all") {
    await withDbClient((client) => expireOutOfScopeDistricts(client));
    await withDbClient((client) => expireBboxOutliers(client));
  }

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

  // pool max=5 — 7개 동시 실행 시 커넥션 타임아웃 발생.
  // 3개씩 배치로 병렬 실행하여 속도 유지 + 커넥션 경합 제거.
  const BATCH = 3;
  const results = [];
  for (let i = 0; i < platformList.length; i += BATCH) {
    const batch = platformList.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((p) => withDbClient((client) => checkPlatform(p, client))),
    );
    for (let j = 0; j < batch.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      } else if (r.status === "rejected") {
        console.error(`[status-check] ${batch[j]} 처리 중 오류: ${r.reason?.message}`);
      }
    }
  }

  // 전체 요약
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n\n=== 전체 상태 체크 결과 ===");
  console.log(`  소요시간: ${elapsed}s\n`);

  let totalChecked = 0,
    totalActive = 0,
    totalExpired = 0,
    totalErrors = 0;
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
