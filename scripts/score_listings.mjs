#!/usr/bin/env node

// scripts/score_listings.mjs
// 매물을 배점 기준으로 점수 매기고 scored_listings 테이블에 저장
// pin_favorites(유저 수동 찜)와 완전 분리
//
// v3: 가성비(RPM) 중심 + 환승 기반 + 데이터 정제 + 실질 월비용
//
// 사용법:
//   node scripts/score_listings.mjs
//   node scripts/score_listings.mjs --max-rent=80
//   node scripts/score_listings.mjs --interest-rate=0.04
//   node scripts/score_listings.mjs --dry-run
//   node scripts/score_listings.mjs --threshold-ss=12 --threshold-s=10 --threshold-a=8

import { withDbClient } from "./lib/db_client.mjs";

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
    thresholdSS: Number(args["threshold-ss"]) || 12,
    thresholdS: Number(args["threshold-s"]) || 10,
    thresholdA: Number(args["threshold-a"]) || 8,
    maxRent: args["max-rent"] ? Number(args["max-rent"]) : null,
    interestRate: Number(args["interest-rate"]) || 0.04,
    dryRun: args["dry-run"] === "true",
  };
}

// ── 지하철역 (환승 횟수 태깅) ────────────────────────────────
// 기준: 서울숲역(수인분당선) / 뚝섬역(2호선)
//   0환승 = 2호선·수인분당선 (직통)
//   1환승 = 2호선 환승역 경유 1회 (1·3·4·5·6·7호선, 경의중앙선)
//   2환승 = 2회 환승 필요 (우이신설선 등)
const SUBWAY_STATIONS = [
  // ── 직통 (0환승): 2호선 ──
  [37.5441, 127.0376, 0], // 서울숲(수인분당)
  [37.5480, 127.0476, 0], // 뚝섬
  [37.5447, 127.0562, 0], // 성수
  [37.5614, 127.0385, 0], // 왕십리
  [37.5552, 127.0449, 0], // 한양대
  [37.5665, 127.0094, 0], // 동대문역사문화공원
  [37.5660, 127.0186, 0], // 신당
  [37.5616, 127.0289, 0], // 상왕십리
  [37.5750, 127.0250, 0], // 신설동(1/2호선)
  [37.5632, 127.0662, 0], // 용답
  [37.5403, 127.0700, 0], // 건대입구(2/7호선)
  [37.5551, 126.9376, 0], // 신촌
  [37.5557, 126.9462, 0], // 이대
  [37.5585, 126.9642, 0], // 충정로
  [37.5647, 126.9769, 0], // 시청(1/2호선)
  [37.5498, 126.9149, 0], // 합정(2/6호선)
  [37.5570, 126.9250, 0], // 홍대입구
  // 직통: 수인분당선
  [37.5166, 127.0472, 0], // 강남구청(수인분당/7호선)
  [37.5805, 127.0470, 0], // 청량리(1/경의중앙/수인분당)

  // ── 1환승: 5호선 (via 왕십리) ──
  [37.5650, 127.0530, 1], // 답십리
  [37.5614, 127.0473, 1], // 마장
  [37.5590, 127.0412, 1], // 행당
  [37.5610, 127.0640, 1], // 장한평
  [37.5610, 127.0787, 1], // 군자(5/7호선)

  // ── 1환승: 6호선 (via 신당·합정) ──
  [37.5553, 127.0237, 1], // 금호
  [37.5559, 127.0139, 1], // 약수
  [37.5494, 127.0049, 1], // 버티고개
  [37.5348, 127.0000, 1], // 이태원
  [37.5723, 127.0165, 1], // 동묘앞(1/6호선)
  [37.5800, 127.0190, 1], // 보문
  [37.5875, 127.0150, 1], // 안암
  [37.5930, 127.0180, 1], // 고려대
  [37.6015, 127.0250, 1], // 월곡
  [37.6100, 127.0190, 1], // 상월곡
  [37.6100, 127.0350, 1], // 돌곶이
  [37.6190, 127.0410, 1], // 석계(1/6호선)
  [37.6240, 127.0480, 1], // 태릉입구(6/7호선)

  // ── 1환승: 7호선 (via 건대입구) ──
  [37.5310, 127.0668, 1], // 뚝섬유원지
  [37.5487, 127.0734, 1], // 어린이대공원
  [37.5570, 127.0800, 1], // 중곡
  [37.5640, 127.0870, 1], // 용마산
  [37.5720, 127.0930, 1], // 사가정
  [37.5800, 127.0870, 1], // 면목
  [37.5960, 127.0850, 1], // 상봉(7/경의중앙)
  [37.6030, 127.0840, 1], // 중화
  [37.6100, 127.0770, 1], // 먹골
  [37.6170, 127.0740, 1], // 하계
  [37.6240, 127.0620, 1], // 중계
  [37.6320, 127.0580, 1], // 노원
  [37.6380, 127.0540, 1], // 마들

  // ── 1환승: 4호선 (via 동대문역사문화공원) ──
  [37.5710, 127.0100, 1], // 동대문(1/4호선)
  [37.5820, 127.0015, 1], // 혜화
  [37.5880, 127.0060, 1], // 한성대입구
  [37.5950, 127.0170, 1], // 성신여대입구
  [37.6020, 127.0250, 1], // 길음
  [37.6130, 127.0300, 1], // 미아사거리
  [37.6210, 127.0300, 1], // 미아
  [37.6380, 127.0250, 1], // 수유
  [37.6480, 127.0340, 1], // 쌍문
  [37.6530, 127.0470, 1], // 창동(1/4호선)

  // ── 1환승: 1호선 (via 시청·동대문역사) ──
  [37.5700, 127.0380, 1], // 제기동
  [37.5895, 127.0580, 1], // 회기(1/경의중앙)
  [37.5960, 127.0580, 1], // 외대앞
  [37.6010, 127.0650, 1], // 신이문
  [37.6120, 127.0730, 1], // 광운대
  [37.6210, 127.0770, 1], // 월계
  [37.6320, 127.0480, 1], // 녹천
  [37.6400, 127.0560, 1], // 도봉
  [37.6490, 127.0440, 1], // 도봉산(1/7호선)
  [37.6540, 127.0560, 1], // 방학

  // ── 1환승: 경의중앙선 (via 왕십리) ──
  [37.5522, 127.0261, 1], // 응봉
  [37.5880, 127.0600, 1], // 중랑
  [37.5960, 127.0855, 1], // 망우

  // ── 1환승: 3호선 (via 을지로3가) ──
  [37.5274, 127.0280, 1], // 압구정
  [37.5436, 127.0171, 1], // 옥수(3/경의중앙)

  // ── 2환승: 우이신설선 (via 4호선 성신여대→우이신설) ──
  [37.6030, 127.0130, 2], // 보문(우이신설/6호선)
  [37.6120, 127.0110, 2], // 정릉
  [37.6240, 127.0120, 2], // 북한산보국문
  [37.6450, 127.0120, 2], // 솔밭공원
  [37.6550, 127.0130, 2], // 4·19민주묘지
].map(([lat, lng, t]) => `(${lat}::float, ${lng}::float, ${t}::int)`).join(",\n  ");

