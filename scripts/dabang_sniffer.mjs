#!/usr/bin/env node
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";

chromium.use(StealthPlugin());

async function sniff() {
  console.log("🕵️  Sniffing Dabang API and Response Body...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const targetUrl = `https://www.dabangapp.com/map/onetwo?sellingTypeList=%5B%22MONTHLY_RENT%22%5D&m_lat=37.4979&m_lng=127.0276&m_zoom=13`;

  let resultFound = false;

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/bbox?") && !resultFound) {
      try {
        const body = await res.json();
        const count = body.result?.list?.length || 0;
        console.log(`✅ Captured BBox Response! Found ${count} items.`);

        fs.writeFileSync(
          "scripts/dabang_sniffed_data.json",
          JSON.stringify(
            {
              url: url,
              headers: res.request().headers(),
              response: body,
              count: count,
            },
            null,
            2,
          ),
        );
        resultFound = true;
      } catch (e) {
        /* ignore */
      }
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 10000));
  } catch (e) {
    console.log(`⚠️  Navigation info: ${e.message}`);
  }

  await browser.close();

  if (!resultFound) {
    console.log("❌ Failed to capture BBox results.");
    process.exit(1);
  }
}

sniff();
