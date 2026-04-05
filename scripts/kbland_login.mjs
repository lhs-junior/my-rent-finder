#!/usr/bin/env node

/**
 * KB부동산 로그인 헬퍼
 * - Chrome을 GUI 모드로 실행
 * - 사용자가 직접 로그인 (우리집 → Google → da48688@naver.com)
 * - 엔터 누르면 세션이 프로필에 저장됨
 * - 이후 kbland_auto_collector.mjs가 headless로 자동 수집
 *
 * 사용법:
 *   node scripts/kbland_login.mjs
 */

import { spawn } from "node:child_process";
import readline from "node:readline";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const USER_DATA_DIR = `${process.env.HOME}/.chrome-kbland-headless`;

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function main() {
  console.log("=== KB부동산 로그인 ===");
  console.log(`프로필: ${USER_DATA_DIR}\n`);

  console.log("Chrome 실행 중...");
  const chromeProc = spawn(CHROME_PATH, [
    `--user-data-dir=${USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://kbland.kr/map?xy=37.6423,127.0714,14",
  ], { detached: true, stdio: "ignore" });
  chromeProc.unref();

  console.log("✓ Chrome 실행됨\n");
  console.log("다음 단계:");
  console.log("  1. kbland.kr에서 '우리집' 버튼 클릭");
  console.log("  2. 로그인 → Google 로그인 선택");
  console.log("  3. da48688@naver.com 계정 선택");
  console.log("  4. 로그인 완료 확인\n");

  await waitForEnter("로그인 완료 후 엔터를 눌러주세요...");

  console.log("\n✓ 세션 저장 완료!");
  console.log(`  경로: ${USER_DATA_DIR}`);
  console.log("\n이제 자동 수집 테스트:");
  console.log("  node scripts/kbland_auto_collector.mjs --sigungu=노원구 --sample-cap=3");

  try { chromeProc.kill(); } catch { /* 이미 종료 */ }
}

main().catch((e) => {
  console.error("오류:", e.message);
  process.exit(1);
});
