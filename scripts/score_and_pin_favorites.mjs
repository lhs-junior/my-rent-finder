#!/usr/bin/env node

// scripts/score_and_pin_favorites.mjs
// 매물을 배점 기준으로 점수 매기고 PIN별 찜 목록에 저장
//
// 사용법:
//   node scripts/score_and_pin_favorites.mjs --pin-s=1004 --pin-a=1005
//   node scripts/score_and_pin_favorites.mjs --pin-s=1004              # S급만
//   node scripts/score_and_pin_favorites.mjs --pin-s=1004 --dry-run    # 저장 안 하고 집계만
//   node scripts/score_and_pin_favorites.mjs --pin-s=1004 --threshold-s=10 --threshold-a=7

import { withDbClient } from "./lib/db_client.mjs";
import { hashPin } from "./lib/pin_hash.mjs";

// ── CLI 파싱 ──────────────────────────────────────────────────
function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, ...rest] = a.slice(2).split("=");
        return [k, rest.length ? rest.join("=") : "true"];
      }),
  );
  return {
    pinS: args["pin-s"] || null,
    pinA: args["pin-a"] || null,
    thresholdS: Number(args["threshold-s"]) || 9,
    thresholdA: Number(args["threshold-a"]) || 6,
    dryRun: args["dry-run"] === "true",
  };
}

