#!/usr/bin/env node
/**
 * KB부동산 API 테스트 2 - 클러스터 → 개별 매물 API 탐색
 * 클러스터식별자 "510212111" (노원구, 매물 29건)
 */

const BASE = "https://api.kbland.kr";

const headers = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Origin": "https://kbland.kr",
  "Referer": "https://kbland.kr/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
};

async function tryEndpoint(label, method, path, body = null) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  console.log(`\n--- ${label} ---`);
  try {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    console.log(`  ${res.status} | ${text.length}b`);

    try {
      const json = JSON.parse(text);
      const code = json.dataHeader?.resultCode;
      const msg = json.dataHeader?.message;
      if (code !== "10000") {
        console.log(`  → ${code} ${msg}`);
        return null;
      }
      console.log(`  → SUCCESS`);
      const data = json.dataBody?.data;
      if (data) {
        if (Array.isArray(data)) {
          console.log(`  Items: ${data.length}개`);
          if (data[0]) {
            console.log(`  Keys: ${Object.keys(data[0]).join(", ")}`);
            console.log(`  First: ${JSON.stringify(data[0]).substring(0, 800)}`);
          }
        } else if (typeof data === "object") {
          console.log(`  Keys: ${Object.keys(data).join(", ")}`);
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v) && v.length > 0) {
              console.log(`  Array "${k}": ${v.length}개`);
              console.log(`    Keys: ${Object.keys(v[0]).join(", ")}`);
              console.log(`    First: ${JSON.stringify(v[0]).substring(0, 800)}`);
            } else if (typeof v === "string" || typeof v === "number") {
              console.log(`  ${k}: ${v}`);
            }
          }
        }
      }
      // dataBody 직접 확인 (data 없을 때)
      if (!data && json.dataBody) {
        console.log(`  Body keys: ${Object.keys(json.dataBody).join(", ")}`);
        for (const [k, v] of Object.entries(json.dataBody)) {
          if (Array.isArray(v) && v.length > 0) {
            console.log(`  Array "${k}": ${v.length}개`);
            console.log(`    Keys: ${Object.keys(v[0]).join(", ")}`);
            console.log(`    First: ${JSON.stringify(v[0]).substring(0, 800)}`);
          }
        }
      }
      return json;
    } catch {
      console.log(`  Raw: ${text.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  return null;
}

// sniffer에서 캡처된 정확한 포맷의 필터 body
const fullFilterBody = {
  selectCode: "1,2,3",
  zoomLevel: 16,
  startLat: 37.665, startLng: 127.040,
  endLat: 37.680, endLng: 127.055,
  물건종류: "03,05",
  거래유형: "3",
  매매시작값: "", 매매종료값: "",
  보증금시작값: "", 보증금종료값: "",
  월세시작값: "", 월세종료값: "",
  면적시작값: "", 면적종료값: "",
  준공년도시작값: "", 준공년도종료값: "",
  방수: "", 욕실수: "",
  세대수시작값: "", 세대수종료값: "",
  관리비시작값: "", 관리비종료값: "",
  용적률시작값: "", 용적률종료값: "",
  건폐율시작값: "", 건폐율종료값: "",
  전세가율시작값: "", 전세가율종료값: "",
  매매전세차시작값: "", 매매전세차종료값: "",
  월세수익률시작값: "", 월세수익률종료값: "",
  구조: "", 주차: "", 엘리베이터: "", 보안옵션: "",
};

async function main() {
  console.log("=== KB API 테스트 2: 클러스터 → 매물 리스트 ===\n");

  // 1. 클러스터 ID로 매물 리스트 조회
  const clusterId = "510212111";

  await tryEndpoint("1a. propList by 클러스터식별자", "POST",
    "/land-property/propList/stutCdFilter/list",
    { ...fullFilterBody, 클러스터식별자: clusterId }
  );

  await tryEndpoint("1b. propList by 클러스터식별자 (GET params)", "GET",
    `/land-property/propList/stutCdFilter/list?${encodeURIComponent("클러스터식별자")}=${clusterId}&${encodeURIComponent("물건종류")}=03,05&${encodeURIComponent("거래유형")}=3`
  );

  // 2. 매물 리스트 조회 - stutCdFilter 정확한 포맷
  await tryEndpoint("2a. stutCdFilter/list (full body)", "POST",
    "/land-property/propList/stutCdFilter/list",
    fullFilterBody
  );

  // 3. 법정동코드 기반 조회
  await tryEndpoint("3a. propList with 법정동코드", "POST",
    "/land-property/propList/list",
    { ...fullFilterBody, 법정동코드: "1135010100" }  // 노원구 월계동
  );

  // 4. 매물 리스트 - 다른 경로
  await tryEndpoint("4a. land-property/propList/propListByNonComplex", "POST",
    "/land-property/propList/propListByNonComplex",
    { ...fullFilterBody, 클러스터식별자: clusterId }
  );

  await tryEndpoint("4b. land-property/propList/propListByCluster", "POST",
    "/land-property/propList/propListByCluster",
    { 클러스터식별자: clusterId, 물건종류: "03,05", 거래유형: "3", page: 1, size: 20 }
  );

  // 5. higher zoom level에서 개별 매물 나오는지 확인
  console.log("\n=== 줌 레벨별 매물리스트 변화 ===");
  for (const zoom of [16, 17, 18, 19]) {
    const res = await tryEndpoint(
      `5. map250mBlwInfoList zoom=${zoom}`,
      "POST",
      "/land-complex/map/map250mBlwInfoList",
      { ...fullFilterBody, zoomLevel: zoom }
    );
    if (res?.dataBody?.data?.매물리스트) {
      const list = res.dataBody.data.매물리스트;
      console.log(`  매물리스트: ${list.length}개`);
      for (const item of list.slice(0, 3)) {
        console.log(`    ${JSON.stringify(item).substring(0, 300)}`);
      }
    }
  }

  // 6. 매물 상세 API 후보
  await tryEndpoint("6a. property/detail", "POST",
    "/land-property/property/detail",
    { 물건식별자: "KBA001474" }
  );

  await tryEndpoint("6b. property/propertyDetail", "GET",
    `/land-property/property/propertyDetail?${encodeURIComponent("물건식별자")}=KBA001474`
  );

  // 7. propList에 정확한 sniffer 포맷 사용
  await tryEndpoint("7a. propList/stutCd (zoomLevel 17)", "POST",
    "/land-property/propList/stutCd",
    { ...fullFilterBody, zoomLevel: 17 }
  );

  await tryEndpoint("7b. propList/propListInArea", "POST",
    "/land-property/propList/propListInArea",
    { ...fullFilterBody, zoomLevel: 17 }
  );

  // 8. 클러스터 식별자 510212111 → 이것이 법정동코드의 변형인지 확인
  // 노원구 법정동코드: 1135010100 (월계동), 1135010200 (공릉동), ...
  // 510212111 → 5자리 + 4자리?
  // 시도: selectCode 변경
  await tryEndpoint("8. propList/stutCdFilter with selectCode=3", "POST",
    "/land-property/propList/stutCdFilter/count",
    { ...fullFilterBody, selectCode: "3" }
  );

  console.log("\n=== 테스트 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
