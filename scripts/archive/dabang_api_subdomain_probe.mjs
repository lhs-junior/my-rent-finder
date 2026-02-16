#!/usr/bin/env node
import fs from "node:fs";

async function probe() {
  const url = `https://api.dabangapp.com/v5/search/suggest?keyword=${encodeURIComponent("중랑구")}`;
  console.log(`🚀 Probing Dabang Mobile API Subdomain: ${url}...`);

  const resp = await fetch(url, {
    headers: {
      "user-agent": "Dabang/5.0.0 (iPhone; iOS 15.0; Scale/3.00)",
      accept: "application/json",
      "d-api-version": "5.0.0",
      "d-app-version": "1",
      "d-call-type": "app",
    },
  });

  console.log(`📡 Status: ${resp.status}`);
  const text = await resp.text();
  console.log("✅ Body Start:", text.substring(0, 200));
}

probe();
