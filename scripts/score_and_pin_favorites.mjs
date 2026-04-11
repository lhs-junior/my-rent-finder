#!/usr/bin/env node

// scripts/score_and_pin_favorites.mjs
// 매물을 배점 기준으로 점수 매기고 PIN별 찜 목록에 저장
//
// 사용법:
//   node scripts/score_and_pin_favorites.mjs --pin-ss=1004 --pin-s=1005 --pin-a=1006
//   node scripts/score_and_pin_favorites.mjs --pin-ss=1004             # SS급만
//   node scripts/score_and_pin_favorites.mjs --pin-ss=1004 --dry-run   # 저장 안 하고 집계만
//   node scripts/score_and_pin_favorites.mjs --pin-ss=1004 --threshold-ss=12 --threshold-s=9 --threshold-a=6

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
    pin: args["pin"] || null,        // 단일 PIN으로 모든 등급 저장 (권장)
    pinSS: args["pin-ss"] || null,   // 하위호환: 등급별 별도 PIN
    pinS: args["pin-s"] || null,
    pinA: args["pin-a"] || null,
    thresholdSS: Number(args["threshold-ss"]) || 10,
    thresholdS: Number(args["threshold-s"]) || 9,
    thresholdA: Number(args["threshold-a"]) || 6,
    dryRun: args["dry-run"] === "true",
  };
}

// ── 배점 SQL ──────────────────────────────────────────────────
// 최대 15점:
//   회사거리(0~4) + 지하철거리(0~2) + 면적(0~3) + 연식(0~3) + 층수(0~2) + 사진(0~1)
//
// 탈락(-99) 조건:
//   반지하/지하(floor<=0), 사진 0장, 가격이상치(구평균150%↑),
//   옥탑방(title에 '옥탑' 포함),
//   1룸/원룸/오픈형/쓰리룸 등(title/building_use에 해당 키워드 포함)
//
// 회사: 헤이그라운드 서울숲점 (성동구 왕십리로2길 20)
// 좌표: 37.5451, 127.0443
const OFFICE_LAT = 37.5451;
const OFFICE_LNG = 127.0443;

