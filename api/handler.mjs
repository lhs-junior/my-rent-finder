/**
 * Vercel Serverless catch-all API handler.
 * Delegates to the existing route handlers from scripts/lib/api_routes/*.
 */

import { toText } from "../scripts/lib/db_client.mjs";
import {
  sendJson,
  send404,
  sendServerError,
} from "../scripts/lib/api_helpers.mjs";
import { handleHealth } from "../scripts/lib/api_routes/health.mjs";
import { handleOps, handleCollectionRuns } from "../scripts/lib/api_routes/ops.mjs";
import { handleListings, handleListingDetail, handleListingsGeo } from "../scripts/lib/api_routes/listings.mjs";
import { handleMatches, handleMatchGroup } from "../scripts/lib/api_routes/matches.mjs";
import { handleFavorites, handleFavoriteIds, handleAddFavorite, handleRemoveFavorite } from "../scripts/lib/api_routes/favorites.mjs";

function resolveRequestPath(req) {
  const headerPath = req.headers["x-vercel-pathname"] || req.headers["x-vercel-original-pathname"];
  if (typeof headerPath === "string" && headerPath.trim()) {
    const pathOnly = headerPath.split("?")[0].trim();
    if (pathOnly) return pathOnly;
  }

  if (typeof req.url === "string" && req.url.startsWith("/api/")) {
    return new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  }

  return "/api/handler";
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    if (req._parsedBody !== undefined) { resolve(); return; }
    if (req.body && typeof req.body === "object") {
      req._parsedBody = req.body;
      resolve();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        req._parsedBody = raw ? JSON.parse(raw) : {};
      } catch {
        req._parsedBody = {};
      }
      resolve();
    });
    req.on("error", () => { req._parsedBody = {}; resolve(); });
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    const allowedMethods = new Set(["GET", "POST", "DELETE"]);
    if (!allowedMethods.has(req.method)) {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const pathname = resolveRequestPath(req);

    if (pathname === "/api/health") {
      await handleHealth(req, res);
      return;
    }
    if (pathname === "/api/ops") {
      await handleOps(req, res);
      return;
    }
    if (pathname === "/api/collection/runs") {
      await handleCollectionRuns(req, res);
      return;
    }
    if (pathname === "/api/listings") {
      await handleListings(req, res);
      return;
    }
    if (pathname === "/api/listings/geo") {
      await handleListingsGeo(req, res);
      return;
    }
    if (pathname === "/api/favorites/ids" && req.method === "GET") {
      await handleFavoriteIds(req, res);
      return;
    }
    if (pathname === "/api/favorites" && req.method === "GET") {
      await handleFavorites(req, res);
      return;
    }
    if (pathname === "/api/favorites" && req.method === "POST") {
      await parseJsonBody(req);
      await handleAddFavorite(req, res);
      return;
    }
    if (pathname.startsWith("/api/favorites/") && req.method === "DELETE") {
      const favListingId = pathname.slice("/api/favorites/".length);
      await handleRemoveFavorite(req, res, favListingId);
      return;
    }
    if (pathname === "/api/matches") {
      await handleMatches(req, res);
      return;
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
        return;
      }
      await handleListingDetail(req, res, listingIdText);
      return;
    }
    if (pathname.startsWith("/api/match-groups/")) {
      const id = pathname.slice("/api/match-groups/".length);
      await handleMatchGroup(req, res, id);
      return;
    }

    send404(res);
  } catch (error) {
    console.error("[api/handler]", error);
    sendServerError(res, error);
  }
}