// ── 배점 SQL ──────────────────────────────────────────────────
// 최대 13점:
//   층수(0~3) + 사진(0~3) + 가성비(0~3) + 방향(0~2) + 건물유형(0~2)
//   반지하/지하(floor<=0), 사진 0장, 가격이상치(구평균150%↑) → 탈락(-99)
const SCORE_QUERY = `
WITH district_avg AS (
  SELECT
    SPLIT_PART(address_text, ' ', 2) AS district,
    AVG(rent_amount / NULLIF(area_exclusive_m2, 0)) AS avg_rpm
  FROM normalized_listings
  WHERE lease_type = '월세' AND deleted_at IS NULL
    AND rent_amount > 0 AND area_exclusive_m2 > 0
  GROUP BY district
),
img_count AS (
  SELECT listing_id, COUNT(*) AS cnt
  FROM listing_images GROUP BY listing_id
),
scored AS (
  SELECT
    n.listing_id,
    -- 층수 0~3 (반지하 → 탈락)
    CASE
      WHEN n.floor IS NOT NULL AND n.floor <= 0 THEN -99
      WHEN n.floor >= 3 THEN 3
      WHEN n.floor = 2  THEN 2
      ELSE 1
    END AS floor_score,
    -- 사진 0~3 (0장 → 탈락)
    CASE
      WHEN COALESCE(img.cnt, 0) = 0 THEN -99
      WHEN img.cnt >= 5 THEN 3
      WHEN img.cnt >= 3 THEN 2
      ELSE 1
    END AS img_score,
    -- 가성비 0~3 (구평균 150%↑ → 탈락)
    CASE
      WHEN n.area_exclusive_m2 IS NULL OR n.area_exclusive_m2 = 0 OR d.avg_rpm IS NULL THEN 1
      WHEN (n.rent_amount / n.area_exclusive_m2) > d.avg_rpm * 1.5 THEN -99
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.avg_rpm * 0.8 THEN 3
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.avg_rpm * 1.0 THEN 2
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.avg_rpm * 1.2 THEN 1
      ELSE 0
    END AS price_score,
    -- 방향 0~2
    CASE
      WHEN n.direction LIKE '%남향%' OR n.direction LIKE '%남동%' THEN 2
      WHEN n.direction LIKE '%동향%' OR n.direction LIKE '%남서%' THEN 1
      ELSE 0
    END AS direction_score,
    -- 건물유형 0~2
    CASE
      WHEN n.building_use IN ('빌라/연립','빌라','연립','아파트','투룸','쓰리룸') THEN 2
      WHEN n.building_use IN ('단독/다가구','다가구','단독') THEN 1
      ELSE 0
    END AS type_score
  FROM normalized_listings n
  LEFT JOIN district_avg d ON SPLIT_PART(n.address_text, ' ', 2) = d.district
  LEFT JOIN img_count img ON img.listing_id = n.listing_id
  WHERE n.lease_type = '월세' AND n.deleted_at IS NULL
)
SELECT
  listing_id,
  floor_score, img_score, price_score, direction_score, type_score,
  (floor_score + img_score + price_score + direction_score + type_score) AS total_score
FROM scored
WHERE floor_score != -99 AND img_score != -99 AND price_score != -99
ORDER BY total_score DESC, listing_id
`;

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (!opts.pinS && !opts.pinA) {
    console.error("오류: --pin-s 또는 --pin-a 중 하나 이상 지정 필요");
    console.error("예시: node scripts/score_and_pin_favorites.mjs --pin-s=1004 --pin-a=1005");
    process.exit(1);
  }

  const pinHashS = opts.pinS ? hashPin(opts.pinS) : null;
  const pinHashA = opts.pinA ? hashPin(opts.pinA) : null;

  console.log("── 매물 배점 시작 ──");
  console.log(`  S급 기준: ${opts.thresholdS}점 이상${opts.pinS ? ` → PIN ${opts.pinS}` : " (건너뜀)"}`);
  console.log(`  A급 기준: ${opts.thresholdA}~${opts.thresholdS - 1}점${opts.pinA ? ` → PIN ${opts.pinA}` : " (건너뜀)"}`);
  if (opts.dryRun) console.log("  [DRY RUN] 저장하지 않고 집계만 수행");

  const result = await withDbClient(async (client) => {
    // 1) 점수 계산
    const { rows } = await client.query(SCORE_QUERY);

    const sGrade = rows.filter((r) => r.total_score >= opts.thresholdS);
    const aGrade = rows.filter((r) => r.total_score >= opts.thresholdA && r.total_score < opts.thresholdS);

    // 점수 분포
    const dist = {};
    for (const r of rows) {
      dist[r.total_score] = (dist[r.total_score] || 0) + 1;
    }

    console.log(`\n── 점수 분포 (총 ${rows.length}개 통과, 탈락 제외) ──`);
    for (const score of Object.keys(dist).sort((a, b) => b - a)) {
      const bar = "█".repeat(Math.ceil(dist[score] / 5));
      console.log(`  ${String(score).padStart(2)}점: ${String(dist[score]).padStart(4)}개 ${bar}`);
    }

    console.log(`\n  S급 (${opts.thresholdS}점↑): ${sGrade.length}개`);
    console.log(`  A급 (${opts.thresholdA}~${opts.thresholdS - 1}점): ${aGrade.length}개`);
    console.log(`  B급 (${opts.thresholdA}점↓): ${rows.length - sGrade.length - aGrade.length}개 (저장 안 함)`);

    if (opts.dryRun) return { sCount: sGrade.length, aCount: aGrade.length, saved: false };

    // 2) 저장
    let sInserted = 0;
    let aInserted = 0;

    if (pinHashS && sGrade.length > 0) {
      const ids = sGrade.map((r) => r.listing_id);
      const res = await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id)
         SELECT $1, UNNEST($2::int[])
         ON CONFLICT DO NOTHING`,
        [pinHashS, ids],
      );
      sInserted = res.rowCount;
    }

    if (pinHashA && aGrade.length > 0) {
      const ids = aGrade.map((r) => r.listing_id);
      const res = await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id)
         SELECT $1, UNNEST($2::int[])
         ON CONFLICT DO NOTHING`,
        [pinHashA, ids],
      );
      aInserted = res.rowCount;
    }

    return { sCount: sInserted, aCount: aInserted, saved: true };
  });

  if (result.saved) {
    console.log(`\n── 저장 완료 ──`);
    if (pinHashS) console.log(`  PIN ${opts.pinS} (S급): ${result.sCount}개 추가`);
    if (pinHashA) console.log(`  PIN ${opts.pinA} (A급): ${result.aCount}개 추가`);
  }
}

main().catch((err) => {
  console.error("오류:", err.message);
  process.exit(1);
});
