/**
 * Vercel Serverless catch-all API handler.
 * 공유 라우터(router.mjs)에 위임 — 라우트 추가/변경은 router.mjs만 수정.
 */

import {
  sendJson,
  send404,
  sendServerError,
} from "../scripts/lib/api_helpers.mjs";
import { dispatchApiRoute } from "../scripts/lib/api_routes/router.mjs";

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
    const matched = await dispatchApiRoute(req, res, pathname, parseJsonBody);
    if (!matched) send404(res);
  } catch (error) {
    console.error("[api/handler]", error);
    sendServerError(res, error);
  }
}
