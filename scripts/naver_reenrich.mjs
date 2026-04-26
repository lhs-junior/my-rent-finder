#!/usr/bin/env node
/**
 * 네이버 매물 reenrich 스크립트
 *
 * Phase 1: raw_listings에서 building_use, room_count, description_text 재정규화
 * Phase 2: Playwright로 상세 API 호출 → 이미지, 전체 설명, buildingTypeName 보강
 *
 * Usage:
 *   node scripts/naver_reenrich.mjs [--dry-run] [--phase 1|2|all]
 */
import fs from "node:fs";
import { withDbClient, toText } from "./lib/db_client.mjs";

const HOME = process.env.HOME;
const SESSION_PATH = `${HOME}/.naver-realestate-session.json`;
const CDN = "https://landthumb-phinf.pstatic.net";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const phaseArg = args.find((a) => a.startsWith("--phase"))?.split("=")[1] ?? "all";
const RUN_PHASE1 = phaseArg === "all" || phaseArg === "1";
const RUN_PHASE2 = phaseArg === "all" || phaseArg === "2";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 헬퍼 ──

const KOREAN_NUMS = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 };

function parseRoomFromTagList(tagList) {
  if (!Array.isArray(tagList)) return null;
  for (const tag of tagList) {
    const m = /^방(한|두|세|네|다섯|여섯)개$/.exec(String(tag || "").trim());
    if (m) return KOREAN_NUMS[m[1]] ?? null;
  }
  return null;
}

function normalizeBuildingUse(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "vl") return "빌라/연립";
  if (s === "yr") return "빌라/연립";
  if (s === "dsd") return "단독/다가구";
  if (s === "dddgg") return "단독/다가구";
  if (/(단독|다가구|다세대|주택)/.test(s)) return "단독/다가구";
  if (/(연립|빌라)/.test(s)) return "빌라/연립";
  return String(value || "").trim() || null;
}

function parseFloorInfo(floorInfo) {
  if (!floorInfo) return { floor: null, total_floor: null };
  const s = String(floorInfo).trim();
  // "2/6층" or "2층/6층" or "2층"
  const m = /^(\d+)\s*층?\s*\/\s*(\d+)\s*층?$/.exec(s) || /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (m) return { floor: Number(m[1]), total_floor: Number(m[2]) };
  const single = /^(\d+)\s*층?$/.exec(s);
  if (single) return { floor: Number(single[1]), total_floor: null };
  return { floor: null, total_floor: null };
}

function normalizeDirection(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^(남|북|동|서|남동|남서|북동|북서|정남|정북|정동|정서)향?$/.test(s)) return s.replace(/향$/, "") + "향";
  return s;
}

