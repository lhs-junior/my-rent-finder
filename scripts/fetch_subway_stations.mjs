#!/usr/bin/env node

// 카카오 Local API (category SW8 = 지하철역) 로 서울 지하철역 좌표를 수집하여
// data/seoul_subway_stations.json 으로 저장한다.
// 무료 티어 한도: 300,000 req/day (쿼터 충분).

import fs from "node:fs";
import path from "node:path";

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY;
if (!KAKAO_KEY) {
  console.error("KAKAO_REST_API_KEY not set");
  process.exit(1);
}

const OUT_PATH = path.resolve("data/seoul_subway_stations.json");
const BASE = "https://dapi.kakao.com/v2/local/search/category.json";

// 서울 bbox
const SEOUL_BBOX = { swLat: 37.40, swLng: 126.75, neLat: 37.72, neLng: 127.22 };
const GRID = 6; // 6x6 = 36 cells (역당 ~0.08° ≒ 7km 커버)

async function fetchCell(rect) {
  const all = [];
  for (let page = 1; page <= 3; page += 1) {
    const url = `${BASE}?category_group_code=SW8&rect=${rect}&page=${page}&size=15`;
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
    if (!res.ok) {
      console.error(`kakao ${res.status} for rect=${rect} page=${page}`);
      break;
    }
    const json = await res.json();
    const docs = json?.documents || [];
    all.push(...docs);
    if (json?.meta?.is_end) break;
  }
  return all;
}

function parseLine(placeName) {
  // "강남역 2호선", "강남역 신분당선" 등에서 라인 추출
  const m = /(\d+호선|신분당선|분당선|수인분당선|경의중앙선|공항철도|경춘선|경강선|서해선|인천1호선|인천2호선|우이신설선|김포골드라인|신림선|GTX|공항철도)/.exec(placeName);
  return m ? m[1] : null;
}

function normalizeStationName(name) {
  return name
    .replace(/\s+/g, "")
    .replace(/역$/, "")
    .replace(/\(.*\)$/, "")
    .trim();
}

async function main() {
  const stations = new Map(); // key: place_name → doc
  const latStep = (SEOUL_BBOX.neLat - SEOUL_BBOX.swLat) / GRID;
  const lngStep = (SEOUL_BBOX.neLng - SEOUL_BBOX.swLng) / GRID;

  let cellCount = 0;
  for (let i = 0; i < GRID; i += 1) {
    for (let j = 0; j < GRID; j += 1) {
      const swLng = SEOUL_BBOX.swLng + j * lngStep;
      const swLat = SEOUL_BBOX.swLat + i * latStep;
      const neLng = swLng + lngStep;
      const neLat = swLat + latStep;
      // rect 포맷: x1,y1,x2,y2 (좌하 x,y 우상 x,y) — x=lng y=lat
      const rect = `${swLng.toFixed(6)},${swLat.toFixed(6)},${neLng.toFixed(6)},${neLat.toFixed(6)}`;
      cellCount += 1;
      const docs = await fetchCell(rect);
      for (const d of docs) {
        const key = d.place_name;
        if (!stations.has(key)) {
          stations.set(key, d);
        }
      }
    }
  }

  const list = [...stations.values()].map((d) => {
    const name = normalizeStationName(d.place_name.replace(/\s*(\d+호선|신분당선|분당선|수인분당선|경의중앙선|공항철도|경춘선|경강선|서해선|인천1호선|인천2호선|우이신설선|김포골드라인|신림선|GTX).*$/, ""));
    return {
      id: d.id,
      name,
      raw_name: d.place_name,
      line: parseLine(d.place_name),
      lat: Number(d.y),
      lng: Number(d.x),
      address: d.address_name || d.road_address_name || null,
    };
  }).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  // 같은 (name, lat round 3) 중복 제거 (복수 호선 환승역)
  const dedup = new Map();
  for (const s of list) {
    const key = `${s.name}|${s.lat.toFixed(3)}|${s.lng.toFixed(3)}`;
    if (!dedup.has(key)) dedup.set(key, s);
    else {
      const existing = dedup.get(key);
      // 여러 호선 합쳐서 보관
      const lines = new Set([existing.line, s.line].filter(Boolean));
      existing.lines = [...lines];
    }
  }
  const out = [...dedup.values()].map((s) => ({
    name: s.name,
    lines: s.lines || (s.line ? [s.line] : []),
    lat: Number(s.lat.toFixed(6)),
    lng: Number(s.lng.toFixed(6)),
    address: s.address,
  }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`cells=${cellCount} stations raw=${list.length} unique=${out.length}`);
  console.log(`saved → ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