// 주요 지하철역 좌표 (서울 핵심 노선)
const SUBWAY_STATIONS = [
  // 2호선
  [37.5441, 127.0376, "서울숲(수분당)"],
  [37.5480, 127.0476, "뚝섬"],
  [37.5447, 127.0562, "성수"],
  [37.5614, 127.0385, "왕십리"],
  [37.5552, 127.0449, "한양대"],
  [37.5665, 127.0094, "동대문역사문화공원"],
  [37.5660, 127.0186, "신당"],
  [37.5616, 127.0289, "상왕십리"],
  [37.5551, 126.9376, "신촌"],
  [37.5557, 126.9462, "이대"],
  [37.5585, 126.9642, "충정로"],
  [37.5647, 126.9769, "시청"],
  [37.5498, 126.9149, "합정"],
  [37.5570, 126.9250, "홍대입구"],
  // 5호선
  [37.5614, 127.0473, "마장"],
  [37.5590, 127.0412, "행당"],
  [37.5632, 127.0662, "용답"],
  [37.5610, 127.0787, "군자"],
  // 6호선
  [37.5553, 127.0237, "금호"],
  [37.5559, 127.0139, "약수"],
  [37.5436, 127.0171, "옥수(3호선)"],
  [37.5494, 127.0049, "버티고개"],
  [37.5348, 127.0000, "이태원"],
  // 7호선
  [37.5310, 127.0668, "뚝섬유원지"],
  [37.5487, 127.0734, "어린이대공원"],
  [37.5403, 127.0700, "건대입구"],
  // 경의중앙선
  [37.5522, 127.0261, "응봉"],
  // 3호선
  [37.5274, 127.0280, "압구정"],
  // 분당선
  [37.5166, 127.0472, "강남구청"],
].map(([lat, lng]) => `(${lat}::float, ${lng}::float)`).join(",\n  ");

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
subway_stations(slat, slng) AS (
  VALUES
  ${SUBWAY_STATIONS}
),
min_subway_dist AS (
  SELECT
    n.listing_id,
    MIN(6371 * acos(LEAST(1.0,
      cos(radians(s.slat)) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(s.slng)) +
      sin(radians(s.slat)) * sin(radians(n.lat))
    ))) AS min_km
  FROM normalized_listings n
  CROSS JOIN subway_stations s
  WHERE n.lat IS NOT NULL AND n.lng IS NOT NULL
    AND n.lease_type = '월세' AND n.deleted_at IS NULL
  GROUP BY n.listing_id
),
scored AS (
  SELECT
    n.listing_id,

    -- ① 탈락: 반지하/지하, 옥탑, 1룸/원룸/오픈형, 사진없음, 가격이상치
    CASE
      WHEN n.floor IS NOT NULL AND n.floor <= 0 THEN -99  -- 반지하/지하
      WHEN n.title ILIKE '%옥탑%' OR n.building_use ILIKE '%옥탑%' THEN -99  -- 옥탑방
      WHEN n.building_use ILIKE '%근린생활%' OR n.building_use ILIKE '%제1종%' OR n.building_use ILIKE '%제2종%' THEN -99  -- 근린생활시설
      WHEN n.building_use ILIKE '%상가주택%' THEN -99  -- 상가주택 (1층 상가)
      WHEN n.title ILIKE '%전입불가%' OR n.title ILIKE '%전입신고%불%'
        OR n.description_text ILIKE '%전입불가%' OR n.description_text ILIKE '%전입신고%불%' THEN -99  -- 전입신고 불가
      WHEN n.title ILIKE '%원룸%' OR n.title ILIKE '%오픈형%'
        OR n.title ILIKE '%1룸%' OR n.title ILIKE '%쓰리룸%' OR n.title ILIKE '%3룸%'
        OR n.building_use ILIKE '%원룸%' OR n.building_use ILIKE '%오픈%원룸%'
        OR n.building_use ILIKE '%1룸%' THEN -99  -- 1룸/원룸/오픈형
      WHEN n.room_count IS NOT NULL AND n.room_count <= 1 THEN -99  -- 1룸/원룸 (2인 거주 불가)
      WHEN COALESCE(img.cnt, 0) = 0 THEN -99  -- 사진없음
      WHEN n.area_exclusive_m2 > 0 AND d.avg_rpm IS NOT NULL
        AND (n.rent_amount / n.area_exclusive_m2) > d.avg_rpm * 1.5 THEN -99  -- 가격이상치
      ELSE 0
    END AS eliminate,

    -- ② 회사 거리 0~4점 (헤이그라운드 서울숲점 기준, 완화됨)
    CASE
      WHEN n.lat IS NULL OR n.lng IS NULL THEN 0  -- 좌표 없으면 0점
      ELSE
        CASE
          WHEN (6371 * acos(LEAST(1.0,
            cos(radians(${OFFICE_LAT})) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(${OFFICE_LNG})) +
            sin(radians(${OFFICE_LAT})) * sin(radians(n.lat))
          ))) <= 3.0 THEN 4
          WHEN (6371 * acos(LEAST(1.0,
            cos(radians(${OFFICE_LAT})) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(${OFFICE_LNG})) +
            sin(radians(${OFFICE_LAT})) * sin(radians(n.lat))
          ))) <= 5.0 THEN 3
          WHEN (6371 * acos(LEAST(1.0,
            cos(radians(${OFFICE_LAT})) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(${OFFICE_LNG})) +
            sin(radians(${OFFICE_LAT})) * sin(radians(n.lat))
          ))) <= 7.0 THEN 2
          WHEN (6371 * acos(LEAST(1.0,
            cos(radians(${OFFICE_LAT})) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(${OFFICE_LNG})) +
            sin(radians(${OFFICE_LAT})) * sin(radians(n.lat))
          ))) <= 10.0 THEN 1
          ELSE 0
        END
    END AS dist_score,

    -- ③ 지하철 거리 0~2점
    CASE
      WHEN n.lat IS NULL OR n.lng IS NULL THEN 0
      WHEN COALESCE(sub.min_km, 999) <= 0.4 THEN 2
      WHEN COALESCE(sub.min_km, 999) <= 0.7 THEN 1
      ELSE 0
    END AS subway_score,

    -- ④ 면적 0~3점
    CASE
      WHEN COALESCE(n.area_exclusive_m2, n.area_gross_m2) >= 50 THEN 3
      WHEN COALESCE(n.area_exclusive_m2, n.area_gross_m2) >= 40 THEN 2
      WHEN COALESCE(n.area_exclusive_m2, n.area_gross_m2) >= 33 THEN 1
      ELSE 0
    END AS area_score,

    -- ⑤ 연식 0~3점 (building_year: 사용승인일 4자리 년도)
    CASE
      WHEN n.building_year IS NULL THEN 0  -- 연식 불명이면 0점 (패널티)
      WHEN n.building_year >= 2015 THEN 3
      WHEN n.building_year >= 2010 THEN 2
      WHEN n.building_year >= 2005 THEN 1
      ELSE 0
    END AS year_score,

    -- ⑥ 층수 0~2점
    CASE
      WHEN n.floor IS NULL THEN 1
      WHEN n.floor >= 3 THEN 2
      WHEN n.floor = 2  THEN 1
      ELSE 0
    END AS floor_score,

    -- ⑦ 사진 0~1점
    CASE
      WHEN COALESCE(img.cnt, 0) >= 5 THEN 1
      ELSE 0
    END AS img_score

  FROM normalized_listings n
  LEFT JOIN district_avg d ON SPLIT_PART(n.address_text, ' ', 2) = d.district
  LEFT JOIN img_count img ON img.listing_id = n.listing_id
  LEFT JOIN min_subway_dist sub ON sub.listing_id = n.listing_id
  WHERE n.lease_type = '월세' AND n.deleted_at IS NULL
    AND (n.building_use IS NULL OR n.building_use NOT IN
      ('사무실','오피스텔','상가','공장','창고','토지','주차장','매장','작업실','건물','기타',
       '제1종근린생활시설','제2종근린생활시설','근린생활시설','상가주택'))
),
ranked AS (
  SELECT
    s.listing_id,
    s.eliminate, s.dist_score, s.subway_score, s.area_score, s.year_score, s.floor_score, s.img_score,
    (s.dist_score + s.subway_score + s.area_score + s.year_score + s.floor_score + s.img_score) AS total_score,
    -- 중복 제거: 100m이내 + 같은 월세 → 점수 높은 것만 유지
    ROW_NUMBER() OVER (
      PARTITION BY ROUND(n.lat::numeric, 3), ROUND(n.lng::numeric, 3), n.rent_amount
      ORDER BY (s.dist_score + s.subway_score + s.area_score + s.year_score + s.floor_score + s.img_score) DESC,
               n.room_count DESC NULLS LAST, n.listing_id
    ) AS dup_rank
  FROM scored s
  JOIN normalized_listings n ON n.listing_id = s.listing_id
  WHERE s.eliminate != -99
)
SELECT
  listing_id,
  eliminate, dist_score, subway_score, area_score, year_score, floor_score, img_score,
  total_score
