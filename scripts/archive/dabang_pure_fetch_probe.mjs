#!/usr/bin/env node
import fs from "node:fs";

async function probe() {
  const filters = {
    sellingTypeList: ["MONTHLY_RENT"],
    depositRange: { min: 0, max: 6000 },
    priceRange: { min: 0, max: 80 },
    isIncludeMaintenance: false,
    pyeongRange: { min: 10, max: 999999 },
    roomFloorList: ["GROUND_FIRST", "GROUND_SECOND_OVER"],
    roomTypeList: ["ONE_ROOM", "TWO_ROOM"],
  };

  // Non-BBox API
  const url = `https://www.dabangapp.com/api/v5/room-list/category/one-two?filters=${encodeURIComponent(JSON.stringify(filters))}&page=1`;

  console.log("🚀 Probing Dabang Category API (Pure Fetch)...");

  const resp = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      "d-api-version": "5.0.0",
      "d-app-version": "1",
      "d-call-type": "web",
      csrf: "token",
      referer: "https://www.dabangapp.com/map/onetwo",
    },
  });

  console.log(`📡 Status: ${resp.status}`);
  const body = await resp.json();

  if (body.result && body.result.list) {
    console.log(`✅ Success! Found ${body.result.list.length} listings.`);
    fs.writeFileSync(
      "scripts/dabang_probe_result.json",
      JSON.stringify(body, null, 2),
    );
  } else {
    console.log("❌ Failed to get listings.");
    console.log(JSON.stringify(body, null, 2));
  }
}

probe();