function normalizeImageUrl(src) {
  if (!src || typeof src !== "string") return null;
  const absolute = src.startsWith("/") ? `${CDN}${src}` : src;
  try {
    const parsed = new URL(absolute);
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function upsertListingImages(client, { listingId, rawId, imageUrls }) {
  if (!listingId || !Array.isArray(imageUrls) || imageUrls.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < imageUrls.length; i++) {
    const sourceUrl = imageUrls[i];
    if (!sourceUrl) continue;
    await client.query(
      `INSERT INTO listing_images (listing_id, raw_id, source_url, status, is_primary)
       VALUES ($1, $2, $3, 'queued', $4)
       ON CONFLICT (listing_id, source_url) DO UPDATE
         SET raw_id = EXCLUDED.raw_id,
             status = CASE WHEN listing_images.status = 'downloaded' THEN 'downloaded' ELSE EXCLUDED.status END,
             is_primary = listing_images.is_primary OR EXCLUDED.is_primary`,
      [listingId, rawId, sourceUrl, i === 0],
    );
    inserted++;
  }
  return inserted;
}

// ── Phase 1: raw_listings에서 재정규화 ──

async function phase1(db) {
  console.log("\n=== Phase 1: raw_listings 재정규화 ===");

  // DB 서버에서 JSONB unnesting + JOIN 처리 (전체 payload 전송 없이)
  console.log("raw_listings에서 article 데이터 추출 중 (서버 사이드)...");
  const { rows: articleRows } = await db.query(`
    WITH recent_raw AS (
      SELECT raw_id, payload_json->'articleList' AS articles
      FROM raw_listings
      WHERE platform_code = 'naver'
        AND collected_at > NOW() - INTERVAL '7 days'
        AND jsonb_typeof(payload_json->'articleList') = 'array'
        AND jsonb_array_length(payload_json->'articleList') > 0
      ORDER BY collected_at DESC
      LIMIT 2000
    ),
    unnested AS (
      SELECT raw_id, jsonb_array_elements(articles) AS art
      FROM recent_raw
    ),
    deduped AS (
      SELECT DISTINCT ON (art->>'articleNo')
        raw_id,
        art->>'articleNo'           AS article_no,
        art->>'realEstateTypeName'  AS type_name,
        art->>'realEstateTypeCode'  AS type_code,
        art->>'articleFeatureDesc'  AS feature_desc,
        art->'tagList'              AS tag_list,
        art->>'direction'           AS direction,
        art->>'floorInfo'           AS floor_info
      FROM unnested
      ORDER BY art->>'articleNo'
    )
    SELECT nl.listing_id, nl.external_id, nl.room_count, nl.building_use, nl.description_text,
           d.raw_id, d.type_name, d.type_code, d.feature_desc, d.tag_list, d.direction, d.floor_info
    FROM normalized_listings nl
    JOIN deduped d ON d.article_no = nl.external_id
    WHERE nl.platform_code = 'naver' AND nl.deleted_at IS NULL
  `);

  console.log(`article 데이터: ${articleRows.length}건 매칭`);

  let updated = 0;
  let skipped = 0;

  for (const row of articleRows) {
    // building_use
    const buildingUse = normalizeBuildingUse(row.type_name || row.type_code);

    // room_count: tagList 우선
    let roomCount = parseRoomFromTagList(row.tag_list);
    if (roomCount === null) {
      const descText = String(row.feature_desc || "").toLowerCase();
      const m1 = /(원룸|투룸|쓰리룸)/.exec(descText);
      if (m1) {
        if (m1[1] === "원룸") roomCount = 1;
        else if (m1[1] === "투룸") roomCount = 2;
        else if (m1[1] === "쓰리룸") roomCount = 3;
      }
    }

    const description = String(row.feature_desc || "").trim() || null;
    const direction = normalizeDirection(row.direction);
    const floorParsed = parseFloorInfo(row.floor_info);

    const patch = {
      building_use: buildingUse,
      room_count: roomCount,
      description_text: description,
      direction: direction || null,
      floor: floorParsed.floor,
      total_floor: floorParsed.total_floor,
    };

    const changed = (
      (buildingUse && buildingUse !== row.building_use) ||
      (roomCount !== null && roomCount !== row.room_count) ||
      (description && !row.description_text)
    );

    if (!changed) {
      skipped++;
      continue;
    }

    console.log(
      `  ${row.external_id}: use=${patch.building_use} room=${patch.room_count} ` +
      `dir=${patch.direction} floor=${patch.floor} desc=${patch.description_text?.slice(0, 30) ?? null}`,
    );

    if (!DRY_RUN) {
      await db.query(
        `UPDATE normalized_listings SET
           building_use     = COALESCE($2, building_use),
           room_count       = COALESCE($3, room_count),
           description_text = COALESCE($4, description_text),
           direction        = COALESCE($5, direction),
           floor            = COALESCE($6, floor),
           total_floor      = COALESCE($7, total_floor),
           updated_at       = NOW()
         WHERE listing_id = $1`,
        [row.listing_id, patch.building_use, patch.room_count, patch.description_text, patch.direction, patch.floor, patch.total_floor],
      );
    }
    updated++;
  }

  console.log(`\nPhase 1 완료: updated=${updated}, skipped=${skipped}`);
}

// ── Phase 2: Playwright 상세 API 호출 ──

async function phase2(db) {
  console.log("\n=== Phase 2: Playwright 상세 API (이미지 + 전체 설명) ===");

  // playwright-extra + stealth (auto collector와 동일 방식)
  const { chromium } = await import("playwright-extra");
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  chromium.use(StealthPlugin());

  // 이미지 수 적거나 description 없는 매물 우선
  const { rows: targets } = await db.query(`
    SELECT nl.listing_id, nl.external_id, nl.building_use, nl.description_text,
           nl.room_count, nl.raw_id,
           COUNT(li.image_id) as img_count
    FROM normalized_listings nl
    LEFT JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = 'naver' AND nl.deleted_at IS NULL
    GROUP BY nl.listing_id, nl.external_id, nl.building_use, nl.description_text, nl.room_count, nl.raw_id
    ORDER BY img_count ASC, nl.listing_id
  `);

  console.log(`상세 API 대상: ${targets.length}건`);

  const savedSession = fs.existsSync(SESSION_PATH) ? SESSION_PATH : undefined;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "ko-KR",
    storageState: savedSession,
  });
  const page = await context.newPage();

  // SPA 진입 + 실제 API 요청 헤더 캡처 (auto collector와 동일 패턴)
  console.log("SPA 세션 활성화 및 API 헤더 캡처 중...");
  let capturedSpaHeaders = null;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("new.land.naver.com/api/articles") && !url.includes("clusters") && !url.includes("interest")) {
      capturedSpaHeaders = req.headers();
    }
  });

  // houses 페이지로 이동 → SPA가 articleList API를 자동 호출 → 헤더 캡처
  await page.goto(
    "https://new.land.naver.com/houses?cortarNo=1120000000&zoom=14&tradeType=B2&realEstateType=DDDGG%3AVL%3ADSD%3AYR",
    { waitUntil: "domcontentloaded", timeout: 30000 },
  ).catch(() => {});

  // SPA 헤더 캡처 대기 (최대 10초)
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (capturedSpaHeaders) { clearInterval(check); resolve(); }
    }, 200);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
  });
  console.log(`캡처된 헤더: ${capturedSpaHeaders ? Object.keys(capturedSpaHeaders).length : 0}개 (SPA 헤더 ${capturedSpaHeaders ? "성공" : "실패 → 쿠키만 사용"})`);

  // 캡처 실패 시 폴백 헤더
  const apiHeaders = capturedSpaHeaders ?? {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://new.land.naver.com/",
  };

  let imgTotal = 0;
  let detailUpdated = 0;
  let errors = 0;

  try {
    for (const target of targets) {
      try {
        const detailUrl = `https://new.land.naver.com/api/articles/${target.external_id}?complexNo=`;
        // auto collector와 동일: capturedSpaHeaders를 page.evaluate에 전달
        const detail = await page.evaluate(async ({ url, headers }) => {
          try {
            const res = await fetch(url, { headers, credentials: "include" });
            if (!res.ok) return { __status: res.status };
            return res.json();
          } catch (e) { return { __error: String(e) }; }
        }, { url: detailUrl, headers: apiHeaders });

        if (!detail || typeof detail !== "object" || detail.__error || detail.__status) {
          console.log(`  ERROR ${target.external_id}: status=${detail?.__status ?? "?"} err=${detail?.__error ?? "no detail"}`);
          errors++;
          continue;
        }

        const ad = detail.articleDetail || {};
        const af = detail.articleFacility || {};
        const asp = detail.articleSpace || {};
        const photos = detail.articlePhotos || [];

        // 이미지 URL 수집
        const imageUrls = [];
        for (const photo of photos) {
          const url = normalizeImageUrl(photo?.imageSrc);
          if (url && !imageUrls.includes(url)) imageUrls.push(url);
        }
        // articleAddition 대표 이미지
        const repImg = normalizeImageUrl(detail.articleAddition?.representativeImgUrl);
        if (repImg && !imageUrls.includes(repImg)) imageUrls.unshift(repImg);

        // 필드 보강
        const patch = {
          building_use: normalizeBuildingUse(ad.buildingTypeName) || target.building_use,
          room_count: ad.roomCount > 0 ? ad.roomCount : target.room_count,
          bathroom_count: ad.bathroomCount > 0 ? ad.bathroomCount : null,
          description_text: String(ad.detailDescription || "").trim() || target.description_text,
          direction: normalizeDirection(af.directionTypeName) || null,
          monthly_management_cost: ad.monthlyManagementCost >= 0 ? ad.monthlyManagementCost : null,
          walk_time_to_subway: ad.walkingTimeToNearSubway >= 0 ? ad.walkingTimeToNearSubway : null,
          parking_possible: ad.parkingPossibleYN === "Y" ? true : ad.parkingPossibleYN === "N" ? false : null,
          available_date: String(ad.moveInPossibleYmd || "").trim() || null,
          area_exclusive_m2: asp.exclusiveSpace > 0 ? asp.exclusiveSpace : null,
          area_gross_m2: asp.supplySpace > 0 ? asp.supplySpace : null,
          building_year: (() => {
            const raw = detail.articleFacility?.buildingUseAprvYmd || detail.articleBuildingRegister?.useAprDay || "";
            const y = parseInt(String(raw).slice(0, 4), 10);
            return Number.isFinite(y) && y > 1900 && y < 2100 ? y : null;
          })(),
        };

        const hasChanges = imageUrls.length > 0 || Object.values(patch).some((v) => v !== null);

        console.log(
          `  ${target.external_id}: imgs=${imageUrls.length} use=${patch.building_use} ` +
          `room=${patch.room_count} bath=${patch.bathroom_count} year=${patch.building_year}`,
        );

        if (!DRY_RUN && hasChanges) {
          await db.query(
            `UPDATE normalized_listings SET
               building_use             = COALESCE($2, building_use),
               room_count               = COALESCE($3, room_count),
               bathroom_count           = COALESCE($4, bathroom_count),
               description_text         = COALESCE($5, description_text),
               direction                = COALESCE($6, direction),
               monthly_management_cost  = COALESCE($7, monthly_management_cost),
               walk_time_to_subway      = COALESCE($8, walk_time_to_subway),
               parking_possible         = COALESCE($9, parking_possible),
               available_date           = COALESCE($10, available_date),
               area_exclusive_m2        = COALESCE($11, area_exclusive_m2),
               area_gross_m2            = COALESCE($12, area_gross_m2),
               building_year            = COALESCE($13, building_year),
               updated_at               = NOW()
             WHERE listing_id = $1`,
            [
              target.listing_id,
              patch.building_use, patch.room_count, patch.bathroom_count,
              patch.description_text, patch.direction, patch.monthly_management_cost,
              patch.walk_time_to_subway, patch.parking_possible, patch.available_date,
              patch.area_exclusive_m2, patch.area_gross_m2, patch.building_year,
            ],
          );

          if (imageUrls.length > 0) {
            const rawId = target.raw_id || null;
            const cnt = await upsertListingImages(db, { listingId: target.listing_id, rawId, imageUrls });
            imgTotal += cnt;
          }
        }

        detailUpdated++;
        await sleep(400);
      } catch (e) {
        console.log(`  ERROR ${target.external_id}: ${e.message}`);
        errors++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nPhase 2 완료: updated=${detailUpdated}, new_images=${imgTotal}, errors=${errors}`);
}

// ── 메인 ──

await withDbClient(async (db) => {
  console.log(`네이버 reenrich 시작 (dry_run=${DRY_RUN}, phase=${phaseArg})`);
  if (RUN_PHASE1) await phase1(db);
  if (RUN_PHASE2) await phase2(db);
  console.log("\n전체 완료");
});
