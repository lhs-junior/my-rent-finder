#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";

const API_PORT = 4100;
const FRONT_PORT = 5173;
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`;

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefixLines(prefix, stream, target = process.stdout) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      target.write(`[${prefix}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) {
      target.write(`[${prefix}] ${buffer.trim()}\n`);
    }
  });
}

function spawnNpmTask(label, args) {
  const child = spawn(npmCommand(), args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  prefixLines(label, child.stdout, process.stdout);
  prefixLines(label, child.stderr, process.stderr);
  return child;
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("timeout")));
  });
}

async function waitForHealth(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await httpGetJson(HEALTH_URL);
      if (payload?.ok) return payload;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  throw new Error(`API health check did not pass within ${timeoutMs}ms`);
}

function isIntentionalExit(code, signal) {
  return signal === "SIGINT" || signal === "SIGTERM" || code === 0;
}

async function main() {
  let apiProcess = null;
  let frontProcess = null;
  let shuttingDown = false;

  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (frontProcess && !frontProcess.killed) frontProcess.kill(signal);
    if (apiProcess && !apiProcess.killed) apiProcess.kill(signal);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    const alreadyHealthy = await waitForHealth(1200).catch(() => null);
    if (alreadyHealthy?.ok) {
      console.log(`[dev-local] API server already healthy on ${HEALTH_URL}`);
    } else {
      console.log(`[dev-local] Starting API server on port ${API_PORT}`);
      apiProcess = spawnNpmTask("api", ["run", "api:server"]);
      apiProcess.on("exit", (code, signal) => {
        if (!shuttingDown && !isIntentionalExit(code, signal)) {
          console.error(`[dev-local] API server exited early (code=${code}, signal=${signal ?? "none"})`);
          shutdown("SIGTERM");
          process.exitCode = 1;
        }
      });
      await waitForHealth();
      console.log(`[dev-local] API health passed: ${HEALTH_URL}`);
    }

    console.log(`[dev-local] Starting frontend dev server on port ${FRONT_PORT}`);
    frontProcess = spawnNpmTask("front", ["run", "front:dev"]);
    frontProcess.on("exit", (code, signal) => {
      if (!shuttingDown && !isIntentionalExit(code, signal)) {
        console.error(`[dev-local] Frontend dev server exited early (code=${code}, signal=${signal ?? "none"})`);
        shutdown("SIGTERM");
        process.exitCode = 1;
      }
    });

    console.log(`[dev-local] Ready. Open http://127.0.0.1:${FRONT_PORT}/`);
    console.log(`[dev-local] Keep this process running while using local map/listings.`);

    await new Promise((resolve) => {
      const onExit = () => resolve();
      frontProcess.on("exit", onExit);
      if (apiProcess) apiProcess.on("exit", onExit);
    });
  } finally {
    shutdown("SIGTERM");
  }
}

main().catch((error) => {
  console.error(`[dev-local] Failed: ${error?.message || error}`);
  process.exit(1);
});
