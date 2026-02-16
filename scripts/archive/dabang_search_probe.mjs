#!/usr/bin/env node
import fs from "node:fs";

async function probe() {
  const keyword = "중랑구";
  const url = `https://www.dabangapp.com/api/v5/search/suggest?keyword=${encodeURIComponent(keyword)}`;

  console.log(`🚀 Probing Dabang Suggestion API for '${keyword}'...`);

  const resp = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "d-api-version": "5.0.0",
      "d-app-version": "1",
      "d-call-type": "web",
      csrf: "token",
    },
  });

  const body = await resp.json();
  console.log("✅ Response received:");
  console.log(JSON.stringify(body, null, 2));

  if (body.result && body.result.locations) {
    fs.writeFileSync(
      "scripts/dabang_location_codes.json",
      JSON.stringify(body.result.locations, null, 2),
    );
  }
}

probe();
