#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { toText } from "./lib/db_client.mjs";
import { getArg, getInt } from "./lib/cli_utils.mjs";
import {
  sendJson,
  send404,
  sendServerError,
  mimeFor,
  isInside,
  platformNameFromCode,
  inferItemQuality,
  mapGradeToTone,
  statusFromCode,
  hasDbConnectionError,
  mapServerError,
  parseRunIdFilter,
  normalizeBaseRunId,
} from "./lib/api_helpers.mjs";
import { handleHealth } from "./lib/api_routes/health.mjs";
import { handleOps, handleCollectionRuns } from "./lib/api_routes/ops.mjs";
import { handleListings, handleListingDetail } from "./lib/api_routes/listings.mjs";
import { handleMatches, handleMatchGroup } from "./lib/api_routes/matches.mjs";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DEFAULT_FRONT_DIR = path.resolve(process.cwd(), "frontend/dist");
const FRONT_DIR = (() => {
  const value = getArg(args, "--front-dir", null);
  if (!value) return DEFAULT_FRONT_DIR;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
})();

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

function sendStaticIndex(res, frontDir) {
  const indexPath = path.join(frontDir, "index.html");
  if (!fs.existsSync(indexPath)) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  fs.createReadStream(indexPath).pipe(res);
  return true;
}

function sendStaticFile(frontDir, targetPath, res) {
  try {
    if (!fs.existsSync(frontDir) || !fs.statSync(frontDir).isDirectory()) {
      return false;
    }
    if (!isInside(frontDir, targetPath)) return false;
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return false;

    res.statusCode = 200;
    res.setHeader("Content-Type", mimeFor(targetPath));
    fs.createReadStream(targetPath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function sendNoFrontInfo(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Frontend static bundle is not built.\nRun:\n  npm run front:build\nthen restart API server.\n");
  return true;
}

function serveFrontend(req, res, pathname) {
  if (!pathname || pathname === "/") {
    if (!fs.existsSync(FRONT_DIR)) {
      return sendNoFrontInfo(res);
    }
    return sendStaticIndex(res, FRONT_DIR);
  }
  if (!pathname.startsWith("/")) return false;
  const rel = pathname.replace(/^\/+/, "");
  const resolved = path.resolve(FRONT_DIR, rel);

  if (!sendStaticFile(FRONT_DIR, resolved, res)) {
    if (!path.extname(rel)) {
      return sendStaticIndex(res, FRONT_DIR);
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/api/health" || pathname.startsWith("/api/")) {
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
  }

  const served = serveFrontend(req, res, pathname);
  if (served) return;

  send404(res);
}

// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------

function withRequestLogging(handler) {
  return async (req, res) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      const url = new URL(req.url, "http://localhost");
      console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}${url.search} \u2192 ${res.statusCode} (${duration}ms)`);
    });
    await handler(req, res);
  };
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function createShutdown(server) {
  return function shutdown(signal) {
    console.log(`\n[${new Date().toISOString()}] ${signal} received, shutting down...`);
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 5000);
  };
}

// ---------------------------------------------------------------------------
// Export for testing (re-export from api_helpers to keep test compatibility)
// ---------------------------------------------------------------------------

export {
  platformNameFromCode,
  mimeFor,
  isInside,
  inferItemQuality,
  mapGradeToTone,
  statusFromCode,
  hasDbConnectionError,
  mapServerError,
  parseRunIdFilter,
  normalizeBaseRunId,
};

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isDirectRun) {
  const port = getInt(args, "--port", 4100);
  const host = getArg(args, "--host", "127.0.0.1");

  const loggedRoute = withRequestLogging(async (req, res) => {
    await route(req, res).catch((error) => {
      console.error(error);
      sendServerError(res, error);
    });
  });

  const server = http.createServer(loggedRoute);

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(`\uD3EC\uD2B8 ${port} \uC0AC\uC6A9 \uBD88\uAC00: \uC774\uBBF8 \uB2E4\uB978 \uD504\uB85C\uC138\uC2A4\uAC00  ${host}:${port}\uB97C \uC0AC\uC6A9 \uC911\uC785\uB2C8\uB2E4.`);
      console.error("\uD574\uACB0: \uAE30\uC874 \uC11C\uBC84\uB97C \uC885\uB8CC\uD55C \uB4A4 \uB2E4\uC2DC \uC2E4\uD589\uD558\uAC70\uB098, \uB2E4\uB978 \uD3EC\uD2B8\uB97C \uC9C0\uC815\uD558\uC138\uC694.");
      console.error("\uC608: npm run start -- --port=4101");
      process.exit(1);
    }
    console.error(`Server error: ${error?.message || String(error)}`);
    process.exit(1);
  });

  const shutdown = createShutdown(server);
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(port, host, () => {
    console.log(`Rent Finder API server running on http://${host}:${port}`);
    const frontDirExists = FRONT_DIR && fs.existsSync(FRONT_DIR) ? "ENABLED" : "DISABLED";
    console.log(`Frontend static serving: ${frontDirExists} (${FRONT_DIR})`);
    console.log(`Endpoints:
  /api/health
  /api/ops?run_id=
  /api/collection/runs?platform=&hours=&limit=&offset=
  /api/listings?run_id=&platform_code=&address=&min_rent=&max_rent=&min_area=&max_area=
  /api/listings/:id
  /api/matches?run_id=&status=&limit=&offset=
  /api/match-groups/:id`);
  });
}