// ── 배점 SQL ──────────────────────────────────────────────────
// 최대 16점:
//   가성비RPM(0~4) + 지하철근접(0~3) + 환승(0~3) + 면적(0~2) + 층수(0~2) + 연식(0~1) + 사진(0~1)
//
// 탈락(-99) 조건:
//   반지하/지하, 옥탑, 1룸/원룸, 사진0장, 근린생활시설, 전입불가,
//   RPM<0.8(데이터오류), --max-rent 초과
// price_outlier 플래그: RPM > 구별평균*1.5 → quality_flags에 기록 (탈락 아님)
function buildScoreQuery(maxRent) {
  const maxRentClause = maxRent
    ? `WHEN n.rent_amount > ${Number(maxRent)} THEN -99  -- 예산 초과`
    : "";

  return `
WITH district_rpm AS (
  SELECT
    district,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY rpm) AS p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY rpm) AS p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY rpm) AS p75,
    AVG(rpm) AS avg_rpm
  FROM (
    SELECT SPLIT_PART(address_text, ' ', 2) AS district,
           rent_amount / NULLIF(area_exclusive_m2, 0) AS rpm
    FROM normalized_listings
    WHERE lease_type = '월세' AND deleted_at IS NULL
      AND rent_amount > 0 AND area_exclusive_m2 > 0
  ) t
  GROUP BY district
),
img_count AS (
  SELECT listing_id, COUNT(*) AS cnt
  FROM listing_images GROUP BY listing_id
),
subway_stations(slat, slng, transfers) AS (
  VALUES
  ${SUBWAY_STATIONS}
),
nearest_subway AS (
  SELECT DISTINCT ON (n.listing_id)
    n.listing_id,
    6371 * acos(LEAST(1.0,
      cos(radians(s.slat)) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(s.slng)) +
      sin(radians(s.slat)) * sin(radians(n.lat))
    )) AS dist_km
  FROM normalized_listings n
  CROSS JOIN subway_stations s
  WHERE n.lat IS NOT NULL AND n.lng IS NOT NULL
    AND n.lease_type = '월세' AND n.deleted_at IS NULL
  ORDER BY n.listing_id,
    6371 * acos(LEAST(1.0,
      cos(radians(s.slat)) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(s.slng)) +
      sin(radians(s.slat)) * sin(radians(n.lat))
    ))
),
best_transfer AS (
  SELECT n.listing_id, MIN(s.transfers) AS min_transfers
  FROM normalized_listings n
  CROSS JOIN subway_stations s
  WHERE n.lat IS NOT NULL AND n.lng IS NOT NULL
    AND n.lease_type = '월세' AND n.deleted_at IS NULL
    AND 6371 * acos(LEAST(1.0,
      cos(radians(s.slat)) * cos(radians(n.lat)) * cos(radians(n.lng) - radians(s.slng)) +
      sin(radians(s.slat)) * sin(radians(n.lat))
    )) <= 1.0
  GROUP BY n.listing_id
),
scored AS (
  SELECT
    n.listing_id,
    n.rent_amount,
    n.deposit_amount,

    -- ① 탈락 판정
    CASE
      WHEN n.floor IS NOT NULL AND n.floor <= 0 THEN -99  -- 반지하/지하 (floor 값 있는 경우)
      WHEN n.title ILIKE '%반지하%' OR n.description_text ILIKE '%반지하%' THEN -99  -- 반지하 (floor=NULL이어도 탈락)
      WHEN n.title ILIKE '%옥탑%' OR n.building_use ILIKE '%옥탑%' THEN -99
      WHEN n.building_use ILIKE '%근린생활%' OR n.building_use ILIKE '%제1종%' OR n.building_use ILIKE '%제2종%' THEN -99
      WHEN n.building_use ILIKE '%상가주택%' THEN -99
      WHEN n.title ILIKE '%전입불가%' OR n.title ILIKE '%전입신고%불%'
        OR n.description_text ILIKE '%전입불가%' OR n.description_text ILIKE '%전입신고%불%' THEN -99
      WHEN n.title ILIKE '%원룸%' OR n.title ILIKE '%오픈형%'
        OR n.title ILIKE '%1룸%' OR n.title ILIKE '%쓰리룸%' OR n.title ILIKE '%3룸%'
        OR n.building_use ILIKE '%원룸%' OR n.building_use ILIKE '%오픈%원룸%'
        OR n.building_use ILIKE '%1룸%' THEN -99
      WHEN n.room_count IS NOT NULL AND n.room_count <= 1 THEN -99
      WHEN COALESCE(img.cnt, 0) = 0 THEN -99  -- 사진없음
      -- 데이터 정제
      WHEN n.area_exclusive_m2 > 0 AND n.rent_amount > 0
        AND (n.rent_amount / n.area_exclusive_m2) < 0.8 THEN -99  -- RPM 이상치 (데이터 오류)
      ${maxRentClause}
      ELSE 0
    END AS eliminate,

    -- ② 가성비 RPM 0~4점 (구별 m²당 월세 순위, 낮을수록 좋음)
    CASE
      WHEN n.rent_amount <= 0 OR n.area_exclusive_m2 <= 0 OR d.p25 IS NULL THEN 0
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.p25 THEN 4
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.p50 THEN 3
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.p75 THEN 2
      WHEN (n.rent_amount / n.area_exclusive_m2) <= d.avg_rpm THEN 1
      ELSE 0
    END AS rpm_score,

    -- ③ 지하철 근접 0~3점
    CASE
      WHEN n.lat IS NULL OR n.lng IS NULL THEN 0
      WHEN COALESCE(sub.dist_km, 999) <= 0.3 THEN 3
      WHEN COALESCE(sub.dist_km, 999) <= 0.5 THEN 2
      WHEN COALESCE(sub.dist_km, 999) <= 0.7 THEN 1
      ELSE 0
    END AS subway_score,

    -- ④ 환승 횟수 0~3점 (서울숲/뚝섬 기준, 1km 이내 최적 역)
    CASE
      WHEN n.lat IS NULL OR n.lng IS NULL THEN 0
      WHEN bt.min_transfers IS NULL THEN 0  -- 1km 이내 역 없음
      WHEN bt.min_transfers = 0 THEN 3  -- 직통 (2호선·수인분당)
      WHEN bt.min_transfers = 1 THEN 2  -- 1환승
      WHEN bt.min_transfers = 2 THEN 1  -- 2환승
      ELSE 0  -- 3환승+
    END AS transfer_score,

    -- ⑤ 면적 0~2점
    CASE
      WHEN COALESCE(n.area_exclusive_m2, n.area_gross_m2) >= 45 THEN 2
      WHEN COALESCE(n.area_exclusive_m2, n.area_gross_m2) >= 33 THEN 1
      ELSE 0
    END AS area_score,

    -- ⑥ 층수 0~2점
    CASE
      WHEN n.floor IS NULL THEN 1
      WHEN n.floor >= 3 THEN 2
      WHEN n.floor = 2  THEN 1
      ELSE 0
    END AS floor_score,

    -- ⑦ 연식 0~1점 (null = 중립 1점, 2005년 이후 = 1점)
    CASE
      WHEN n.building_year IS NULL THEN 1
      WHEN n.building_year >= 2005 THEN 1
      ELSE 0
    END AS year_score,

    -- ⑧ 사진 0~1점
    CASE
      WHEN COALESCE(img.cnt, 0) >= 5 THEN 1
      ELSE 0
    END AS img_score

  FROM normalized_listings n
  LEFT JOIN district_rpm d ON SPLIT_PART(n.address_text, ' ', 2) = d.district
  LEFT JOIN img_count img ON img.listing_id = n.listing_id
  LEFT JOIN nearest_subway sub ON sub.listing_id = n.listing_id
  LEFT JOIN best_transfer bt ON bt.listing_id = n.listing_id
  WHERE n.lease_type = '월세' AND n.deleted_at IS NULL
    AND (n.building_use IS NULL OR n.building_use NOT IN
      ('사무실','오피스텔','상가','공장','창고','토지','주차장','매장','작업실','건물','기타',
       '제1종근린생활시설','제2종근린생활시설','근린생활시설','상가주택'))
),
-- 교차 플랫폼 중복 제거: serve.cross_ref = naver.external_id → naver 쪽 제외
cross_ref_dupes AS (
  SELECT nv.listing_id AS naver_listing_id
  FROM normalized_listings sv
  JOIN normalized_listings nv
    ON sv.cross_ref = nv.external_id
    AND nv.platform_code = 'naver'
    AND nv.deleted_at IS NULL
  WHERE sv.platform_code = 'serve'
    AND sv.cross_ref IS NOT NULL
    AND sv.deleted_at IS NULL
),
ranked AS (
  SELECT
    s.listing_id, s.rent_amount, s.deposit_amount,
    s.eliminate, s.rpm_score, s.subway_score, s.transfer_score,
    s.area_score, s.floor_score, s.year_score, s.img_score,
    (s.rpm_score + s.subway_score + s.transfer_score + s.area_score + s.floor_score + s.year_score + s.img_score) AS total_score,
    ROW_NUMBER() OVER (
      PARTITION BY ROUND(n.lat::numeric, 3), ROUND(n.lng::numeric, 3), n.rent_amount
      ORDER BY (s.rpm_score + s.subway_score + s.transfer_score + s.area_score + s.floor_score + s.year_score + s.img_score) DESC,
               n.room_count DESC NULLS LAST, n.listing_id
    ) AS dup_rank
  FROM scored s
  JOIN normalized_listings n ON n.listing_id = s.listing_id
  LEFT JOIN cross_ref_dupes crd ON crd.naver_listing_id = s.listing_id
  WHERE s.eliminate != -99
    AND crd.naver_listing_id IS NULL  -- naver 중복 매물 제외 (serve에 같은 매물 있음)
)
SELECT
  listing_id, rent_amount, deposit_amount,
  eliminate, rpm_score, subway_score, transfer_score, area_score, floor_score, year_score, img_score,
  total_score
FROM ranked
WHERE dup_rank = 1
ORDER BY total_score DESC, listing_id
`;
}

