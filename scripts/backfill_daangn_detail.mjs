#!/usr/bin/env node

/**
 * 기존 당근 매물 상세 정보 백필
 * GraphQL API로 lat/lng, roomCnt, bathroomCnt, topFloor, buildingApprovalDate 보강
 *
 * 사용법:
 *   node scripts/backfill_daangn_detail.mjs              # 누락 필드만 채우기
 *   node scripts/backfill_daangn_detail.mjs --force-all  # 전체 갱신
 *   node scripts/backfill_daangn_detail.mjs --dry-run    # 실제 업데이트 없이 확인
 */

import { withDbClient } from "./lib/db_client.mjs";

const DAANGN_GRAPHQL_URL = "https://realty.kr.karrotmarket.com/graphql";
const DAANGN_ARTICLE_QUERY_HASH =
  "0065aa69a4cc93a814e30877615c8793479e18b78d485e32bebd9486575a7124";
const CONCURRENCY = 4;
const DELAY_MS = 250;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const forceAll = args.includes("--force-all");

const COMMON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function extractArticleId(value) {
  if (!value) return null;
  const s = String(value);
  const match = s.match(/\/articles\/(\d+)/);
  if (match) return match[1];
  if (/^\d{5,}$/.test(s.trim())) return s.trim();
  return null;
}

async function fetchArticleDetail(articleId) {
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
        variables: { articleId: String(articleId) },
        extensions: {
          persistedQuery: { version: 1, sha256Hash: DAANGN_ARTICLE_QUERY_HASH },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const a = json?.data?.articleByOriginalArticleId;
    if (!a) return null;

    const lat = parseFloat(a.publicCoordinate?.lat);
    const lng = parseFloat(a.publicCoordinate?.lon);
    return {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      roomCount: a.roomCnt ?? null,
      bathroomCount: a.bathroomCnt ?? null,
      topFloor: a.topFloor != null ? parseInt(a.topFloor, 10) : null,
      buildingApprovalDate: a.buildingApprovalDate ?? null,
      nearbySubwayStation: a.nearbySubwayStationName ?? null,
      status: a.status ?? null,
      isHide: a.isHide ?? false,
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log(`=== 당근 상세정보 백필 ${dryRun ? "[DRY-RUN]" : ""} ${forceAll ? "[FORCE-ALL]" : ""} ===`);

  const stats = { total: 0, fetched: 0, updated: 0, skipped: 0, failed: 0, expired: 0 };

  await withDbClient(async (client) => {
    const missingFilter = forceAll
      ? "TRUE"
      : "(lat IS NULL OR lng IS NULL OR room_count IS NULL OR bathroom_count IS NULL OR total_floor IS NULL)";

    const { rows } = await client.query(`
      SELECT nl.listing_id, nl.external_id, nl.source_url, rl.payload_json
      FROM normalized_listings nl
      JOIN raw_listings rl ON rl.raw_id = nl.raw_id
      WHERE nl.platform_code = 'daangn'
        AND nl.deleted_at IS NULL
        AND ${missingFilter}
      ORDER BY nl.created_at DESC
    `);

    stats.total = rows.length;
    console.log(`대상: ${rows.length}건\n`);

    let cursor = 0;
    let done = 0;

    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];

        const articleId =
          extractArticleId(row.payload_json?.webUrl) ||
          extractArticleId(row.source_url) ||
          extractArticleId(row.external_id);

        if (!articleId) {
          stats.skipped++;
          done++;
          continue;
        }

        const detail = await fetchArticleDetail(articleId);
        stats.fetched++;
        done++;

        if (!detail) {
          stats.failed++;
          process.stdout.write(`  [FAIL] listing_id=${row.listing_id} articleId=${articleId}\n`);
          continue;
        }

        if (detail.isHide || detail.status === "CLOSED") {
          stats.expired++;
          if (!dryRun) {
            await client.query(
              "UPDATE normalized_listings SET deleted_at = NOW() WHERE listing_id = $1",
              [row.listing_id],
            );
          }
          process.stdout.write(`  [EXPIRED] listing_id=${row.listing_id} status=${detail.status}\n`);
          continue;
        }

        const buildingYear = detail.buildingApprovalDate
          ? parseInt(detail.buildingApprovalDate.slice(0, 4), 10)
          : null;

        if (!dryRun) {
          await client.query(
            `UPDATE normalized_listings SET
               lat = COALESCE($1, lat),
               lng = COALESCE($2, lng),
               room_count = COALESCE($3, room_count),
               bathroom_count = COALESCE($4, bathroom_count),
               total_floor = COALESCE($5, total_floor),
               nearest_subway_station = COALESCE($6, nearest_subway_station),
               building_year = COALESCE($7, building_year)
             WHERE listing_id = $8`,
            [
              detail.lat,
              detail.lng,
              detail.roomCount,
              detail.bathroomCount,
              detail.topFloor,
              detail.nearbySubwayStation,
              buildingYear,
              row.listing_id,
            ],
          );
        }

        stats.updated++;
        if (done % 10 === 0 || done === rows.length) {
          process.stdout.write(`  진행: ${done}/${rows.length} (업데이트 ${stats.updated}건)\n`);
        }

        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    };

    await Promise.all(Array(CONCURRENCY).fill(0).map(() => worker()));
  });

  console.log("\n=== 백필 완료 ===");
  console.log(`  전체: ${stats.total}건`);
  console.log(`  API 호출: ${stats.fetched}건`);
  console.log(`  업데이트: ${stats.updated}건`);
  console.log(`  스킵 (articleId 없음): ${stats.skipped}건`);
  console.log(`  실패: ${stats.failed}건`);
  console.log(`  종료 처리: ${stats.expired}건`);
}

main().catch(console.error);
