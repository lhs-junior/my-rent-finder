#!/usr/bin/env node
// playwright-core 1.58.x esbuild 클로저 버그 패치
// __copyProps getter에서 for-let 루프 변수 key가 런타임에 undefined가 되는 문제
// https://github.com/microsoft/playwright/issues/xxx

import fs from "node:fs";
import path from "node:path";

const target = path.resolve("node_modules/playwright-core/lib/server/callLog.js");

if (!fs.existsSync(target)) {
  process.exit(0);
}

const original = `__defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });`;
const patched = `((k) => __defProp(to, k, { get: () => from[k], enumerable: !(desc = __getOwnPropDesc(from, k)) || desc.enumerable }))(key);`;

const content = fs.readFileSync(target, "utf8");
if (content.includes(patched)) {
  console.log("[postinstall] playwright-core callLog.js 이미 패치됨");
  process.exit(0);
}
if (!content.includes(original)) {
  console.log("[postinstall] playwright-core callLog.js 패치 대상 없음 (버전 달라짐, 스킵)");
  process.exit(0);
}

fs.writeFileSync(target, content.replace(original, patched), "utf8");
console.log("[postinstall] playwright-core callLog.js 패치 완료");
