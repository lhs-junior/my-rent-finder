import { withDbClient } from "./db_client.mjs";

// maxAgeHours: 지정 시간보다 오래된 매물은 이미지 보유 여부와 관계없이 재수집 대상으로 취급
export async function getExistingWithImages(platformCode, externalIds, opts = {}) {
  // 하위 호환: 3번째 인수가 DB client 객체(query 메서드 보유)이면 legacy 시그니처로 처리
  if (opts !== null && typeof opts === "object" && typeof opts.query === "function") {
    opts = { client: opts };
  }
  const { maxAgeHours = null, client = null } = opts ?? {};

  if (!Array.isArray(externalIds) || externalIds.length === 0) return new Set();

  const ids = externalIds.map(String);
  const params = [platformCode, ids];
  let stalenessCond = "";
  if (maxAgeHours != null && Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    params.push(maxAgeHours);
    stalenessCond = `AND nl.updated_at > NOW() - ($${params.length} * INTERVAL '1 hour')`;
  }

  const query = `
    SELECT DISTINCT nl.external_id
    FROM normalized_listings nl
    JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = $1
      AND nl.external_id = ANY($2)
      AND nl.deleted_at IS NULL
      ${stalenessCond}
  `;

  const run = async (c) => {
    const result = await c.query(query, params);
    return new Set(result.rows.map((r) => String(r.external_id)));
  };

  if (client) return run(client);
  return withDbClient(run);
}

// 이미지 보유 AND 지정 필드가 모두 NOT NULL인 경우만 known으로 처리
// 예: 피터팬에서 description_text 등 상세 필드도 이미 채워진 매물만 skip
const ALLOWED_EXTRA_FIELDS = new Set([
  "description_text", "bathroom_count", "building_year",
  "available_date", "jibun_address", "agent_name", "building_name",
]);

export async function getExistingWithImagesAndFields(platformCode, externalIds, requiredFields = [], opts = {}) {
  if (opts !== null && typeof opts === "object" && typeof opts.query === "function") {
    opts = { client: opts };
  }
  const { maxAgeHours = null, client = null } = opts ?? {};

  if (!Array.isArray(externalIds) || externalIds.length === 0) return new Set();

  const ids = externalIds.map(String);
  const params = [platformCode, ids];
  let stalenessCond = "";
  if (maxAgeHours != null && Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    params.push(maxAgeHours);
    stalenessCond = `AND nl.updated_at > NOW() - ($${params.length} * INTERVAL '1 hour')`;
  }

  const fieldConds = requiredFields
    .filter((f) => ALLOWED_EXTRA_FIELDS.has(f))
    .map((f) => `nl.${f} IS NOT NULL`)
    .join(" AND ");

  const query = `
    SELECT DISTINCT nl.external_id
    FROM normalized_listings nl
    JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = $1
      AND nl.external_id = ANY($2)
      AND nl.deleted_at IS NULL
      ${stalenessCond}
      ${fieldConds ? `AND ${fieldConds}` : ""}
  `;

  const run = async (c) => {
    const result = await c.query(query, params);
    return new Set(result.rows.map((r) => String(r.external_id)));
  };

  if (client) return run(client);
  return withDbClient(run);
}

// naver처럼 첫 수집 시 썸네일만 있는 매물을 known으로 취급하지 않기 위해 minCount 임계값 사용
export async function getExistingWithSufficientImages(platformCode, externalIds, minCount = 3, opts = {}) {
  if (opts !== null && typeof opts === "object" && typeof opts.query === "function") {
    opts = { client: opts };
  }
  const { maxAgeHours = null, client = null } = opts ?? {};

  if (!Array.isArray(externalIds) || externalIds.length === 0) return new Set();

  const ids = externalIds.map(String);
  const params = [platformCode, ids, minCount];
  let stalenessCond = "";
  if (maxAgeHours != null && Number.isFinite(maxAgeHours) && maxAgeHours > 0) {
    params.push(maxAgeHours);
    stalenessCond = `AND nl.updated_at > NOW() - ($${params.length} * INTERVAL '1 hour')`;
  }

  const query = `
    SELECT nl.external_id
    FROM normalized_listings nl
    JOIN listing_images li ON li.listing_id = nl.listing_id
    WHERE nl.platform_code = $1
      AND nl.external_id = ANY($2)
      AND nl.deleted_at IS NULL
      ${stalenessCond}
    GROUP BY nl.external_id
    HAVING COUNT(li.image_id) >= $3
  `;

  const run = async (c) => {
    const result = await c.query(query, params);
    return new Set(result.rows.map((r) => String(r.external_id)));
  };

  if (client) return run(client);
  return withDbClient(run);
}
