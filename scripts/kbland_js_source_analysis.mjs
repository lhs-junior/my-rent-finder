#!/usr/bin/env node
/**
 * KB부동산 — JS 소스 분석으로 매물 리스트 API 엔드포인트 찾기
 * Webpack chunk에서 propList, 매물리스트, listing 관련 API URL 패턴 탐색
 */
import { chromium } from "playwright";

async function main() {
  console.log("=== KB부동산 JS 소스 분석 ===\n");

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

  // 1. Vuex action 소스코드에서 API URL 추출
  console.log("=== 1. Vuex Action 소스코드 분석 ===");
  const actionAnalysis = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no store" };

    const results = {};
    const actions = vm.$store._actions;

    // 관심 있는 action 목록
    const targetActions = [
      "property/getAsyncPropertyList",
      "property/getPropertyList",
      "complex/getComplexSaleList",
      "map/getMapMarkerList",
      "map/getMap250mBlwInfoList",
    ];

    for (const name of targetActions) {
      if (actions[name]) {
        // action 함수의 소스코드 추출
        const fn = actions[name][0];
        const src = fn.toString().substring(0, 2000);
        results[name] = src;
      }
    }

    // 모든 action 중 "list" 관련 action의 소스도 확인
    const listActions = Object.keys(actions).filter(a =>
      a.toLowerCase().includes("list") || a.toLowerCase().includes("sale")
    );
    results._listActions = listActions;

    for (const name of listActions) {
      if (!results[name] && actions[name]) {
        const fn = actions[name][0];
        results[name] = fn.toString().substring(0, 1000);
      }
    }

    return results;
  });

  for (const [name, src] of Object.entries(actionAnalysis)) {
    if (name === "_listActions") {
      console.log(`\n  리스트 관련 actions: ${src.join(", ")}`);
      continue;
    }
    console.log(`\n  ── ${name} ──`);
    console.log(`  ${src?.substring(0, 500)}`);

    // URL 패턴 추출
    const urlMatches = src?.match(/["'`][/][a-zA-Z0-9\-/]+["'`]/g);
    if (urlMatches) {
      console.log(`  URLs: ${urlMatches.join(", ")}`);
    }
  }

  // 2. Vuex mutation/getter 분석
  console.log("\n\n=== 2. Vuex Mutation 분석 ===");
  const mutationAnalysis = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no store" };

    const mutations = vm.$store._mutations;
    const propMutations = Object.keys(mutations).filter(m =>
      m.includes("property") || m.includes("Property") ||
      m.includes("propList") || m.includes("PropList")
    );

    const result = { propMutations };
    for (const name of propMutations) {
      const fn = mutations[name][0];
      result[name] = fn.toString().substring(0, 500);
    }
    return result;
  });

  console.log(`  property 관련 mutations: ${mutationAnalysis.propMutations?.join(", ")}`);
  for (const [name, src] of Object.entries(mutationAnalysis)) {
    if (name === "propMutations") continue;
    console.log(`\n  ── ${name} ──`);
    console.log(`  ${src?.substring(0, 300)}`);
  }

  // 3. 네트워크에서 JS chunk 파일 URL 가져와서 API 패턴 검색
  console.log("\n\n=== 3. JS Chunk에서 API URL 패턴 검색 ===");
  const jsApiPatterns = await page.evaluate(async () => {
    // performance entries에서 JS 파일 URL 추출
    const entries = performance.getEntriesByType("resource");
    const jsFiles = entries
      .filter(e => e.name.includes(".js") && e.name.includes("kbland"))
      .map(e => e.name);

    const results = { jsFiles: jsFiles.slice(0, 10) };

    // 각 JS 파일에서 API URL 패턴 검색 (최대 3개 파일만)
    for (const url of jsFiles.slice(0, 5)) {
      try {
        const res = await fetch(url);
        const text = await res.text();

        // propList, propertyList, 매물리스트 패턴 검색
        const patterns = [
          /["'`]\/land-property\/[^"'`]+["'`]/g,
          /["'`]\/land-complex\/[^"'`]+["'`]/g,
          /propList[A-Za-z]*/g,
          /propertyList/g,
          /complexSaleList/g,
          /nonComplex/g,
          /매물리스트/g,
        ];

        const matches = {};
        for (const pat of patterns) {
          const found = text.match(pat);
          if (found) {
            matches[pat.source] = [...new Set(found)].slice(0, 10);
          }
        }

        if (Object.keys(matches).length > 0) {
          results[url.split("/").pop()] = matches;
        }
      } catch (e) {
        results[url.split("/").pop()] = { error: e.message };
      }
    }

    return results;
  });

  console.log(`  JS 파일: ${jsApiPatterns.jsFiles?.length || 0}개`);
  for (const [file, data] of Object.entries(jsApiPatterns)) {
    if (file === "jsFiles") continue;
    console.log(`\n  ── ${file} ──`);
    for (const [pattern, matches] of Object.entries(data)) {
      console.log(`    ${pattern}: ${JSON.stringify(matches)}`);
    }
  }

  // 4. Vuex store의 property module에서 API service 객체 추출
  console.log("\n\n=== 4. Property Module 내부 API 서비스 분석 ===");
  const serviceAnalysis = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no store" };

    // store._modules 탐색
    const modules = vm.$store._modules;
    const result = {};

    if (modules?.root?._children) {
      const children = modules.root._children;
      for (const [name, mod] of Object.entries(children)) {
        if (name === "property" || name === "complex" || name === "map") {
          // rawModule에서 actions의 소스 확인
          const rawActions = mod._rawModule?.actions;
          if (rawActions) {
            result[`${name}_actions`] = Object.keys(rawActions);
            // 각 action의 소스에서 API URL 추출
            for (const [aName, aFn] of Object.entries(rawActions)) {
              const src = aFn.toString();
              const apiUrls = src.match(/["'`]\/land-[^"'`]+["'`]/g);
              if (apiUrls) {
                result[`${name}/${aName}_urls`] = [...new Set(apiUrls)];
              }
            }
          }
        }
      }
    }

    return result;
  });

  for (const [key, val] of Object.entries(serviceAnalysis)) {
    console.log(`  ${key}: ${JSON.stringify(val)}`);
  }

  // 5. complex/getComplexSaleList의 정확한 API URL 확인
  console.log("\n\n=== 5. 단지 매물리스트 상세 분석 ===");
  const complexDetail = await page.evaluate(() => {
    const vm = document.querySelector("#app")?.__vue__;
    if (!vm?.$store) return { error: "no store" };

    // complex module의 모든 action 소스
    const modules = vm.$store._modules;
    const complexMod = modules?.root?._children?.complex;
    if (!complexMod) return { error: "no complex module" };

    const rawActions = complexMod._rawModule?.actions || {};
    const result = {};
    for (const [name, fn] of Object.entries(rawActions)) {
      const src = fn.toString();
      result[name] = {
        source: src.substring(0, 1500),
        hasApiUrl: /["'`]\/land-/.test(src),
        hasFetch: /fetch|axios|http|request/.test(src),
        hasDispatch: /dispatch/.test(src),
        hasCommit: /commit/.test(src),
      };
    }
    return result;
  });

  for (const [name, info] of Object.entries(complexDetail)) {
    if (typeof info === "object" && info.source) {
      console.log(`\n  ── complex/${name} ──`);
      console.log(`  hasApiUrl: ${info.hasApiUrl}, hasFetch: ${info.hasFetch}`);
      console.log(`  source: ${info.source.substring(0, 600)}`);
    }
  }

  console.log("\n=== 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
