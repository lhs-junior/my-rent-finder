#!/usr/bin/env node
/**
 * KB부동산 — propList/filter 커스텀 필터 테스트
 * 1) 클러스터 없이 bounding box만으로 호출 가능한지
 * 2) 물건종류=03,05 (빌라+다가구) + 거래유형=3 (월세)로 호출 가능한지
 * 3) 페이지목록수 증가 가능한지
 * 4) 여러 클러스터 순회하여 전체 매물 수집 가능한지
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== propList/filter 커스텀 필터 테스트 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }

  // 지도 페이지로 이동
  if (!page.url().includes("/map")) {
    await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
      waitUntil: "domcontentloaded", timeout: 25000,
    });
    await page.waitForTimeout(5000);
  }

  async function callFilter(params) {
    return page.evaluate(async (body) => {
      const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      return { status: res.status, text: await res.text() };
    }, params);
  }

  function parseResult(result, label) {
    try {
      const json = JSON.parse(result.text);
      const code = json?.dataHeader?.resultCode;
      const data = json?.dataBody?.data;
      if (code !== "10000") {
        console.log(`  ${label}: ${code} — ${json?.dataHeader?.message}`);
        return null;
      }
      const total = data?.총매물건수 || 0;
      const list = data?.propertyList || [];
      const pageCount = data?.페이지개수 || 0;
      console.log(`  ${label}: ✓ 총${total}건, 이번 페이지 ${list.length}건, 총 ${pageCount}페이지`);
      if (list.length > 0) {
        const sample = list[0];
        console.log(`    매물일련번호: ${sample.매물일련번호}`);
        console.log(`    매물종별구분명: ${sample.매물종별구분명}`);
        console.log(`    매물거래구분명: ${sample.매물거래구분명}`);
        console.log(`    읍면동명: ${sample.읍면동명}`);
        console.log(`    월세가: ${sample.월세가}, 월세보증금: ${sample.월세보증금}`);
        console.log(`    전세가: ${sample.전세가}, 매매가: ${sample.매매가}`);
        console.log(`    전용면적: ${sample.전용면적}, 공급면적: ${sample.공급면적}`);
        console.log(`    방수: ${sample.방수}, 해당층수: ${sample.해당층수}`);
      }
      return { total, list, pageCount, data };
    } catch (e) {
      console.log(`  ${label}: 파싱 실패 — ${e.message}`);
      return null;
    }
  }

  // 기본 body 템플릿
  const baseBody = {
    selectCode: "1,2,3",
    zoomLevel: 17,
    startLat: 37.6026, startLng: 127.0760,
    endLat: 37.6104, endLng: 127.0889,
    "매매시작값": "", "매매종료값": "",
    "보증금시작값": "", "보증금종료값": "",
    "월세시작값": "", "월세종료값": "",
    "면적시작값": "", "면적종료값": "",
    "준공년도시작값": "", "준공년도종료값": "",
    "방수": "", "욕실수": "",
    "세대수시작값": "", "세대수종료값": "",
    "관리비시작값": "", "관리비종료값": "",
    "용적률시작값": "", "용적률종료값": "",
    "건폐율시작값": "", "건폐율종료값": "",
    "전세가율시작값": "", "전세가율종료값": "",
    "매매전세차시작값": "", "매매전세차종료값": "",
    "월세수익률시작값": "", "월세수익률종료값": "",
    "구조": "", "주차": "", "엘리베이터": "", "보안옵션": "",
    "매물": "", "융자금": "",
    "분양단지구분코드": "", "일반분양여부": "",
    "분양진행단계코드": "",
    "옵션": "", "점포수시작값": "", "점포수종료값": "",
    "지상층": "", "지하층": "", "지목": "", "용도지역": "", "추진현황": "",
    webCheck: "Y",
    "페이지번호": 1, "페이지목록수": 30,
    "중복타입": "02", "정렬타입": "date",
    "사진있는매물순": false,
    "전자계약여부": "0", "비대면대출여부": "0",
    "클린주택여부": "0", honeyYn: "0",
  };

  // ═══ 테스트 1: 클러스터 없이 호출 ═══
  console.log("=== 테스트 1: 클러스터ID 없이 bounding box만 ===");
  const r1 = await callFilter({
    ...baseBody,
    "물건종류": "03,05",
    "거래유형": "3",
  });
  parseResult(r1, "클러스터 없음 + 03,05 + 월세");

  // ═══ 테스트 2: 클러스터 포함 + 커스텀 필터 ═══
  console.log("\n=== 테스트 2: 클러스터 + 커스텀 필터 ===");
  const r2 = await callFilter({
    ...baseBody,
    "물건종류": "03,05",
    "거래유형": "3",
    "클러스터식별자": "51023101300",
  });
  parseResult(r2, "클러스터 + 03,05 + 월세");

  // ═══ 테스트 3: 페이지목록수 100 ═══
  console.log("\n=== 테스트 3: 페이지목록수=100 ===");
  const r3 = await callFilter({
    ...baseBody,
    "물건종류": "03,05",
    "거래유형": "3",
    "클러스터식별자": "51023101300",
    "페이지목록수": 100,
  });
  parseResult(r3, "100개/페이지");

  // ═══ 테스트 4: 보증금/월세 필터 ═══
  console.log("\n=== 테스트 4: 보증금/월세 필터 ===");
  const r4 = await callFilter({
    ...baseBody,
    "물건종류": "03,05",
    "거래유형": "3",
    "보증금종료값": "6000",
    "월세종료값": "80",
    "면적시작값": "40",
    "클러스터식별자": "51023101300",
    "페이지목록수": 100,
  });
  const parsed4 = parseResult(r4, "필터 적용");
  if (parsed4?.list?.length > 0) {
    console.log("\n  ── 필터 적용 매물 상세 ──");
    for (const item of parsed4.list.slice(0, 5)) {
      console.log(`    ${item.매물일련번호}: ${item.매물종별구분명} ${item.매물거래구분명}`);
      console.log(`      ${item.읍면동명} ${item.상세번지내용} ${item.건물명||item.단지명||""}`);
      console.log(`      월세 ${item.월세보증금}/${item.월세가}, 면적 ${item.전용면적}㎡, ${item.방수}방 ${item.해당층수}/${item.총층수}층`);
    }
  }

  // ═══ 테스트 5: 넓은 범위 (구 전체) + 페이지네이션 ═══
  console.log("\n=== 테스트 5: 중랑구 전체 범위 ===");

  // 중랑구 bounding box (넓은 범위)
  const r5 = await callFilter({
    ...baseBody,
    startLat: 37.580, startLng: 127.060,
    endLat: 37.620, endLng: 127.105,
    "물건종류": "03,05",
    "거래유형": "3",
    "보증금종료값": "6000",
    "월세종료값": "80",
    "면적시작값": "40",
    "페이지목록수": 100,
    "페이지번호": 1,
  });
  const parsed5 = parseResult(r5, "중랑구 전체 p1");

  if (parsed5?.pageCount > 1) {
    console.log(`\n  총 ${parsed5.pageCount}페이지 — 2페이지 호출...`);
    const r5p2 = await callFilter({
      ...baseBody,
      startLat: 37.580, startLng: 127.060,
      endLat: 37.620, endLng: 127.105,
      "물건종류": "03,05",
      "거래유형": "3",
      "보증금종료값": "6000",
      "월세종료값": "80",
      "면적시작값": "40",
      "페이지목록수": 100,
      "페이지번호": 2,
    });
    parseResult(r5p2, "중랑구 전체 p2");
  }

  // ═══ 테스트 6: 클러스터 없이 넓은 범위 ═══
  console.log("\n=== 테스트 6: 클러스터 없이 넓은 범위 ===");
  const r6 = await callFilter({
    ...baseBody,
    startLat: 37.580, startLng: 127.060,
    endLat: 37.620, endLng: 127.105,
    "물건종류": "03,05",
    "거래유형": "3",
    "페이지목록수": 100,
    "페이지번호": 1,
  });
  parseResult(r6, "클러스터 없음 + 넓은 범위");

  // ═══ 테스트 7: 모든 클러스터 순회 ═══
  console.log("\n=== 테스트 7: 모든 클러스터 순회 (전체 매물 수집) ===");

  // Vuex에서 클러스터 목록 가져오기
  const allClusters = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    return (vm?.$store?.state?.map?.markerMaemulList || []).map(m => ({
      id: m.클러스터식별자,
      count: m.매물개수,
    }));
  });

  console.log(`  클러스터: ${allClusters.length}개`);
  let totalIds = new Set();

  for (const cl of allClusters) {
    const r = await callFilter({
      ...baseBody,
      "물건종류": "03,05",
      "거래유형": "3",
      "보증금종료값": "6000",
      "월세종료값": "80",
      "면적시작값": "40",
      "클러스터식별자": cl.id,
      "페이지목록수": 100,
      "페이지번호": 1,
    });

    try {
      const json = JSON.parse(r.text);
      const data = json?.dataBody?.data;
      const list = data?.propertyList || [];
      const total = data?.총매물건수 || 0;
      const ids = list.map(l => l.매물일련번호).filter(Boolean);
      ids.forEach(id => totalIds.add(id));
      console.log(`    ${cl.id}: 총${total}건, 반환${list.length}건, 매물ID ${ids.length}개`);
    } catch {
      console.log(`    ${cl.id}: 실패`);
    }
  }

  console.log(`\n  ★ 전체 고유 매물일련번호: ${totalIds.size}개`);
  console.log(`  IDs: ${[...totalIds].slice(0, 30).join(", ")}`);

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
