#!/usr/bin/env node
/**
 * KB부동산 API 직접 호출 테스트
 * - 브라우저 없이 Node.js fetch로 API 엔드포인트 탐색
 * - 매물 리스트 API 발견이 목표
 */

const BASE = "https://api.kbland.kr";

// 노원구 좌표 (중심: 37.6542, 127.0568)
const 노원구 = {
  startLat: 37.625, startLng: 127.030,
  endLat: 37.680, endLng: 127.085,
};

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
  console.log(`  ${method} ${url}`);
  try {
    const opts = { method, headers, timeout: 10000 };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    console.log(`  Status: ${res.status}`);
    const text = await res.text();
    console.log(`  Size: ${text.length}b`);

    try {
      const json = JSON.parse(text);
      const code = json.dataHeader?.resultCode;
      const msg = json.dataHeader?.message;
      console.log(`  Result: ${code} - ${msg}`);

      const data = json.dataBody?.data;
      if (data) {
        if (Array.isArray(data)) {
          console.log(`  Items: ${data.length}개`);
          if (data[0]) console.log(`  First keys: ${Object.keys(data[0]).join(", ")}`);
          if (data[0]) console.log(`  First item: ${JSON.stringify(data[0]).substring(0, 500)}`);
        } else if (typeof data === "object") {
          console.log(`  Keys: ${Object.keys(data).join(", ")}`);
          // 배열 필드 찾기
          for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v) && v.length > 0) {
              console.log(`  Array "${k}": ${v.length}개`);
              console.log(`  First keys: ${Object.keys(v[0]).join(", ")}`);
              console.log(`  First: ${JSON.stringify(v[0]).substring(0, 500)}`);
            }
          }
        }
      }
      return json;
    } catch {
      console.log(`  Preview: ${text.substring(0, 300)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  return null;
}

async function main() {
  console.log("=== KB부동산 API 직접 호출 테스트 ===\n");

  // 1. 지도 마커 리스트 (이미 작동 확인됨)
  await tryEndpoint(
    "1. map250mBlwInfoList (노원구 빌라+단독 월세)",
    "POST",
    "/land-complex/map/map250mBlwInfoList",
    {
      selectCode: "1,2,3",
      zoomLevel: 14,
      ...노원구,
      물건종류: "03,05",      // 03=빌라/연립, 05=단독/다가구
      거래유형: "3",           // 3=월세
      매매시작값: "", 매매종료값: "",
      보증금시작값: "", 보증금종료값: "6000",
      월세시작값: "", 월세종료값: "80",
      면적시작값: "40", 면적종료값: "",
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
    }
  );

  // 2. 매물 건수 확인
  await tryEndpoint(
    "2. propList/stutCdFilter/count (노원구)",
    "POST",
    "/land-property/propList/stutCdFilter/count",
    {
      selectCode: "1,2,3",
      zoomLevel: 14,
      ...노원구,
      물건종류: "03,05",
      거래유형: "3",
      매매시작값: "", 매매종료값: "",
      보증금시작값: "", 보증금종료값: "6000",
      월세시작값: "", 월세종료값: "80",
      면적시작값: "40", 면적종료값: "",
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
    }
  );

  // 3. 매물 리스트 API 후보들 시도
  const propListBody = {
    법정동코드: "1135000000",  // 노원구
    물건종류: "03,05",
    거래유형: "3",
    보증금종료값: "6000",
    월세종료값: "80",
    면적시작값: "40",
    page: 1,
    pageSize: 20,
    정렬구분: "",
  };

  // 3a. propList/list
  await tryEndpoint("3a. propList/list", "POST", "/land-property/propList/list", propListBody);

  // 3b. propList/search
  await tryEndpoint("3b. propList/search", "POST", "/land-property/propList/search", propListBody);

  // 3c. propList/propListMap
  await tryEndpoint("3c. propList/propListMap", "POST", "/land-property/propList/propListMap", propListBody);

  // 3d. property/list
  await tryEndpoint("3d. property/list", "POST", "/land-property/property/list", propListBody);

  // 3e. property/search
  await tryEndpoint("3e. property/search", "POST", "/land-property/property/search", propListBody);

  // 4. 좌표 기반 매물 리스트 시도
  const coordBody = {
    ...노원구,
    zoomLevel: 16,
    물건종류: "03,05",
    거래유형: "3",
    보증금시작값: "", 보증금종료값: "6000",
    월세시작값: "", 월세종료값: "80",
    면적시작값: "40", 면적종료값: "",
    page: 1,
    pageSize: 20,
  };

  // 4a. propList/mapList
  await tryEndpoint("4a. propList/mapList", "POST", "/land-property/propList/mapList", coordBody);

  // 4b. propList/propList
  await tryEndpoint("4b. propList/propList", "POST", "/land-property/propList/propList", coordBody);

  // 4c. map/propertyList
  await tryEndpoint("4c. map/propertyList", "POST", "/land-complex/map/propertyList", coordBody);

  // 5. 단지 상세 + 매물 리스트 (단지일련번호 기반)
  // map250mBlwInfoList에서 가져온 단지번호로 매물 조회
  await tryEndpoint(
    "5a. 단지 매물 리스트",
    "POST",
    "/land-property/propList/propListByComplex",
    { 단지기본일련번호: 2172, 물건종류: "41", 거래유형: "3", page: 1, pageSize: 20 }
  );

  await tryEndpoint(
    "5b. property/getPropertyList",
    "POST",
    "/land-property/property/getPropertyList",
    { 단지기본일련번호: 2172, 물건종류: "41", 거래유형: "3" }
  );

  // 6. 비단지(빌라/다가구) 매물 API
  await tryEndpoint(
    "6a. propList/nonComplexList",
    "POST",
    "/land-property/propList/nonComplexList",
    { ...노원구, zoomLevel: 16, 물건종류: "03,05", 거래유형: "3" }
  );

  await tryEndpoint(
    "6b. propList/stutCdFilter/list",
    "POST",
    "/land-property/propList/stutCdFilter/list",
    { ...노원구, zoomLevel: 16, 물건종류: "03,05", 거래유형: "3", page: 1, pageSize: 20 }
  );

  // 7. 법정동코드로 지역 매물 조회
  await tryEndpoint(
    "7. allAreaNameList (노원구 법정동 목록)",
    "GET",
    `/land-complex/map/allAreaNameList?selectCode=1,2,3&zoomLevel=14&startLat=${노원구.startLat}&startLng=${노원구.startLng}&endLat=${노원구.endLat}&endLng=${노원구.endLng}&${encodeURIComponent("물건종류")}=03,05&${encodeURIComponent("거래유형")}=3`
  );

  console.log("\n=== 테스트 완료 ===");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
