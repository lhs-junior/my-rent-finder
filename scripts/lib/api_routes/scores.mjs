// scripts/lib/api_routes/scores.mjs
// AI 추천 (scored_listings) 조회 API
import { withDbClient, toInt, toNumber } from "../db_client.mjs";
import { sendJson, safeText, platformNameFromCode, parseImageMap, extractImageUrlsFromPayload } from "../api_helpers.mjs";

// 모듈 레벨 캐시 — Vercel warm instance 유지 시 재연결 없이 즉시 반환
const _cache = new Map(); // key → { data, ts }
const CACHE_TTL_MS = 3 * 60 * 1000; // 3분

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) { _cache.set(key, { data, ts: Date.now() }); }

// GET /api/scores?grade=SS,S,A&sort=score|cost&limit=100
export async function handleScores(req, res) {
  const url = new URL(req.url, "http://localhost");
  const gradeFilter = url.searchParams.get("grade");
  const sort = url.searchParams.get("sort") || "score";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);

  const grades = gradeFilter ? gradeFilter.split(",").map((g) => g.trim().toUpperCase()) : null;

  // 캐시 키 — sort는 클라이언트 처리이므로 grade+limit만
  const cacheKey = `scores:${gradeFilter || "all"}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }

  try {
    const result = await withDbClient(async (client) => {
      let whereClause = "WHERE sl.grade IS NOT NULL AND sl.grade != 'REJECT'";
      const params = [];
      if (grades) {
        params.push(grades);
        whereClause += ` AND sl.grade = ANY($${params.length})`;
      }

      const orderBy = sort === "cost"
        ? "sl.effective_monthly_cost ASC NULLS LAST, sl.total_score DESC"
        : "sl.total_score DESC, sl.effective_monthly_cost ASC NULLS LAST";

      params.push(limit);
      const query = `
        SELECT sl.*, nl.platform_code, nl.source_url, nl.external_id,
               nl.title, nl.lease_type, nl.rent_amount, nl.deposit_amount,
               nl.area_exclusive_m2, nl.area_gross_m2, nl.address_text,
               nl.room_count, nl.floor, nl.total_floor, nl.building_year,
               nl.lat, nl.lng, nl.deleted_at IS NOT NULL AS is_expired,
               rl.payload_json
        FROM scored_listings sl
        JOIN normalized_listings nl ON nl.listing_id = sl.listing_id
        JOIN raw_listings rl ON rl.raw_id = nl.raw_id
        ${whereClause}
        ORDER BY ${orderBy}
        LIMIT $${params.length}
      `;

      const { rows } = await client.query(query, params);

      const listingIds = rows.map((r) => toInt(r.listing_id, null)).filter(Boolean);
      const [imageRows, firstImageRows] = listingIds.length
        ? await Promise.all([
            client.query(
              `SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`,
              [listingIds],
            ),
            client.query(
              `SELECT DISTINCT ON (listing_id) listing_id, source_url
               FROM listing_images
               WHERE listing_id = ANY($1) AND source_url IS NOT NULL AND source_url != ''
               ORDER BY listing_id, is_primary DESC, image_id ASC`,
              [listingIds],
            ),
          ])
        : [{ rows: [] }, { rows: [] }];
      const imageMap = parseImageMap(imageRows.rows || []);

      const firstImageMap = new Map();
      for (const row of firstImageRows.rows || []) {
        const lid = toInt(row.listing_id, null);
        if (lid !== null) firstImageMap.set(lid, row.source_url);
      }

      return rows.map((row) => {
        const listingId = toInt(row.listing_id, null);
        const fallbackImageUrls = extractImageUrlsFromPayload(row.payload_json);
        return {
          listing_id: listingId,
          grade: row.grade,
          total_score: toInt(row.total_score, 0),
          scores: {
            rpm: toInt(row.rpm_score, 0),
            subway: toInt(row.subway_score, 0),
            transfer: toInt(row.transfer_score, 0),
            area: toInt(row.area_score, 0),
            floor: toInt(row.floor_score, 0),
            year: toInt(row.year_score, 0),
            img: toInt(row.img_score, 0),
          },
          effective_monthly_cost: toInt(row.effective_monthly_cost, null),
          platform_code: safeText(row.platform_code, ""),
          platform: platformNameFromCode(safeText(row.platform_code, "")),
          source_url: safeText(row.source_url, ""),
          title: safeText(row.title, ""),
          rent_amount: toNumber(row.rent_amount, null),
          deposit_amount: toNumber(row.deposit_amount, null),
          area_exclusive_m2: toNumber(row.area_exclusive_m2, null),
          address_text: safeText(row.address_text, ""),
          room_count: toInt(row.room_count, null),
          floor: toInt(row.floor, null),
          total_floor: toInt(row.total_floor, null),
          building_year: toInt(row.building_year, null),
          lat: toNumber(row.lat, null),
          lng: toNumber(row.lng, null),
          is_expired: row.is_expired === true,
          image_count: Number(imageMap.get(listingId) || fallbackImageUrls.length || 0),
          first_image_url: firstImageMap.get(listingId) || fallbackImageUrls[0] || null,
        };
      });
    });

    const payload = { items: result, total: result.length };
    cacheSet(cacheKey, payload);
    sendJson(res, 200, payload);
  } catch (e) {
    console.error("[scores] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}

// GET /api/scores/summary — 등급별 요약
export async function handleScoresSummary(req, res) {
  const cached = cacheGet("scores:summary");
  if (cached) { sendJson(res, 200, cached); return; }

  try {
    const result = await withDbClient(async (client) => {
      const { rows } = await client.query(`
        SELECT grade, COUNT(*) AS count,
               AVG(total_score) AS avg_score,
               AVG(effective_monthly_cost) AS avg_cost
        FROM scored_listings
        WHERE grade IS NOT NULL AND grade != 'REJECT'
        GROUP BY grade
        ORDER BY CASE grade WHEN 'SS' THEN 1 WHEN 'S' THEN 2 WHEN 'A' THEN 3 WHEN 'B' THEN 4 ELSE 5 END
      `);
      return rows.map((r) => ({
        grade: r.grade,
        count: parseInt(r.count, 10),
        avg_score: Number(Number(r.avg_score).toFixed(1)),
        avg_cost: r.avg_cost ? Math.round(Number(r.avg_cost)) : null,
      }));
    });

    const payload = { grades: result, total: result.reduce((s, r) => s + r.count, 0) };
    cacheSet("scores:summary", payload);
    sendJson(res, 200, payload);
  } catch (e) {
    console.error("[scores/summary] error:", e.message);
    sendJson(res, 500, { error: "DB error" });
  }
}
