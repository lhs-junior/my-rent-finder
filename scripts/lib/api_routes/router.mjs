/**
 * 공유 API 라우터 — api_server.mjs와 api/handler.mjs 양쪽에서 사용.
 * 라우트 추가/변경 시 이 파일만 수정하면 로컬·Vercel 모두 반영됨.
 */

import { toText } from "../db_client.mjs";
import { sendJson, send404 } from "../api_helpers.mjs";
import { handleHealth } from "./health.mjs";
import { handleOps, handleCollectionRuns } from "./ops.mjs";
import { handleListings, handleListingDetail, handleListingsGeo, handleListingVerify, handleMyPick, handleMyPickConfig } from "./listings.mjs";
import { handleMatches, handleMatchGroup } from "./matches.mjs";
import { handleFavorites, handleFavoriteIds, handleAddFavorite, handleRemoveFavorite } from "./favorites.mjs";
import { handleSettings } from "./settings.mjs";
import { handleAffordability } from "./affordability.mjs";
import { handleProfileRead, handleProfileSettings, handleProfileFavorites, handleProfileFavoriteToggle } from "./profile.mjs";
import { handleScores, handleScoresSummary } from "./scores.mjs";

/**
 * API 라우트 디스패치. 매칭되면 true, 아니면 false 반환.
 * @param {object} req
 * @param {object} res
 * @param {string} pathname - 쿼리스트링 제외된 경로
 * @param {(req) => Promise<void>} parseJsonBody - JSON body 파싱 함수
 * @returns {Promise<boolean>} 라우트 매칭 여부
 */
export async function dispatchApiRoute(req, res, pathname, parseJsonBody) {
  if (pathname === "/api/health") {
    await handleHealth(req, res);
    return true;
  }
  if (pathname === "/api/ops") {
    await handleOps(req, res);
    return true;
  }
  if (pathname === "/api/collection/runs") {
    await handleCollectionRuns(req, res);
    return true;
  }
  if (pathname === "/api/listings") {
    await handleListings(req, res);
    return true;
  }
  if (pathname === "/api/listings/geo") {
    await handleListingsGeo(req, res);
    return true;
  }
  if (pathname === "/api/listings/my-pick/config" && req.method === "GET") {
    await handleMyPickConfig(req, res);
    return true;
  }
  if (pathname === "/api/listings/my-pick") {
    await handleMyPick(req, res);
    return true;
  }
  if (pathname === "/api/favorites/ids" && req.method === "GET") {
    await handleFavoriteIds(req, res);
    return true;
  }
  if (pathname === "/api/favorites" && req.method === "GET") {
    await handleFavorites(req, res);
    return true;
  }
  if (pathname === "/api/favorites" && req.method === "POST") {
    await parseJsonBody(req);
    await handleAddFavorite(req, res);
    return true;
  }
  if (pathname.startsWith("/api/favorites/") && req.method === "DELETE") {
    const favListingId = pathname.slice("/api/favorites/".length);
    await handleRemoveFavorite(req, res, favListingId);
    return true;
  }
  if (pathname === "/api/scores/summary") {
    await handleScoresSummary(req, res);
    return true;
  }
  if (pathname === "/api/scores") {
    await handleScores(req, res);
    return true;
  }
  if (pathname === "/api/matches") {
    await handleMatches(req, res);
    return true;
  }
  // /api/listings/:id/verify
  const verifyMatch = pathname.match(/^\/api\/listings\/(\d+)\/verify$/);
  if (verifyMatch) {
    await handleListingVerify(req, res, verifyMatch[1]);
    return true;
  }
  if (pathname.startsWith("/api/listings/")) {
    let listingIdText = null;
    try {
      listingIdText = toText(decodeURIComponent(pathname.slice("/api/listings/".length)).trim(), null);
    } catch {
      listingIdText = null;
    }
    if (!listingIdText || !/^\d+$/.test(listingIdText)) {
      sendJson(res, 400, { error: "invalid_listing_id" });
      return true;
    }
    await handleListingDetail(req, res, listingIdText);
    return true;
  }
  if (pathname.startsWith("/api/match-groups/")) {
    const id = pathname.slice("/api/match-groups/".length);
    await handleMatchGroup(req, res, id);
    return true;
  }
  if (pathname === "/api/affordability") {
    await handleAffordability(req, res);
    return true;
  }
  if (
    pathname === "/api/settings" ||
    pathname === "/api/settings/read" ||
    pathname === "/api/settings/has-pin" ||
    pathname === "/api/settings/init-pin"
  ) {
    await parseJsonBody(req);
    await handleSettings(req, res);
    return true;
  }
  if (pathname === "/api/profile/read") {
    await parseJsonBody(req);
    await handleProfileRead(req, res);
    return true;
  }
  if (pathname === "/api/profile/settings") {
    await parseJsonBody(req);
    await handleProfileSettings(req, res);
    return true;
  }
  if (pathname === "/api/profile/favorites") {
    await parseJsonBody(req);
    await handleProfileFavorites(req, res);
    return true;
  }
  if (pathname === "/api/profile/favorites/toggle") {
    await parseJsonBody(req);
    await handleProfileFavoriteToggle(req, res);
    return true;
  }

  return false;
}