// ── 메인 ──────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log("── 매물 배점 v3 시작 (가성비+환승 기반, scored_listings 저장) ──");
  if (opts.maxRent) console.log(`  월세 상한: ${opts.maxRent}만원`);
  console.log(`  이자율: ${(opts.interestRate * 100).toFixed(1)}% (실질 월비용 계산용)`);
  console.log(`  SS급 기준: ${opts.thresholdSS}점 이상`);
  console.log(`  S급 기준: ${opts.thresholdS}~${opts.thresholdSS - 1}점`);
  console.log(`  A급 기준: ${opts.thresholdA}~${opts.thresholdS - 1}점`);
  if (opts.dryRun) console.log("  [DRY RUN] 저장하지 않고 집계만 수행");

  const scoreQuery = buildScoreQuery(opts.maxRent);

  const result = await withDbClient(async (client) => {
    // 1) 점수 계산
    const { rows } = await client.query(scoreQuery);

    // 등급 분류
    const graded = rows.map((r) => {
      let grade;
      if (r.total_score >= opts.thresholdSS) grade = "SS";
      else if (r.total_score >= opts.thresholdS) grade = "S";
      else if (r.total_score >= opts.thresholdA) grade = "A";
      else return null; // A 미만 탈락 — 저장 불필요

      // 실질 월비용 = 월세 + (보증금 × 연이율 / 12)
      const effectiveMonthlyCost = r.deposit_amount > 0
        ? Math.round(r.rent_amount + (r.deposit_amount * opts.interestRate / 12))
        : r.rent_amount;

      return { ...r, grade, effectiveMonthlyCost };
    }).filter(Boolean);

    const ssGrade = graded.filter((r) => r.grade === "SS");
    const sGrade = graded.filter((r) => r.grade === "S");
    const aGrade = graded.filter((r) => r.grade === "A");

    // 점수 분포
    const dist = {};
    for (const r of graded) {
      dist[r.total_score] = (dist[r.total_score] || 0) + 1;
    }

    console.log(`\n── 점수 분포 (총 ${graded.length}개 통과, 탈락 제외) ──`);
    console.log("  배점: 가성비(0~4) + 지하철(0~3) + 환승(0~3) + 면적(0~2) + 층수(0~2) + 연식(0~1) + 사진(0~1) = 최대16점");
    for (const score of Object.keys(dist).sort((a, b) => b - a)) {
      const bar = "█".repeat(Math.ceil(dist[score] / 5));
      console.log(`  ${String(score).padStart(2)}점: ${String(dist[score]).padStart(4)}개 ${bar}`);
    }

    console.log(`\n  SS급 (${opts.thresholdSS}점↑): ${ssGrade.length}개`);
    console.log(`  S급 (${opts.thresholdS}~${opts.thresholdSS - 1}점): ${sGrade.length}개`);
    console.log(`  A급 (${opts.thresholdA}~${opts.thresholdS - 1}점): ${aGrade.length}개`);

    // 상위 매물 미리보기 (SS급 상위 5개)
    if (ssGrade.length > 0) {
      const topIds = ssGrade.slice(0, 5).map((r) => r.listing_id);
      const preview = await client.query(
        `SELECT n.listing_id, n.rent_amount, n.deposit_amount, n.area_exclusive_m2,
                n.room_count, n.floor, n.address_text
         FROM normalized_listings n WHERE n.listing_id = ANY($1)`,
        [topIds],
      );
      console.log("\n  ── SS급 상위 미리보기 ──");
      for (const p of preview.rows) {
        const s = ssGrade.find((r) => r.listing_id === p.listing_id);
        console.log(`    ${p.rent_amount}만/${p.deposit_amount}보 ${p.area_exclusive_m2}m² ${p.room_count}룸 ${p.floor}층 (실질 ${s.effectiveMonthlyCost}만/월) | rpm=${s.rpm_score} 지하철=${s.subway_score} 환승=${s.transfer_score} 면적=${s.area_score} 층=${s.floor_score} 연식=${s.year_score} 사진=${s.img_score} → ${s.total_score}점 | ${(p.address_text || "").substring(0, 30)}`);
      }
    }

    if (opts.dryRun) return { total: rows.length, ssCount: ssGrade.length, sCount: sGrade.length, aCount: aGrade.length, saved: false };

    // 2) scored_listings 전체 갱신 — 트랜잭션으로 원자성 보장
    // BEGIN/COMMIT: DELETE + INSERT를 하나의 트랜잭션으로 묶어 FK 위반 방지
    // INSERT ... JOIN normalized_listings: SELECT~INSERT 사이에 하드 DELETE된 listing_id를 안전하게 스킵
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM scored_listings");

      let insertedCount = 0;
      if (graded.length > 0) {
        const values = graded.map((r) =>
          `(${r.listing_id}, ${r.total_score}, '${r.grade}', ${r.rpm_score}, ${r.subway_score}, ${r.transfer_score}, ${r.area_score}, ${r.floor_score}, ${r.year_score}, ${r.img_score}, ${r.effectiveMonthlyCost})`
        ).join(",\n");

        const result = await client.query(`
          WITH vals (listing_id, total_score, grade, rpm_score, subway_score, transfer_score, area_score, floor_score, year_score, img_score, effective_monthly_cost) AS (
            VALUES ${values}
          )
          INSERT INTO scored_listings
            (listing_id, total_score, grade, rpm_score, subway_score, transfer_score, area_score, floor_score, year_score, img_score, effective_monthly_cost, scored_at)
          SELECT v.listing_id::integer, v.total_score::smallint, v.grade,
                 v.rpm_score::smallint, v.subway_score::smallint, v.transfer_score::smallint,
                 v.area_score::smallint, v.floor_score::smallint, v.year_score::smallint,
                 v.img_score::smallint, v.effective_monthly_cost::integer, NOW()
          FROM vals v
          JOIN normalized_listings nl ON nl.listing_id = v.listing_id::integer
        `);
        insertedCount = result.rowCount ?? 0;
        if (insertedCount < graded.length) {
          console.warn(`  [경고] 배점 대상 ${graded.length}개 중 ${insertedCount}개만 저장 (${graded.length - insertedCount}개 listing_id가 수집 중 삭제됨)`);
        }
      }

      await client.query("COMMIT");
      console.log(`\n── scored_listings 저장 완료: ${graded.length}개 ──`);
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    }

    // 3) price_outlier quality_flag 갱신 (구별 평균 RPM 1.5배 초과 매물)
    const priceOutlierCte = `
      WITH district_rpm AS (
        SELECT SPLIT_PART(address_text, ' ', 2) AS district,
               AVG(rent_amount / NULLIF(area_exclusive_m2, 0)) AS avg_rpm
        FROM normalized_listings
        WHERE lease_type = '월세' AND deleted_at IS NULL
          AND rent_amount > 0 AND area_exclusive_m2 > 0
        GROUP BY 1
      ),
      outliers AS (
        SELECT nl.listing_id
        FROM normalized_listings nl
        JOIN district_rpm d ON SPLIT_PART(nl.address_text, ' ', 2) = d.district
        WHERE nl.deleted_at IS NULL
          AND nl.area_exclusive_m2 > 0 AND nl.rent_amount > 0
          AND (nl.rent_amount / nl.area_exclusive_m2) > d.avg_rpm * 1.5
      )`;

    const { rowCount: flagged } = await client.query(`
      ${priceOutlierCte}
      UPDATE normalized_listings nl
      SET quality_flags = COALESCE(quality_flags, '[]'::jsonb) || '["price_outlier"]'::jsonb,
          updated_at = NOW()
      WHERE nl.listing_id IN (SELECT listing_id FROM outliers)
        AND NOT COALESCE(nl.quality_flags, '[]'::jsonb) @> '["price_outlier"]'::jsonb
    `);

    const { rowCount: unflagged } = await client.query(`
      ${priceOutlierCte}
      UPDATE normalized_listings nl
      SET quality_flags = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE(nl.quality_flags, '[]'::jsonb)) elem
        WHERE elem::text != '"price_outlier"'
      ),
          updated_at = NOW()
      WHERE COALESCE(nl.quality_flags, '[]'::jsonb) @> '["price_outlier"]'::jsonb
        AND nl.listing_id NOT IN (SELECT listing_id FROM outliers)
    `);

    if (flagged > 0 || unflagged > 0) {
      console.log(`  price_outlier 플래그: +${flagged}건 추가, -${unflagged}건 해제`);
    }

    return { total: graded.length, ssCount: ssGrade.length, sCount: sGrade.length, aCount: aGrade.length, saved: true };
  });

  if (result.saved) {
    console.log(`  SS: ${result.ssCount}개, S: ${result.sCount}개, A: ${result.aCount}개, B: ${result.total - result.ssCount - result.sCount - result.aCount}개`);
  }
}

main().catch((err) => {
  console.error("오류:", err.message);
  process.exit(1);
});
