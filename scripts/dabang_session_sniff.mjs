#!/usr/bin/env node
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";

chromium.use(StealthPlugin());

async function sniff() {
  console.log("🕵️  Sniffing Dabang via Search Box (Jungnang-gu)...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to main page
  await page.goto("https://www.dabangapp.com", {
    waitUntil: "domcontentloaded",
  });

  let capturedUrl = null;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/bbox?") && !capturedUrl) {
      capturedUrl = url;
    }
  });

  try {
    // 1. Type "중랑구" in the search box
    console.log("   Typing '중랑구'...");
    await page.fill('input[placeholder*="지역"]', "중랑구");
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Click the first suggestion
    console.log("   Selecting first suggestion...");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 1000));
    await page.keyboard.press("Enter");

    console.log("   Waiting for map to load results...");
    await new Promise((r) => setTimeout(r, 10000));

    if (capturedUrl) {
      console.log("✅ Captured BBox URL via Search!");
      fs.writeFileSync(
        "scripts/dabang_session.json",
        JSON.stringify(
          {
            url: capturedUrl,
            headers: {
              "d-api-version": "5.0.0",
              "d-app-version": "1",
              "d-call-type": "web",
              csrf: "token",
              "user-agent": await page.evaluate(() => navigator.userAgent),
              referer: "https://www.dabangapp.com/",
            },
          },
          null,
          2,
        ),
      );
    } else {
      const currentUrl = page.url();
      console.log(`❌ Failed to capture BBox. Current URL: ${currentUrl}`);
      await page.screenshot({ path: "scripts/dabang_search_fail.webp" });
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  await browser.close();
}

sniff();
