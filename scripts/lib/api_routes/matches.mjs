import { toInt, toNumber, withDbClient } from "../db_client.mjs";
import {
  safeText,
  sendJson,
  platformNameFromCode,
  normalizeBaseRunId,
  parseQueryInt,
  parseImageMap,
  resolveLatestBaseRunId,
} from "../api_helpers.mjs";
import { getMatchingData } from "./ops.mjs";

// ---------------------------------------------------------------------------
// /api/matches
// ---------------------------------------------------------------------------

export async function handleMatches(req, res) {
  const url = new URL(req.url, "http://localhost");
  const runId = normalizeBaseRunId(safeText(url.searchParams.get("run_id"), null));
  const status = safeText(url.searchParams.get("status"), null);
  const limit = Math.max(1, parseQueryInt(url.searchParams.get("limit"), 200));
  const offset = Math.max(0, parseQueryInt(url.searchParams.get("offset"), 0));

  const rows = await withDbClient(async (client) => {
    const baseRunId = await resolveLatestBaseRunId(client, runId);
    const matching = await getMatchingData(client, baseRunId, status, limit, offset);
    return {
      summary: matching.summary,
      items: matching.pairs,
      groups: matching.groups,
    };
  });
  sendJson(res, 200, rows);
}

// ---------------------------------------------------------------------------
// /api/match-groups/:id
// ---------------------------------------------------------------------------

export async function handleMatchGroup(req, res, groupId) {
  const parsedGroupId = toInt(groupId, null);
  if (!parsedGroupId) {
    sendJson(res, 400, { error: "invalid_group_id" });
    return;
  }

  const group = await withDbClient(async (client) => {
    const base = await client.query(`SELECT * FROM match_groups WHERE group_id = $1`, [parsedGroupId]);
    if (!base.rows?.length) return null;
    const row = base.rows[0];
    const members = await client.query(`
      SELECT m.listing_id, m.score, nl.platform_code, nl.address_text, nl.address_code, nl.rent_amount, nl.deposit_amount, nl.area_exclusive_m2, nl.area_gross_m2
      FROM match_group_members m
      JOIN normalized_listings nl ON nl.listing_id = m.listing_id
      WHERE m.group_id = $1
      ORDER BY m.score DESC
    `, [parsedGroupId]);
    const imageRows = await client.query(`SELECT listing_id, COUNT(*) AS image_count FROM listing_images WHERE listing_id = ANY($1) GROUP BY listing_id`, [members.rows.map((r) => toInt(r.listing_id, null)).filter((v) => v !== null)]);
    const imageMap = parseImageMap(imageRows.rows || []);
    return {
      group_id: parsedGroupId,
      matcher_run_id: toInt(row.matcher_run_id, null),
      canonical_key: safeText(row.canonical_key, ""),
      canonical_status: safeText(row.canonical_status, "OPEN"),
      reason_json: row.reason_json || {},
      members: members.rows.map((member) => ({
        listing_id: toInt(member.listing_id, null),
        platform: platformNameFromCode(safeText(member.platform_code, "")),
        address: safeText(member.address_text, ""),
        rent: toNumber(member.rent_amount, null),
        deposit: toNumber(member.deposit_amount, null),
        area_exclusive_m2: toNumber(member.area_exclusive_m2, null),
        area_gross_m2: toNumber(member.area_gross_m2, null),
        image_count: Number(imageMap.get(toInt(member.listing_id, null)) || 0),
      })),
    };
  });

  if (!group) {
    sendJson(res, 404, { error: "group_not_found" });
    return;
  }
  sendJson(res, 200, group);
}
