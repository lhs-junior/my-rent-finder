#!/usr/bin/env node
/**
 * KB부동산 — 매물일련번호 리스트 획득 최종 해결
 *
 * 전략:
 * 1) JS 번들에서 API URL 패턴 추출
 * 2) map250mBlwInfoList 응답을 모든 줌레벨에서 상세 분석
 * 3) 단지기본일련번호로 단지 매물 리스트 API 호출
 * 4) 클러스터 클릭 시뮬레이션 (Naver Map API)
 * 5) getLocInfoCnt 관련 API 탐색
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 매물ID 리스트 최종 해결 ===\n");

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().includes("kbland.kr")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) { console.log("✗ kbland.kr 탭 없음"); return; }
  console.log(`✓ 탭: ${page.url().substring(0, 80)}\n`);

  // Helper: page.evaluate(fetch)
  async function apiFetch(url, method = "GET", body = null) {
    return page.evaluate(async ({ u, m, b }) => {
      const opts = { method: m, credentials: "include" };
      if (b) { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(b); }
      const res = await fetch(u, opts);
      return { status: res.status, text: await res.text() };
    }, { u: url, m: method, b: body });
  }

  // ═══ 1. JS 번들에서 API URL 패턴 추출 ═══
  console.log("=== 1. JS 번들 API URL 분석 ===");
  const jsAnalysis = await page.evaluate(async () => {
    // 현재 페이지의 모든 script 태그에서 src 추출
    const scripts = Array.from(document.querySelectorAll("script[src]"))
      .map(s => s.src)
      .filter(s => s.includes("kbland") || s.includes("chunk") || s.includes("app"));

    // performance entries에서 JS 파일도 추가
    const perfJs = performance.getEntriesByType("resource")
      .filter(e => e.name.endsWith(".js") && (e.name.includes("kbland") || e.name.includes("js/")))
      .map(e => e.name);

    const allJs = [...new Set([...scripts, ...perfJs])];
    const results = { jsCount: allJs.length, jsFiles: allJs.slice(0, 15) };

    // 각 JS 파일에서 land-property, land-complex 관련 URL 패턴 검색
    const allUrls = new Set();
    const allPropertyUrls = [];

    for (const url of allJs.slice(0, 8)) {
      try {
        const res = await fetch(url);
        const text = await res.text();

        // /land-property/ 패턴
        const propMatches = text.match(/["'`]\/land-property\/[^"'`\s]{3,80}["'`]/g) || [];
        for (const m of propMatches) {
          const clean = m.replace(/["'`]/g, "");
          if (!allUrls.has(clean)) {
            allUrls.add(clean);
            allPropertyUrls.push(clean);
          }
        }

        // /land-complex/ 패턴
        const complexMatches = text.match(/["'`]\/land-complex\/[^"'`\s]{3,80}["'`]/g) || [];
        for (const m of complexMatches) {
          const clean = m.replace(/["'`]/g, "");
          if (!allUrls.has(clean)) {
            allUrls.add(clean);
            allPropertyUrls.push(clean);
          }
        }
      } catch {}
    }

    results.apiUrls = allPropertyUrls;
    return results;
  });

  console.log(`  JS 파일: ${jsAnalysis.jsCount}개`);
  console.log(`  발견된 API URL: ${jsAnalysis.apiUrls?.length || 0}개`);
  for (const url of jsAnalysis.apiUrls || []) {
    console.log(`    ${url}`);
  }

  // propList 또는 list가 포함된 URL 분리
  const listUrls = (jsAnalysis.apiUrls || []).filter(u =>
    u.includes("list") || u.includes("List") || u.includes("sale") || u.includes("Sale")
  );
  console.log(`\n  리스트 관련 URL: ${listUrls.length}개`);
  for (const u of listUrls) {
    console.log(`    ★ ${u}`);
  }

  // ═══ 2. map250mBlwInfoList 응답 상세 분석 (모든 줌레벨) ═══
  console.log("\n\n=== 2. map250mBlwInfoList 줌레벨별 상세 분석 ===");

  for (const zoom of [15, 16, 17, 18, 19, 20]) {
    const offset = zoom <= 16 ? 0.01 : zoom === 17 ? 0.005 : zoom === 18 ? 0.002 : zoom === 19 ? 0.001 : 0.0005;
    const body = {
      selectCode: "1,2,3", zoomLevel: zoom,
      startLat: 37.6055 - offset, startLng: 127.0824 - offset,
      endLat: 37.6055 + offset, endLng: 127.0824 + offset,
      "물건종류": "03,05", "거래유형": "3",
      "보증금시작값": "", "보증금종료값": "",
      "월세시작값": "", "월세종료값": "",
      "면적시작값": "", "면적종료값": "",
    };

    const result = await apiFetch(
      "https://api.kbland.kr/land-complex/map/map250mBlwInfoList",
      "POST", body
    );

    try {
      const json = JSON.parse(result.text);
      const data = json?.dataBody?.data;
      if (!data) { console.log(`  zoom ${zoom}: no data`); continue; }

      console.log(`\n  ── zoom ${zoom} (${result.text.length}b) ──`);
      console.log(`    keys: ${Object.keys(data).join(", ")}`);

      for (const [key, val] of Object.entries(data)) {
        if (Array.isArray(val)) {
          console.log(`    ${key}: Array(${val.length})`);
          if (val.length > 0 && typeof val[0] === "object") {
            const keys = Object.keys(val[0]);
            console.log(`      fields: ${keys.join(", ")}`);
            const has매물ID = keys.includes("매물일련번호");
            if (has매물ID) {
              console.log(`      ★★★ 매물일련번호 발견! ★★★`);
              console.log(`      IDs: ${val.slice(0, 10).map(x => x.매물일련번호).join(", ")}`);
            }
            console.log(`      sample: ${JSON.stringify(val[0]).substring(0, 300)}`);
          }
        } else if (typeof val === "object" && val) {
          console.log(`    ${key}: Object(${Object.keys(val).join(", ")})`);
        } else {
          console.log(`    ${key}: ${String(val).substring(0, 100)}`);
        }
      }
    } catch (e) {
      console.log(`  zoom ${zoom}: parse error — ${e.message}`);
    }
  }

  // ═══ 3. 발견된 list API 호출 테스트 ═══
  console.log("\n\n=== 3. 발견된 list API 호출 테스트 ===");

  // 기본 바운딩 박스 파라미터
  const baseBody = {
    selectCode: "1,2,3", zoomLevel: 17,
    startLat: 37.600, startLng: 127.077,
    endLat: 37.610, endLng: 127.088,
    "물건종류": "03,05", "거래유형": "3",
    "보증금시작값": "", "보증금종료값": "",
    "월세시작값": "", "월세종료값": "",
    "면적시작값": "", "면적종료값": "",
  };

  // 후보 엔드포인트 (JS에서 발견된 것 + 추측)
  const candidateEndpoints = [
    ...listUrls,
    // 추가 후보
    "/land-property/propList/stutCdFilter/list",
    "/land-property/propList/nonComplexList",
    "/land-property/propList/list",
    "/land-property/propList/mapList",
    "/land-property/property/list",
    "/land-complex/complex/saleList",
    "/land-complex/complex/nonComplexSaleList",
    "/land-complex/complexSale/list",
    "/land-property/property/getLocInfoList",
    "/land-property/property/getLocInfo",
  ];

  const testedUrls = new Set();
  for (const ep of candidateEndpoints) {
    if (testedUrls.has(ep)) continue;
    testedUrls.add(ep);

    const fullUrl = ep.startsWith("http") ? ep : `https://api.kbland.kr${ep}`;

    // POST 시도
    const postResult = await apiFetch(fullUrl, "POST", baseBody);
    try {
      const json = JSON.parse(postResult.text);
      const code = json?.dataHeader?.resultCode;
      const data = json?.dataBody?.data;
      const msg = json?.dataHeader?.message || "";

      if (code === "10000" || code === "Y200") {
        console.log(`  ★ POST ${ep}: SUCCESS (${code}) — ${msg}`);
        if (data) {
          if (Array.isArray(data)) {
            console.log(`    Array(${data.length})`);
            if (data[0]) {
              console.log(`    keys: ${Object.keys(data[0]).join(", ")}`);
              console.log(`    has매물ID: ${"매물일련번호" in data[0]}`);
              console.log(`    sample: ${JSON.stringify(data[0]).substring(0, 400)}`);
            }
          } else if (typeof data === "object") {
            console.log(`    Object keys: ${Object.keys(data).join(", ")}`);
            for (const [k, v] of Object.entries(data)) {
              if (Array.isArray(v) && v.length > 0) {
                console.log(`    ${k}: Array(${v.length})`);
                if (v[0] && typeof v[0] === "object") {
                  console.log(`      keys: ${Object.keys(v[0]).join(", ")}`);
                  console.log(`      has매물ID: ${"매물일련번호" in v[0]}`);
                  if ("매물일련번호" in v[0]) {
                    console.log(`      ★★★ IDs: ${v.slice(0, 10).map(x => x.매물일련번호).join(", ")}`);
                  }
                  console.log(`      sample: ${JSON.stringify(v[0]).substring(0, 400)}`);
                }
              }
            }
          }
        }
      } else {
        console.log(`  POST ${ep}: ${code} — ${msg}`);
      }
    } catch {
      console.log(`  POST ${ep}: ${postResult.status} — not JSON`);
    }

    // GET도 시도 (파라미터 포함)
    const getUrl = `${fullUrl}?selectCode=1,2,3&zoomLevel=17&startLat=37.600&startLng=127.077&endLat=37.610&endLng=127.088`;
    const getResult = await apiFetch(getUrl);
    try {
      const json = JSON.parse(getResult.text);
      const code = json?.dataHeader?.resultCode;
      if (code === "10000" || code === "Y200") {
        console.log(`  ★ GET ${ep}: SUCCESS (${code})`);
        const data = json?.dataBody?.data;
        if (data) {
          console.log(`    ${JSON.stringify(data).substring(0, 500)}`);
        }
      }
    } catch {}
  }

  // ═══ 4. getLocInfoCnt 상세 분석 + 관련 API ═══
  console.log("\n\n=== 4. getLocInfoCnt 상세 + 관련 API ===");

  const locInfoResult = await apiFetch(
    "https://api.kbland.kr/land-property/property/getLocInfoCnt?" +
    encodeURIComponent("법정동코드") + "=1126010300"
  );
  try {
    const json = JSON.parse(locInfoResult.text);
    console.log(`  getLocInfoCnt: ${json?.dataHeader?.resultCode}`);
    console.log(`  data: ${JSON.stringify(json?.dataBody?.data, null, 2)}`);
  } catch {}

  // getLocInfo 변형 시도
  for (const ep of [
    "getLocInfoList", "getLocInfo", "getLocInfoDetail",
    "list", "getPropertyListByDong", "getDongPropertyList",
  ]) {
    const url = `https://api.kbland.kr/land-property/property/${ep}?` +
      encodeURIComponent("법정동코드") + "=1126010300&" +
      encodeURIComponent("물건종류") + "=03,05&" +
      encodeURIComponent("거래유형") + "=3";
    const r = await apiFetch(url);
    try {
      const j = JSON.parse(r.text);
      const code = j?.dataHeader?.resultCode;
      if (code !== "10500" && code !== "40400") {
        console.log(`  ★ ${ep}: ${code} — ${j?.dataHeader?.message}`);
        if (j?.dataBody?.data) {
          console.log(`    ${JSON.stringify(j.dataBody.data).substring(0, 500)}`);
        }
      } else {
        console.log(`  ${ep}: ${code}`);
      }
    } catch {
      console.log(`  ${ep}: ${r.status} — not parseable`);
    }
  }

  // ═══ 5. 단지 매물리스트 API (complexSaleList) ═══
  console.log("\n\n=== 5. 단지 매물리스트 (complexSaleList) ===");

  // 먼저 map250mBlwInfoList에서 단지 가져오기
  const mapResult = await apiFetch(
    "https://api.kbland.kr/land-complex/map/map250mBlwInfoList",
    "POST", {
      selectCode: "1,2,3", zoomLevel: 17,
      startLat: 37.600, startLng: 127.077,
      endLat: 37.610, endLng: 127.088,
      "물건종류": "03,05", "거래유형": "3",
      "보증금시작값": "", "보증금종료값": "",
      "월세시작값": "", "월세종료값": "",
      "면적시작값": "", "면적종료값": "",
    }
  );

  let danjiIds = [];
  try {
    const mapJson = JSON.parse(mapResult.text);
    const mapData = mapJson?.dataBody?.data;
    const danjiList = mapData?.단지리스트 || [];
    danjiIds = danjiList.map(d => ({
      id: d.단지기본일련번호,
      name: d.단지명,
      count: d.매물개수,
      type: d.물건종류,
    })).filter(d => d.count > 0);
    console.log(`  매물 있는 단지: ${danjiIds.length}개 / 전체 ${danjiList.length}개`);
    for (const d of danjiIds.slice(0, 5)) {
      console.log(`    ${d.id}: ${d.name} (${d.count}건, type=${d.type})`);
    }
  } catch (e) {
    console.log(`  단지 파싱 실패: ${e.message}`);
  }

  // 각 단지에 대해 매물리스트 API 호출
  if (danjiIds.length > 0) {
    const target = danjiIds[0];
    console.log(`\n  대상 단지: ${target.id} ${target.name}`);

    // 다양한 endpoint로 시도
    const saleEndpoints = [
      { ep: "/land-complex/complex/saleList", method: "GET",
        url: `https://api.kbland.kr/land-complex/complex/saleList?${encodeURIComponent("단지기본일련번호")}=${target.id}` },
      { ep: "/land-complex/complexSale/list", method: "GET",
        url: `https://api.kbland.kr/land-complex/complexSale/list?${encodeURIComponent("단지기본일련번호")}=${target.id}` },
      { ep: "/land-complex/complex/saleList POST", method: "POST",
        url: "https://api.kbland.kr/land-complex/complex/saleList",
        body: { "단지기본일련번호": target.id } },
      { ep: "/land-property/propList/complexList", method: "POST",
        url: "https://api.kbland.kr/land-property/propList/complexList",
        body: { "단지기본일련번호": target.id, "물건종류": "03,05", "거래유형": "3" } },
    ];

    // JS에서 발견된 complex 관련 URL도 추가
    for (const jsUrl of (jsAnalysis.apiUrls || []).filter(u => u.includes("complex") && (u.includes("sale") || u.includes("Sale") || u.includes("list") || u.includes("List")))) {
      saleEndpoints.push({
        ep: `${jsUrl} GET`, method: "GET",
        url: `https://api.kbland.kr${jsUrl}?${encodeURIComponent("단지기본일련번호")}=${target.id}`,
      });
      saleEndpoints.push({
        ep: `${jsUrl} POST`, method: "POST",
        url: `https://api.kbland.kr${jsUrl}`,
        body: { "단지기본일련번호": target.id },
      });
    }

    for (const { ep, method, url, body } of saleEndpoints) {
      const r = await apiFetch(url, method, body || null);
      try {
        const j = JSON.parse(r.text);
        const code = j?.dataHeader?.resultCode;
        const data = j?.dataBody?.data;
        if (code === "10000" || code === "Y200") {
          console.log(`  ★★ ${ep}: SUCCESS (${code})`);
          if (data) {
            console.log(`    ${JSON.stringify(data).substring(0, 1000)}`);
          }
        } else {
          console.log(`  ${ep}: ${code} — ${j?.dataHeader?.message || ""}`);
        }
      } catch {
        console.log(`  ${ep}: ${r.status}`);
      }
    }
  }

  // ═══ 6. 클러스터 클릭 시뮬레이션 ═══
  console.log("\n\n=== 6. 클러스터 클릭 → 네트워크 캡처 ===");

  // 먼저 지도 페이지에 있는지 확인
  if (!page.url().includes("/map")) {
    await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
      waitUntil: "domcontentloaded", timeout: 25000,
    });
    await page.waitForTimeout(5000);
  }

  // 네트워크 캡처 시작
  const clickNetLog = [];
  const clickNetHandler = async (res) => {
    const url = res.url();
    if (!url.includes("api.kbland.kr")) return;
    if (url.includes("menu") || url.includes("banner") || url.includes("notice")
      || url.includes("marketing") || url.includes("stpulConsent")
      || url.includes("rankings") || url.includes("logData")
      || url.includes("hubLink") || url.includes("serviceAllow")) return;
    try {
      const body = await res.text();
      clickNetLog.push({
        url: url.substring(0, 200),
        method: res.request().method(),
        size: body.length,
        body: body.substring(0, 3000),
      });
    } catch {}
  };
  page.on("response", clickNetHandler);

  // Naver Map에서 클러스터 좌표를 화면 좌표로 변환 후 클릭
  const clickResult = await page.evaluate(async () => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no store" };

    const mapState = vm.$store.state.map;
    const clusters = mapState?.markerMaemulList || [];
    if (clusters.length === 0) return { error: "no clusters" };

    // 매물이 가장 많은 클러스터 선택
    const sorted = [...clusters].sort((a, b) => b.매물개수 - a.매물개수);
    const target = sorted[0];

    // Naver Map 인스턴스에서 좌표 → 화면 변환
    const mapInstance = mapState?.naverMapInstance;
    if (!mapInstance) return { error: "no map instance" };

    try {
      const coord = new naver.maps.LatLng(target.wgs84위도, target.wgs84경도);
      const pixel = mapInstance.getProjection().fromCoordToOffset(coord);
      const mapEl = mapInstance.getElement();
      const rect = mapEl.getBoundingClientRect();

      return {
        cluster: { id: target.클러스터식별자, count: target.매물개수 },
        pixel: { x: pixel.x + rect.left, y: pixel.y + rect.top },
        mapRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    } catch (e) {
      return { error: `projection: ${e.message}` };
    }
  });

  console.log(`  클러스터 클릭 대상: ${JSON.stringify(clickResult)}`);

  if (clickResult.pixel) {
    const { x, y } = clickResult.pixel;
    console.log(`  클릭 좌표: (${x}, ${y})`);

    // 클릭 실행
    await page.mouse.click(x, y);
    console.log("  클릭 후 5초 대기...");
    await page.waitForTimeout(5000);

    console.log(`  캡처된 API: ${clickNetLog.length}건`);
    for (const n of clickNetLog) {
      console.log(`    ${n.method} ${n.url} (${n.size}b)`);
      try {
        const json = JSON.parse(n.body);
        const data = json?.dataBody?.data;
        if (data) {
          if (Array.isArray(data) && data.length > 0 && data[0]?.매물일련번호) {
            console.log(`      ★★★ 매물일련번호 발견! Array(${data.length})`);
            console.log(`      IDs: ${data.slice(0, 20).map(d => d.매물일련번호).join(", ")}`);
          } else if (typeof data === "object") {
            for (const [k, v] of Object.entries(data)) {
              if (Array.isArray(v) && v.length > 0 && v[0]?.매물일련번호) {
                console.log(`      ★★★ ${k}: 매물일련번호 발견! Array(${v.length})`);
                console.log(`      IDs: ${v.slice(0, 20).map(d => d.매물일련번호).join(", ")}`);
              }
            }
          }
        }
      } catch {}
    }

    // 클릭 후 Vuex 상태 변화 확인
    const afterClick = await page.evaluate(() => {
      const vm = document.querySelector("#app")?.__vue__;
      const store = vm?.$store;
      if (!store) return {};

      const pList = store.state.property?.propertyList;
      const result = {
        propertyList: {
          isLoading: pList?.isLoading,
          hasData: pList?.data !== null && pList?.data !== undefined,
        },
      };

      if (Array.isArray(pList?.data)) {
        result.propertyList.count = pList.data.length;
        if (pList.data[0]) {
          result.propertyList.keys = Object.keys(pList.data[0]);
          result.propertyList.has매물ID = "매물일련번호" in pList.data[0];
          result.propertyList.sample = JSON.stringify(pList.data[0]).substring(0, 500);
        }
      }

      // URL 변화 확인
      result.currentUrl = window.location.href;

      // selectedMarker 변화
      result.selectedMarker = JSON.stringify(store.state.map?.selectedMarker).substring(0, 200);

      return result;
    });
    console.log(`\n  클릭 후 상태: ${JSON.stringify(afterClick, null, 2)}`);
  }

  page.off("response", clickNetHandler);

  // ═══ 7. 마지막 수단: DOM에서 매물 링크 추출 ═══
  console.log("\n\n=== 7. DOM에서 /p/ 링크 + 매물ID 추출 ===");
  const domIds = await page.evaluate(() => {
    // 모든 /p/ 링크
    const links = [];
    // Vue router-link는 data-v- 속성을 가짐
    const allEls = document.querySelectorAll("a, [class*='card'], [class*='item'], [class*='list']");
    for (const el of allEls) {
      const href = el.getAttribute("href") || el.getAttribute("to") || "";
      if (href.includes("/p/")) {
        const match = href.match(/\/p\/(\d+)/);
        if (match) links.push({ id: match[1], text: el.textContent?.trim()?.substring(0, 80) });
      }
    }

    // body 텍스트에서 숫자 패턴 (9자리 이상 — 매물일련번호 패턴)
    const bodyText = document.body.innerHTML;
    const idPattern = /\/p\/(\d{8,12})/g;
    const htmlIds = [];
    let m;
    while ((m = idPattern.exec(bodyText)) !== null) {
      htmlIds.push(m[1]);
    }

    return { links: [...new Set(links.map(l => l.id))], htmlIds: [...new Set(htmlIds)] };
  });

  console.log(`  DOM /p/ 링크: ${domIds.links?.length || 0}개`);
  if (domIds.links?.length > 0) {
    console.log(`  IDs: ${domIds.links.join(", ")}`);
  }
  console.log(`  HTML /p/ 패턴: ${domIds.htmlIds?.length || 0}개`);
  if (domIds.htmlIds?.length > 0) {
    console.log(`  IDs: ${domIds.htmlIds.join(", ")}`);
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
