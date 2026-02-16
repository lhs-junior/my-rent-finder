#!/usr/bin/env node
/**
 * KB부동산 — Naver Map 마커에서 매물일련번호 추출 + bascInfo 호출
 * 전략: 줌레벨을 높여가며 클러스터가 개별 마커로 풀리는 시점 찾기
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 마커 ID 추출 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }

  // ═══ 전략 A: 지도 줌인 후 마커 클릭으로 매물ID 수집 ═══
  console.log("전략 A: 지도 줌인 + 마커 네비게이션\n");

  // 중랑구 중화동 지도로 이동 (zoom 17 — 개별 마커 보이는 수준)
  const captured = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("api.kbland.kr")) return;
    if (url.includes("bascInfo") || url.includes("stutCdFilter") || url.includes("map250m")) {
      try {
        const body = await res.text();
        captured.push({ url: url.substring(0, 200), body: body.substring(0, 5000), size: body.length });
      } catch {}
    }
  });

  // 중화동 지도 이동 (zoom 17)
  console.log("1. 중화동 지도 이동 (zoom 17)...");
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(6000);

  // Vuex에서 현재 마커 리스트 추출
  const markers17 = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no vuex" };
    const map = vm.$store.state.map;
    return {
      maemulList: map?.markerMaemulList?.map(m => ({
        id: m.클러스터식별자,
        count: m.매물개수,
        lat: m.wgs84위도,
        lng: m.wgs84경도,
      })) || [],
      danjiList: map?.markerDanjiList?.map(d => ({
        id: d.단지기본일련번호,
        name: d.단지명,
        count: d.매물개수,
        type: d.물건종류,
        lat: d.wgs84위도,
        lng: d.wgs84경도,
      })) || [],
      regionInfo: map?.currentRegionInfo,
      zoom: map?.mapZoomLevel,
    };
  });

  console.log(`  줌: ${markers17.zoom}`);
  console.log(`  매물 클러스터: ${markers17.maemulList.length}개`);
  console.log(`  단지: ${markers17.danjiList.length}개`);
  console.log(`  지역 매물수: ${markers17.regionInfo?.매물갯수}`);

  // 각 클러스터 좌표 출력
  for (const m of markers17.maemulList.slice(0, 5)) {
    console.log(`    클러스터 ${m.id}: ${m.count}건 (${m.lat},${m.lng})`);
  }

  // ═══ 전략 B: 줌 19로 이동해서 개별 마커 확인 ═══
  console.log("\n2. 줌 19로 확대 (개별 마커 확인)...");

  // 가장 매물이 많은 클러스터 중심으로 줌인
  const targetCluster = markers17.maemulList.sort((a, b) => b.count - a.count)[0];
  if (targetCluster) {
    console.log(`  대상: 클러스터 ${targetCluster.id} (${targetCluster.count}건)`);

    await page.goto(
      `https://kbland.kr/map?xy=${targetCluster.lat},${targetCluster.lng},19`,
      { waitUntil: "domcontentloaded", timeout: 25000 }
    );
    await page.waitForTimeout(6000);

    const markers19 = await page.evaluate(() => {
      const vm = document.querySelector("#app")?.__vue__;
      if (!vm?.$store) return { error: "no vuex" };
      const map = vm.$store.state.map;
      return {
        maemulList: map?.markerMaemulList?.map(m => ({
          id: m.클러스터식별자 || m.매물일련번호,
          count: m.매물개수,
          lat: m.wgs84위도,
          lng: m.wgs84경도,
          keys: Object.keys(m),
          raw: JSON.stringify(m).substring(0, 300),
        })) || [],
        danjiList: map?.markerDanjiList?.length || 0,
        zoom: map?.mapZoomLevel,
      };
    });

    console.log(`  줌: ${markers19.zoom}`);
    console.log(`  매물 마커: ${markers19.maemulList.length}개`);
    for (const m of markers19.maemulList.slice(0, 10)) {
      console.log(`    ${m.id}: ${m.count}건 keys=[${m.keys.join(",")}]`);
      console.log(`      ${m.raw}`);
    }
  }

  // ═══ 전략 C: 클러스터 클릭 시뮬레이션 ═══
  console.log("\n3. Naver Map 오버레이에서 마커 클릭...");

  // SPA 라우터로 직접 매물 목록 페이지 이동 시도
  const routerResult = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$router) return { error: "no router" };

    // 라우터에 등록된 경로 확인
    const routes = vm.$router.options?.routes || [];
    const propertyRoutes = routes.filter(r =>
      r.path?.includes("prop") || r.path?.includes("p/") ||
      r.path?.includes("list") || r.path?.includes("search")
    );

    return {
      totalRoutes: routes.length,
      propertyRoutes: propertyRoutes.map(r => ({
        path: r.path, name: r.name,
        children: r.children?.map(c => c.path).slice(0, 5),
      })).slice(0, 20),
      allPaths: routes.map(r => r.path).slice(0, 30),
    };
  });

  console.log(`  총 라우터 경로: ${routerResult.totalRoutes}개`);
  console.log(`  매물 관련 경로: ${routerResult.propertyRoutes?.length}개`);
  for (const r of routerResult.propertyRoutes || []) {
    console.log(`    ${r.path} (${r.name}) children: ${r.children?.join(", ") || "none"}`);
  }
  console.log(`  전체 경로: ${routerResult.allPaths?.join(", ")}`);

  // ═══ 전략 D: Vuex action dispatch로 매물 리스트 로드 ═══
  console.log("\n4. Vuex action으로 매물 리스트 로드 시도...");

  const actionResult = await page.evaluate(async () => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no vuex" };

    // Vuex store의 action 목록 확인
    const actions = Object.keys(vm.$store._actions || {});
    const propertyActions = actions.filter(a =>
      a.includes("property") || a.includes("Property") ||
      a.includes("propList") || a.includes("PropList") ||
      a.includes("maemul") || a.includes("Maemul") ||
      a.includes("list") || a.includes("List")
    );

    return {
      totalActions: actions.length,
      propertyActions: propertyActions.slice(0, 30),
      allActions: actions.slice(0, 50),
    };
  });

  console.log(`  총 actions: ${actionResult.totalActions}개`);
  console.log(`  매물 관련: ${actionResult.propertyActions?.join(", ")}`);

  // propertyList action이 있으면 dispatch 시도
  const listAction = actionResult.propertyActions?.find(a =>
    a.toLowerCase().includes("propertylist") || a.toLowerCase().includes("proplist")
  );
  if (listAction) {
    console.log(`\n  → ${listAction} 실행 시도...`);
    const dispatchResult = await page.evaluate(async ({ action }) => {
      const vm = document.querySelector("#app")?.__vue__;
      try {
        await vm.$store.dispatch(action, {
          selectCode: "1,2,3", zoomLevel: 17,
          startLat: 37.600, startLng: 127.077,
          endLat: 37.610, endLng: 127.087,
          "물건종류": "03,05", "거래유형": "3",
        });
        // 결과 확인
        const pList = vm.$store.state.property?.propertyList;
        return {
          isLoading: pList?.isLoading,
          hasData: pList?.data !== null,
          dataLength: Array.isArray(pList?.data) ? pList.data.length : null,
          sample: pList?.data ? JSON.stringify(pList.data).substring(0, 500) : null,
        };
      } catch (e) {
        return { error: e.message };
      }
    }, { action: listAction });
    console.log(`  결과: ${JSON.stringify(dispatchResult)}`);
  }

  // ═══ 전략 E: 검색 페이지 URL 패턴 탐색 ═══
  console.log("\n5. 검색/리스트 페이지 URL 패턴:");
  const searchUrls = [
    "https://kbland.kr/map/search?xy=37.6055,127.0824,17&category=다가구",
    "https://kbland.kr/list?xy=37.6055,127.0824,17",
    "https://kbland.kr/property/list?dong=중화동",
  ];
  for (const url of searchUrls) {
    console.log(`  ${url.substring(0, 80)}`);
  }

  // ═══ 전략 F: map250mBlwInfoList 응답에서 비단지 매물 확인 ═══
  console.log("\n6. map250mBlwInfoList 응답 상세 분석:");
  for (const c of captured) {
    if (c.url.includes("map250mBlwInfoList")) {
      try {
        const json = JSON.parse(c.body);
        const data = json?.dataBody?.data;
        if (data) {
          console.log(`  응답 크기: ${c.size}b`);
          console.log(`  키: ${Object.keys(data).join(", ")}`);
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v)) {
              console.log(`  ${k}: ${v.length}건`);
              if (v[0]) {
                console.log(`    keys: ${Object.keys(v[0]).join(", ")}`);
                const has매물ID = "매물일련번호" in v[0];
                console.log(`    has 매물일련번호: ${has매물ID}`);
                if (has매물ID) {
                  console.log(`    IDs: ${v.slice(0, 10).map(x => x.매물일련번호).join(", ")}`);
                }
                console.log(`    sample: ${JSON.stringify(v[0]).substring(0, 300)}`);
              }
            }
          }
        }
      } catch {}
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