FROM ranked
WHERE dup_rank = 1
ORDER BY total_score DESC, listing_id
`;

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (!opts.pin && !opts.pinSS && !opts.pinS && !opts.pinA) {
    console.error("오류: --pin 또는 --pin-ss/--pin-s/--pin-a 중 하나 이상 지정 필요");
    console.error("예시(단일 PIN): node scripts/score_and_pin_favorites.mjs --pin=1004");
    console.error("예시(분리 PIN): node scripts/score_and_pin_favorites.mjs --pin-ss=1004 --pin-s=1005 --pin-a=1006");
    process.exit(1);
  }

  const pinHash = opts.pin ? hashPin(opts.pin) : null;
  const pinHashSS = opts.pinSS ? hashPin(opts.pinSS) : null;
  const pinHashS = opts.pinS ? hashPin(opts.pinS) : null;
  const pinHashA = opts.pinA ? hashPin(opts.pinA) : null;

  console.log("── 매물 배점 시작 ──");
  if (pinHash) {
    console.log(`  단일 PIN 모드: PIN ${opts.pin} 에 SS/S/A 모두 저장`);
  }
  console.log(`  SS급 기준: ${opts.thresholdSS}점 이상${opts.pinSS ? ` → PIN ${opts.pinSS}` : pinHash ? ` → PIN ${opts.pin}` : " (건너뜀)"}`);
  console.log(`  S급 기준: ${opts.thresholdS}~${opts.thresholdSS - 1}점${opts.pinS ? ` → PIN ${opts.pinS}` : pinHash ? ` → PIN ${opts.pin}` : " (건너뜀)"}`);
  console.log(`  A급 기준: ${opts.thresholdA}~${opts.thresholdS - 1}점${opts.pinA ? ` → PIN ${opts.pinA}` : pinHash ? ` → PIN ${opts.pin}` : " (건너뜀)"}`);
  if (opts.dryRun) console.log("  [DRY RUN] 저장하지 않고 집계만 수행");

  const result = await withDbClient(async (client) => {
    // 1) 점수 계산
    const { rows } = await client.query(SCORE_QUERY);

    const ssGrade = rows.filter((r) => r.total_score >= opts.thresholdSS);
    const sGrade = rows.filter((r) => r.total_score >= opts.thresholdS && r.total_score < opts.thresholdSS);
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

    console.log(`\n  SS급 (${opts.thresholdSS}점↑): ${ssGrade.length}개`);
    console.log(`  S급 (${opts.thresholdS}~${opts.thresholdSS - 1}점): ${sGrade.length}개`);
    console.log(`  A급 (${opts.thresholdA}~${opts.thresholdS - 1}점): ${aGrade.length}개`);
    console.log(`  B급 (${opts.thresholdA}점↓): ${rows.length - ssGrade.length - sGrade.length - aGrade.length}개 (저장 안 함)`);

    if (opts.dryRun) return { ssCount: ssGrade.length, sCount: sGrade.length, aCount: aGrade.length, saved: false };

    // 2) 저장
    let ssInserted = 0;
    let sInserted = 0;
    let aInserted = 0;

    // 단일 PIN 모드: 모든 등급을 하나의 PIN에 저장
    if (pinHash) {
      const allGrades = [
        ...ssGrade.map((r) => ({ id: r.listing_id, grade: "SS" })),
        ...sGrade.map((r) => ({ id: r.listing_id, grade: "S" })),
        ...aGrade.map((r) => ({ id: r.listing_id, grade: "A" })),
      ];
      if (allGrades.length > 0) {
        const ids = allGrades.map((g) => g.id);
        const grades = allGrades.map((g) => g.grade);
        await client.query(
          `INSERT INTO pin_favorites (pin_hash, listing_id, grade)
           SELECT $1, UNNEST($2::int[]), UNNEST($3::text[])
           ON CONFLICT (pin_hash, listing_id) DO UPDATE SET grade = EXCLUDED.grade`,
          [pinHash, ids, grades],
        );
        ssInserted = ssGrade.length;
        sInserted = sGrade.length;
        aInserted = aGrade.length;
      }
    }

    // 분리 PIN 모드 (하위호환)
    if (pinHashSS && ssGrade.length > 0) {
      const ids = ssGrade.map((r) => r.listing_id);
      const res = await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id, grade)
         SELECT $1, UNNEST($2::int[]), 'SS'
         ON CONFLICT (pin_hash, listing_id) DO UPDATE SET grade = 'SS'`,
        [pinHashSS, ids],
      );
      ssInserted = res.rowCount;
    }

    if (pinHashS && sGrade.length > 0) {
      const ids = sGrade.map((r) => r.listing_id);
      const res = await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id, grade)
         SELECT $1, UNNEST($2::int[]), 'S'
         ON CONFLICT (pin_hash, listing_id) DO UPDATE SET grade = 'S'`,
        [pinHashS, ids],
      );
      sInserted = res.rowCount;
    }

    if (pinHashA && aGrade.length > 0) {
      const ids = aGrade.map((r) => r.listing_id);
      const res = await client.query(
        `INSERT INTO pin_favorites (pin_hash, listing_id, grade)
         SELECT $1, UNNEST($2::int[]), 'A'
         ON CONFLICT (pin_hash, listing_id) DO UPDATE SET grade = 'A'`,
        [pinHashA, ids],
      );
      aInserted = res.rowCount;
    }

    // 3) 정리: 해당 pin에서 삭제된 매물 및 점수 미달 매물 제거
    const allSelectedIds = [
      ...ssGrade.map((r) => r.listing_id),
      ...sGrade.map((r) => r.listing_id),
      ...aGrade.map((r) => r.listing_id),
    ];

    const pinsToClean = [pinHash, pinHashSS, pinHashS, pinHashA].filter(Boolean);
    let cleanedCount = 0;
    for (const ph of pinsToClean) {
      // deleted 매물 제거
      const r1 = await client.query(
        `DELETE FROM pin_favorites pf
         USING normalized_listings nl
         WHERE pf.pin_hash = $1
           AND pf.listing_id = nl.listing_id
           AND nl.deleted_at IS NOT NULL`,
        [ph],
      );
      cleanedCount += r1.rowCount;

      // 점수 미달 매물 제거 (현재 선정된 목록에 없는 것)
      if (allSelectedIds.length > 0) {
        const r2 = await client.query(
          `DELETE FROM pin_favorites
           WHERE pin_hash = $1
             AND listing_id NOT IN (SELECT UNNEST($2::int[]))`,
          [ph, allSelectedIds],
        );
        cleanedCount += r2.rowCount;
      }
    }

    if (cleanedCount > 0) {
      console.log(`\n  정리: 삭제/탈락 매물 ${cleanedCount}개 pin_favorites에서 제거`);
    }

    return { ssCount: ssInserted, sCount: sInserted, aCount: aInserted, saved: true };
  });

  if (result.saved) {
    console.log(`\n── 저장 완료 ──`);
    if (pinHashSS) console.log(`  PIN ${opts.pinSS} (SS급): ${result.ssCount}개 추가`);
    if (pinHashS) console.log(`  PIN ${opts.pinS} (S급): ${result.sCount}개 추가`);
    if (pinHashA) console.log(`  PIN ${opts.pinA} (A급): ${result.aCount}개 추가`);
  }
}

main().catch((err) => {
  console.error("오류:", err.message);
  process.exit(1);
});
