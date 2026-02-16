#!/usr/bin/env node
/**
 * KB부동산 — propList/filter API 호출 + 매물일련번호 추출
 * 클러스터 클릭 시 호출되는 핵심 API 분석
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 propList/filter 분석 ===\n");

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

  // 네트워크 캡처
  const captured = [];
  page.on("request", async (req) => {
    const url = req.url();
    if (url.includes("propList/filter")) {
      captured.push({
        type: "req",
        method: req.method(),
        url,
        postData: req.postData(),
        headers: req.headers(),
      });
    }
  });
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("propList/filter")) {
      try {
        const body = await res.text();
        captured.push({
          type: "res",
          url,
          status: res.status(),
          size: body.length,
          body,
        });
      } catch {}
    }
  });

  // ═══ 1. 클러스터 페이지로 직접 이동 ═══
  console.log("1. 클러스터 페이지로 이동...");

  // 먼저 지도에서 클러스터 목록 가져오기
  await page.goto("https://kbland.kr/map?xy=37.6055,127.0824,17", {
    waitUntil: "domcontentloaded", timeout: 25000,
  });
  await page.waitForTimeout(5000);

  const clusters = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const list = vm?.$store?.state?.map?.markerMaemulList || [];
    return list.map(m => ({
      id: m.클러스터식별자,
      count: m.매물개수,
      lat: m.wgs84위도,
      lng: m.wgs84경도,
    })).sort((a, b) => b.count - a.count);
  });

  console.log(`  클러스터: ${clusters.length}개`);
  for (const c of clusters.slice(0, 5)) {
    console.log(`    ${c.id}: ${c.count}건 (${c.lat}, ${c.lng})`);
  }

  if (clusters.length === 0) {
    console.log("  ✗ 클러스터 없음");
    return;
  }

  // 가장 큰 클러스터의 /cl/ 페이지로 이동
  const target = clusters[0];
  console.log(`\n  대상: ${target.id} (${target.count}건)`);

  captured.length = 0;
  await page.goto(
    `https://kbland.kr/cl/${target.id}?xy=${target.lat},${target.lng},17`,
    { waitUntil: "domcontentloaded", timeout: 25000 }
  );
  console.log("  5초 대기...");
  await page.waitForTimeout(5000);

  // ═══ 2. propList/filter 응답 분석 ═══
  console.log("\n2. propList/filter 응답 분석:");
  console.log(`  캡처: ${captured.length}건`);

  for (const c of captured) {
    if (c.type === "req") {
      console.log(`\n  ── REQUEST ──`);
      console.log(`  ${c.method} ${c.url}`);
      if (c.postData) {
        console.log(`  Body: ${c.postData.substring(0, 2000)}`);
        try {
          const bodyJson = JSON.parse(c.postData);
          console.log(`  Body (parsed): ${JSON.stringify(bodyJson, null, 2).substring(0, 2000)}`);
        } catch {}
      }
    } else {
      console.log(`\n  ── RESPONSE (${c.size}b, status=${c.status}) ──`);
      try {
        const json = JSON.parse(c.body);
        const code = json?.dataHeader?.resultCode;
        console.log(`  resultCode: ${code}`);
        console.log(`  message: ${json?.dataHeader?.message}`);

        const data = json?.dataBody?.data;
        if (!data) {
          console.log(`  dataBody: ${JSON.stringify(json?.dataBody).substring(0, 500)}`);
          continue;
        }

        if (Array.isArray(data)) {
          console.log(`  data: Array(${data.length})`);
          if (data[0]) {
            console.log(`  keys: ${Object.keys(data[0]).join(", ")}`);
            const has매물ID = "매물일련번호" in data[0];
            console.log(`  has 매물일련번호: ${has매물ID}`);
            if (has매물ID) {
              console.log(`  ★★★ 매물일련번호 리스트 ★★★`);
              console.log(`  IDs: ${data.slice(0, 30).map(d => d.매물일련번호).join(", ")}`);
              console.log(`  총 ${data.length}건`);
            }
            console.log(`  sample[0]: ${JSON.stringify(data[0]).substring(0, 500)}`);
            if (data[1]) console.log(`  sample[1]: ${JSON.stringify(data[1]).substring(0, 500)}`);
          }
        } else if (typeof data === "object") {
          console.log(`  data keys: ${Object.keys(data).join(", ")}`);
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v)) {
              console.log(`  ${k}: Array(${v.length})`);
              if (v.length > 0 && typeof v[0] === "object") {
                const keys = Object.keys(v[0]);
                console.log(`    keys: ${keys.join(", ")}`);
                const has매물ID = keys.includes("매물일련번호");
                console.log(`    has 매물일련번호: ${has매물ID}`);
                if (has매물ID) {
                  console.log(`    ★★★ 매물일련번호 발견! ★★★`);
                  console.log(`    IDs: ${v.slice(0, 30).map(d => d.매물일련번호).join(", ")}`);
                  console.log(`    총 ${v.length}건`);
                }
                console.log(`    sample: ${JSON.stringify(v[0]).substring(0, 500)}`);
              }
            } else {
              console.log(`  ${k}: ${JSON.stringify(v).substring(0, 200)}`);
            }
          }
        }
      } catch (e) {
        console.log(`  파싱 실패: ${e.message}`);
        console.log(`  raw: ${c.body.substring(0, 500)}`);
      }
    }
  }

  // ═══ 3. 직접 API 호출 테스트 ═══
  console.log("\n\n3. propList/filter 직접 호출 테스트:");

  // 캡처된 request body를 재사용
  const reqCapture = captured.find(c => c.type === "req");
  if (reqCapture?.postData) {
    console.log("  캡처된 body로 재호출...");
    const result = await page.evaluate(async (body) => {
      const res = await fetch("https://api.kbland.kr/land-property/propList/filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include",
      });
      return { status: res.status, text: await res.text() };
    }, reqCapture.postData);

    try {
      const json = JSON.parse(result.text);
      console.log(`  status: ${result.status}, code: ${json?.dataHeader?.resultCode}`);
      const data = json?.dataBody?.data;
      if (Array.isArray(data)) {
        console.log(`  ★ 직접 호출 성공! ${data.length}건`);
        if (data[0]?.매물일련번호) {
          console.log(`  매물일련번호 (처음 20개): ${data.slice(0, 20).map(d => d.매물일련번호).join(", ")}`);
        }
      } else if (data && typeof data === "object") {
        for (const [k, v] of Object.entries(data)) {
          if (Array.isArray(v) && v.length > 0) {
            console.log(`  ★ ${k}: ${v.length}건`);
            if (v[0]?.매물일련번호) {
              console.log(`  매물일련번호: ${v.slice(0, 20).map(d => d.매물일련번호).join(", ")}`);
            }
          }
        }
      }
    } catch (e) {
      console.log(`  파싱 실패: ${e.message}`);
    }
  }

  // ═══ 4. 다른 클러스터에서도 테스트 ═══
  console.log("\n\n4. 다른 클러스터에서 추가 테스트:");
  for (const cl of clusters.slice(1, 4)) {
    captured.length = 0;
    await page.goto(
      `https://kbland.kr/cl/${cl.id}?xy=${cl.lat},${cl.lng},17`,
      { waitUntil: "domcontentloaded", timeout: 25000 }
    );
    await page.waitForTimeout(3000);

    const resCapture = captured.find(c => c.type === "res");
    if (resCapture) {
      try {
        const json = JSON.parse(resCapture.body);
        const data = json?.dataBody?.data;
        let count = 0;
        let ids = [];
        if (Array.isArray(data)) {
          count = data.length;
          ids = data.filter(d => d.매물일련번호).map(d => d.매물일련번호);
        } else if (data && typeof data === "object") {
          for (const v of Object.values(data)) {
            if (Array.isArray(v)) {
              count += v.length;
              ids.push(...v.filter(d => d.매물일련번호).map(d => d.매물일련번호));
            }
          }
        }
        console.log(`  ${cl.id} (${cl.count}건 예상): API 반환 ${count}건, 매물ID ${ids.length}개`);
        if (ids.length > 0) {
          console.log(`    IDs: ${ids.slice(0, 10).join(", ")}`);
        }
      } catch (e) {
        console.log(`  ${cl.id}: 파싱 실패 ${e.message}`);
      }
    } else {
      console.log(`  ${cl.id}: propList/filter 미호출`);
    }
  }

  // ═══ 5. Vuex에서 propertyList 확인 ═══
  console.log("\n\n5. Vuex propertyList 확인:");
  const vuexProp = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    const pList = vm?.$store?.state?.property?.propertyList;
    if (!pList) return { error: "no propertyList" };

    const result = {
      isLoading: pList.isLoading,
      hasData: pList.data !== null && pList.data !== undefined,
    };

    if (Array.isArray(pList.data)) {
      result.count = pList.data.length;
      if (pList.data[0]) {
        result.keys = Object.keys(pList.data[0]);
        result.has매물ID = "매물일련번호" in pList.data[0];
        result.sample = JSON.stringify(pList.data[0]).substring(0, 500);
      }
    }
    return result;
  });
  console.log(`  ${JSON.stringify(vuexProp, null, 2)}`);

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
