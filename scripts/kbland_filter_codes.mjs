#!/usr/bin/env node
/**
 * KB부동산 — propList/filter 물건종류 코드 탐색
 * 사이트가 사용하는 "01,05,41" 기반으로 올바른 코드 찾기
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== propList/filter 물건종류 코드 탐색 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ 탭 없음"); return; }

  async function callFilter(overrides) {
    const body = {
      selectCode: "1,2,3", zoomLevel: 17,
      startLat: 37.6026, startLng: 127.0760,
      endLat: 37.6104, endLng: 127.0889,
      "물건종류": "01,05,41", "거래유형": "1,2,3",
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
      "페이지번호": 1, "페이지목록수": 100,
      "중복타입": "02", "정렬타입": "date",
      "사진있는매물순": false,
      "전자계약여부": "0", "비대면대출여부": "0",
      "클린주택여부": "0", honeyYn: "0",
      "클러스터식별자": "51023101300",
      ...overrides,
    };

    return page.evaluate(async (b) => {
      const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
        credentials: "include",
      });
      return { status: res.status, text: await res.text() };
    }, body);
  }

  function summarize(r, label) {
    try {
      const json = JSON.parse(r.text);
      const code = json?.dataHeader?.resultCode;
      if (code !== "10000") return console.log(`  ${label}: ${code}`);
      const data = json?.dataBody?.data;
      const total = data?.총매물건수 || 0;
      const list = data?.propertyList || [];
      const types = {};
      const deals = {};
      for (const item of list) {
        types[item.매물종별구분명] = (types[item.매물종별구분명] || 0) + 1;
        deals[item.매물거래구분명] = (deals[item.매물거래구분명] || 0) + 1;
      }
      console.log(`  ${label}: 총${total}건, 반환${list.length}건`);
      console.log(`    유형: ${JSON.stringify(types)}`);
      console.log(`    거래: ${JSON.stringify(deals)}`);
      if (list.length > 0) {
        // 빌라/다가구 매물 확인
        const villaItems = list.filter(l =>
          l.매물종별구분명?.includes("빌라") || l.매물종별구분명?.includes("다가구") ||
          l.매물종별구분명?.includes("연립") || l.매물종별구분명?.includes("다세대") ||
          l.매물종별구분명?.includes("단독") || l.매물종별구분명?.includes("원룸")
        );
        console.log(`    빌라/다가구 관련: ${villaItems.length}건`);
        for (const v of villaItems.slice(0, 3)) {
          console.log(`      ${v.매물일련번호}: ${v.매물종별구분명} ${v.매물거래구분명} 월세${v.월세보증금}/${v.월세가} ${v.전용면적}㎡ ${v.읍면동명}`);
        }
      }
      return { total, list };
    } catch (e) {
      console.log(`  ${label}: 파싱 실패 ${e.message}`);
      return null;
    }
  }

  // ═══ 1. 사이트 기본값으로 확인 ═══
  console.log("=== 1. 사이트 기본값 (01,05,41 + 전체 거래) ===");
  summarize(await callFilter({}), "기본값");

  // ═══ 2. 거래유형별 ═══
  console.log("\n=== 2. 거래유형별 ===");
  summarize(await callFilter({ "거래유형": "3" }), "01,05,41 + 월세만");
  summarize(await callFilter({ "거래유형": "2" }), "01,05,41 + 전세만");
  summarize(await callFilter({ "거래유형": "1" }), "01,05,41 + 매매만");

  // ═══ 3. 물건종류 개별 테스트 ═══
  console.log("\n=== 3. 물건종류 개별 코드 ===");
  for (const code of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "41", "42", "43"]) {
    summarize(await callFilter({ "물건종류": code, "거래유형": "3" }), `물건종류=${code} + 월세`);
  }

  // ═══ 4. selectCode 변형 ═══
  console.log("\n=== 4. selectCode 변형 ===");
  for (const sc of ["1", "2", "3", "1,2", "1,3", "2,3", "1,2,3"]) {
    summarize(await callFilter({ selectCode: sc, "물건종류": "01,05,41", "거래유형": "3" }), `selectCode=${sc}`);
  }

  // ═══ 5. 중복타입 변형 ═══
  console.log("\n=== 5. 중복타입 변형 ===");
  for (const dt of ["01", "02", "03"]) {
    summarize(await callFilter({ "중복타입": dt, "거래유형": "3" }), `중복타입=${dt}`);
  }

  // ═══ 6. 성공하는 조합으로 빌라/다가구 월세 필터 ═══
  console.log("\n=== 6. 빌라/다가구 월세 + 조건 필터 ===");
  const r6 = await callFilter({
    "거래유형": "3",
    "보증금종료값": "6000",
    "월세종료값": "80",
    "면적시작값": "40",
  });
  const parsed6 = summarize(r6, "월세+조건필터");
  if (parsed6?.list) {
    console.log("\n  매물 상세 (처음 10개):");
    for (const item of parsed6.list.slice(0, 10)) {
      console.log(`    ${item.매물일련번호}: [${item.매물종별구분명}] ${item.매물거래구분명}`);
      console.log(`      ${item.읍면동명} ${item.상세번지내용||""} ${item.건물명||item.단지명||""}`);
      console.log(`      보증금 ${item.월세보증금||item.전세가||"-"}, 월세 ${item.월세가||"-"}, 면적 ${item.전용면적}㎡, ${item.방수}방`);
    }
  }

  // ═══ 7. 넓은 범위 (클러스터 없이) + 사이트 기본 필터 ═══
  console.log("\n=== 7. 클러스터 없이 넓은 범위 + 사이트 기본 필터 ===");
  summarize(await callFilter({
    startLat: 37.580, startLng: 127.060,
    endLat: 37.620, endLng: 127.105,
    "클러스터식별자": undefined,
    "거래유형": "3",
  }), "넓은범위+클러스터없음+월세");

  // 클러스터 없이도 되는지 확인 (빈 문자열)
  summarize(await callFilter({
    startLat: 37.580, startLng: 127.060,
    endLat: 37.620, endLng: 127.105,
    "클러스터식별자": "",
    "거래유형": "3",
  }), "넓은범위+클러스터빈값+월세");

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
