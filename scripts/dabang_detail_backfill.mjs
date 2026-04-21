#!/usr/bin/env node
/**
 * 다방 detail backfill
 *
 * DB에서 direction/bathroom_count/description_text 가 null인 다방 매물을
 * detail API로 재수집해 업데이트.
 *
 * Usage:
 *   node scripts/dabang_detail_backfill.mjs            # 실제 업데이트
 *   node scripts/dabang_detail_backfill.mjs --dry-run  # 조회만, 업데이트 없음
 *   node scripts/dabang_detail_backfill.mjs --limit=50 # 최대 50건만
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { withDbClient } from "./lib/db_client.mjs";

chromium.use(StealthPlugin());

// ─── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = (() => {
  const m = args.find((a) => a.startsWith("--limit="));
  if (!m) return Infinity;
  const n = Number(m.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

function log(msg) { console.log(`[backfill] ${msg}`); }

// ─── Direction 정규화 ─────────────────────────────────────────────────────────
const DIR_MAP = {
  남서향: "남서향", 남서: "남서향",
  남동향: "남동향", 남동: "남동향",
  북서향: "북서향", 북서: "북서향",
  북동향: "북동향", 북동: "북동향",
  남향: "남향", 남: "남향",
  북향: "북향", 북: "북향",
  동향: "동향", 동: "동향",
  서향: "서향", 서: "서향",
};

function normalizeDirection(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  return DIR_MAP[s] ?? s;
}

// ─── address_code (FNV-1a 11자리) ─────────────────────────────────────────────
function hash11(v) {
  const base = String(v || "").replace(/\s+/g, " ").trim();
  if (!base) return null;
  let acc = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i++) {
    acc ^= base.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  return `11${String((acc >>> 0) % 900000000).padStart(9, "0")}`;
}

// ─── DB: 업데이트 대상 조회 ────────────────────────────────────────────────────
async function fetchTargetListings(client, limit) {
  const rows = await client.query(`
    SELECT listing_id, external_id, address_text,
           bathroom_count, direction, description_text
    FROM normalized_listings
    WHERE platform_code = 'dabang'
      AND deleted_at IS NULL
      AND (
        bathroom_count IS NULL
        OR direction IS NULL
        OR description_text IS NULL
      )
    ORDER BY listing_id
    ${Number.isFinite(limit) ? `LIMIT ${limit}` : ""}
  `);
  return rows.rows;
}

// ─── DB: 단건 업데이트 ─────────────────────────────────────────────────────────
async function updateListing(client, listingId, fields) {
  const { bathroom_count, direction, description_text, address_text } = fields;
  const addressCode = address_text ? hash11(address_text) : null;

  await client.query(`
    UPDATE normalized_listings
    SET
      bathroom_count   = COALESCE($1, bathroom_count),
      direction        = COALESCE($2, direction),
      description_text = COALESCE($3, description_text),
      address_text = CASE
        WHEN $4 LIKE '%구%' THEN $4
        WHEN address_text LIKE '%구%' THEN address_text
        ELSE COALESCE($4, address_text)
      END,
      address_code = CASE
        WHEN $4 LIKE '%구%' THEN $5
        ELSE address_code
      END,
      updated_at = NOW()
    WHERE listing_id = $6
  `, [bathroom_count, direction, description_text, address_text, addressCode, listingId]);
}

// ─── detail API 파싱 ──────────────────────────────────────────────────────────
function parseDetailResponse(data) {
  const room = data?.room;
  if (!room) return null;

  const direction = normalizeDirection(room.direction_str);
  const bathroom_count = typeof room.bath_num === "number" ? room.bath_num : null;
  const memo = room.memo && typeof room.memo === "string" && room.memo.trim().length >= 10
    ? room.memo.trim()
    : null;
  const address = room.address || room.full_jibun_address_str || null;

  if (!direction && !bathroom_count && !memo && !address) return null;

  return { direction, bathroom_count, description_text: memo, address_text: address };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`모드: ${DRY_RUN ? "DRY-RUN (업데이트 없음)" : "실제 업데이트"}`);
  log(`최대 처리 건수: ${Number.isFinite(LIMIT) ? LIMIT : "전체"}`);

  let targets;
  await withDbClient(async (client) => {
    targets = await fetchTargetListings(client, LIMIT);
  });

  log(`대상 매물: ${targets.length}건`);
  if (targets.length === 0) {
    log("업데이트할 매물 없음. 종료.");
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  let success = 0, skip = 0, fail = 0;

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });

    const page = await context.newPage();

    // 세션 수립
    log("다방 세션 수립 중...");
    try {
      await page.goto("https://www.dabangapp.com", { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      log("세션 페이지 로드 실패, 계속 진행...");
    }

    for (let i = 0; i < targets.length; i++) {
      const { listing_id, external_id, address_text: existingAddress } = targets[i];
      const detailUrl = `https://www.dabangapp.com/api/3/new-room/detail?room_id=${external_id}&api_version=3.0.1&call_type=web&version=1`;

      log(`[${i + 1}/${targets.length}] id=${external_id} ...`);

      try {
        const result = await Promise.race([
          page.evaluate(async (url) => {
            try {
              const res = await fetch(url, {
                headers: { accept: "application/json, text/plain, */*" },
                credentials: "include",
              });
              if (!res.ok) return { ok: false, status: res.status };
              const data = await res.json();
              return { ok: true, data };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          }, detailUrl),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000)),
        ]);

        if (!result.ok) {
          log(`  SKIP: ${result.status || result.error}`);
          skip++;
        } else {
          const fields = parseDetailResponse(result.data);
          if (!fields) {
            log(`  SKIP: 유효 필드 없음 (매물 정보 미제공)`);
            skip++;
          } else {
            log(`  direction=${fields.direction} bath=${fields.bathroom_count} desc=${fields.description_text ? "있음" : "없음"} addr=${fields.address_text}`);
            if (!DRY_RUN) {
              await withDbClient(async (client) => {
                await updateListing(client, listing_id, fields);
              });
            }
            success++;
          }
        }
      } catch (err) {
        log(`  ERROR: ${err.message}`);
        fail++;
      }

      // rate limit
      await new Promise((r) => setTimeout(r, 900 + Math.random() * 400));
    }

    await page.close();
  } finally {
    await browser.close();
  }

  log("");
  log("=== 완료 ===");
  log(`성공: ${success} / 스킵: ${skip} / 에러: ${fail} / 총: ${targets.length}`);
  if (DRY_RUN) log("(dry-run — DB 변경 없음)");
}

main().catch((e) => {
  console.error("[backfill] Fatal:", e);
  process.exit(1);
});
