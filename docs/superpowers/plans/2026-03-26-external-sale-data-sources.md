# 외부 매매 데이터 소스 확장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국토교통부 공공 API(data.go.kr)로 실거래가 수집기를 만들어 호갱노노/아실/밸류맵이 제공하는 매매 데이터를 직접 수집하고, 기존 normalized_listings DB에 통합

**Architecture:** Node.js ESM 수집기 → data.go.kr REST API(XML) 호출 → raw JSONL 저장 → `BaseListingAdapter` 기반 어댑터로 normalized_listings 적재. 수집기는 raw 데이터만 저장하고, 어댑터가 정규화하는 기존 2단계 패턴을 따름. orchestrator에서는 opt-in 방식 (`--platforms=molit` 명시 필요, kbland과 동일 패턴) — 실거래가는 실시간 매물과 수집 주기가 다르므로 별도 실행이 적절.

**Tech Stack:** Node.js ESM (fetch), fast-xml-parser, data.go.kr OpenAPI, PostgreSQL, Vitest

**Depends on:** `2026-03-25-sale-listings.md` (sale_price 컬럼, lease_type='매매' 등 이미 구현됨)

---

## Scope

| # | 플랫폼 | 접근 방식 | 포함 여부 |
|---|--------|----------|----------|
| 1 | 네이버부동산 | 이미 수집 중 | **제외** |
| 2 | 호갱노노 | data.go.kr로 대체 | **포함** (간접) |
| 3 | 아실 | data.go.kr로 대체 | **포함** (간접) |
| 4 | 부동산플래닛 | API 미공개 | **제외** (파트너십 필요) |
| 5 | 리치고 | API 미공개 | **제외** (파트너십 필요) |
| 6 | 직방 | 매매 매물 적음 | **제외** |
| 7 | 에스맵 | 매매 데이터 없음 (건물 메타만) | **제외** |
| 8 | 밸류맵 | data.go.kr로 대체 | **포함** (간접) |

**핵심**: data.go.kr 실거래가 API 수집기 1개로 호갱노노+아실+밸류맵 3개 플랫폼 데이터 대체.

---

## File Map

| 파일 | 상태 | 역할 |
|------|------|------|
| `scripts/molit_transaction_collector.mjs` | 신규 | 국토교통부 실거래가 API 수집기 (raw JSONL 출력) |
| `scripts/lib/molit_api.mjs` | 신규 | data.go.kr API 호출 유틸 (fast-xml-parser, 재시도) |
| `scripts/lib/molit_codes.mjs` | 신규 | 법정동 코드 매핑 (서울 구별) |
| `scripts/adapters/molit_listings_adapter.mjs` | 신규 | `BaseListingAdapter` 확장, raw → normalized 변환 |
| `scripts/adapters/adapter_registry.mjs` | 수정 | molit 어댑터 등록 |
| `scripts/adapters/base_listing_adapter.mjs` | 수정 | `requiredPass`에 sale_price 대안 조건 추가 |
| `scripts/run_parallel_collect.mjs` | 수정 | molit 수집기 통합 |
| `scripts/platform_sampling_targets.json` | 수정 | molit 타겟 추가 |
| `tests/molit_api.test.mjs` | 신규 | API 유틸 단위 테스트 |
| `tests/molit_adapter.test.mjs` | 신규 | 어댑터 변환 단위 테스트 |
| `tests/molit_codes.test.mjs` | 신규 | 법정동 코드 테스트 |

**API에서 제공되지 않아 null로 남는 필드** (의도적):
`room_count`, `bathroom_count`, `total_floor`, `direction`, `agent_name`, `agent_phone`, `available_date`, `lat`, `lng`, `loan_amount`, `image_urls`

---

## 사전 준비: data.go.kr API 키 발급

1. data.go.kr 회원가입
2. 아래 3개 API 활용신청 (자동 승인):
   - **아파트매매**: `RTMSDataSvcAptTradeDev`
   - **연립다세대 매매**: `RTMSDataSvcRHTradeDev`
   - **단독/다가구 매매**: `RTMSDataSvcSHTradeDev`
3. `.env`에 추가: `MOLIT_API_KEY=발급받은_서비스키`

**일일 호출 한도**: 개발 1,000건/일, 운영 100,000건/일
**1회 수집 예상 호출수**: 25구 x 3개월 x 3타입 = 225건 (개발 계정으로 충분)

---

## Task 1: fast-xml-parser 설치 + 법정동 코드 매핑

**Files:**
- Create: `scripts/lib/molit_codes.mjs`
- Create: `tests/molit_codes.test.mjs`

- [ ] **Step 1: fast-xml-parser 설치**

```bash
npm install fast-xml-parser
```

- [ ] **Step 2: 실패하는 테스트 작성**

```js
// tests/molit_codes.test.mjs
import { describe, it, expect } from "vitest";
import { getLawdCd, getDistrictName, SEOUL_DISTRICTS } from "../scripts/lib/molit_codes.mjs";

describe("molit_codes", () => {
  it("노원구 코드 반환", () => {
    expect(getLawdCd("노원구")).toBe("11350");
  });

  it("전체 서울 구 목록 25개", () => {
    expect(Object.keys(SEOUL_DISTRICTS).length).toBe(25);
  });

  it("코드로 구 이름 역조회", () => {
    expect(getDistrictName("11350")).toBe("노원구");
  });

  it("없는 구 null 반환", () => {
    expect(getLawdCd("화성시")).toBe(null);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/molit_codes.test.mjs`
Expected: FAIL — "Cannot find module"

- [ ] **Step 4: 코드 매핑 구현**

```js
// scripts/lib/molit_codes.mjs

/** 서울시 구별 법정동코드 앞 5자리 */
export const SEOUL_DISTRICTS = {
  "종로구": "11110", "중구": "11140", "용산구": "11170",
  "성동구": "11200", "광진구": "11215", "동대문구": "11230",
  "중랑구": "11260", "성북구": "11290", "강북구": "11305",
  "도봉구": "11320", "노원구": "11350", "은평구": "11380",
  "서대문구": "11410", "마포구": "11440", "양천구": "11470",
  "강서구": "11500", "구로구": "11530", "금천구": "11545",
  "영등포구": "11560", "동작구": "11590", "관악구": "11620",
  "서초구": "11650", "강남구": "11680", "송파구": "11710",
  "강동구": "11740",
};

const codeToName = Object.fromEntries(
  Object.entries(SEOUL_DISTRICTS).map(([k, v]) => [v, k])
);

export function getLawdCd(districtName) {
  return SEOUL_DISTRICTS[districtName] ?? null;
}

export function getDistrictName(code) {
  return codeToName[code] ?? null;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/molit_codes.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/molit_codes.mjs tests/molit_codes.test.mjs package.json package-lock.json
git commit -m "feat: add molit district code mapping and fast-xml-parser dep"
```

---

## Task 2: API 호출 유틸 (fast-xml-parser 기반)

**Files:**
- Create: `scripts/lib/molit_api.mjs`
- Create: `tests/molit_api.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/molit_api.test.mjs
import { describe, it, expect } from "vitest";
import { buildApiUrl, parseXmlResponse, ENDPOINTS } from "../scripts/lib/molit_api.mjs";

describe("buildApiUrl", () => {
  it("아파트 매매 URL 생성", () => {
    const url = buildApiUrl("apt", { lawdCd: "11350", dealYmd: "202603" }, "TEST_KEY");
    expect(url).toContain("RTMSDataSvcAptTradeDev");
    expect(url).toContain("LAWD_CD=11350");
    expect(url).toContain("DEAL_YMD=202603");
    expect(url).toContain("serviceKey=TEST_KEY");
  });

  it("연립다세대 URL 생성", () => {
    const url = buildApiUrl("rh", { lawdCd: "11350", dealYmd: "202603" }, "TEST_KEY");
    expect(url).toContain("RTMSDataSvcRHTradeDev");
  });

  it("단독다가구 URL 생성", () => {
    const url = buildApiUrl("sh", { lawdCd: "11350", dealYmd: "202603" }, "TEST_KEY");
    expect(url).toContain("RTMSDataSvcSHTradeDev");
  });

  it("잘못된 타입 에러", () => {
    expect(() => buildApiUrl("invalid", {}, "KEY")).toThrow("Unknown type");
  });
});

describe("parseXmlResponse", () => {
  it("XML 응답에서 item 배열 추출", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>00</resultCode></header>
    <body><items>
      <item><거래금액> 32,000</거래금액><법정동>상계동</법정동><전용면적>59.99</전용면적><층>5</층><건축년도>1995</건축년도><년>2026</년><월>3</월><일>15</일><아파트>상계주공</아파트></item>
    </items><totalCount>1</totalCount></body></response>`;
    const items = parseXmlResponse(xml);
    expect(items).toHaveLength(1);
    expect(items[0]["거래금액"]).toBe("32,000");
    expect(items[0]["법정동"]).toBe("상계동");
  });

  it("CDATA 포함 필드 처리", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>00</resultCode></header>
    <body><items>
      <item><아파트><![CDATA[래미안 상계]]></아파트><거래금액>50,000</거래금액></item>
    </items><totalCount>1</totalCount></body></response>`;
    const items = parseXmlResponse(xml);
    expect(items[0]["아파트"]).toBe("래미안 상계");
  });

  it("빈 응답 빈 배열 반환", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>00</resultCode></header>
    <body><items></items><totalCount>0</totalCount></body></response>`;
    expect(parseXmlResponse(xml)).toEqual([]);
  });

  it("에러 응답 throw", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <response><header><resultCode>99</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header></response>`;
    expect(() => parseXmlResponse(xml)).toThrow("SERVICE_KEY");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/molit_api.test.mjs`
Expected: FAIL

- [ ] **Step 3: API 유틸 구현**

```js
// scripts/lib/molit_api.mjs
import { XMLParser } from "fast-xml-parser";

const BASE_URL = "http://openapi.molit.go.kr:8081/OpenAPI_ToolInstall498/service/rest/RTMSOBJSvc";

export const ENDPOINTS = {
  apt: "getRTMSDataSvcAptTradeDev",   // 아파트 매매
  rh: "getRTMSDataSvcRHTradeDev",     // 연립다세대 매매
  sh: "getRTMSDataSvcSHTradeDev",     // 단독/다가구 매매
};

export function buildApiUrl(type, { lawdCd, dealYmd }, serviceKey) {
  const endpoint = ENDPOINTS[type];
  if (!endpoint) throw new Error(`Unknown type: ${type}`);
  const params = new URLSearchParams({
    serviceKey,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo: "1",
    numOfRows: "9999",
  });
  return `${BASE_URL}/${endpoint}?${params.toString()}`;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  processEntities: true,
  cdataPropName: "__cdata",
  textNodeName: "__text",
});

export function parseXmlResponse(xml) {
  const parsed = xmlParser.parse(xml);
  const response = parsed?.response;
  if (!response) throw new Error("Invalid XML: no <response> root");

  const resultCode = String(response?.header?.resultCode ?? "");
  if (resultCode !== "00") {
    const msg = response?.header?.resultMsg || `API error code: ${resultCode}`;
    throw new Error(msg);
  }

  const items = response?.body?.items?.item;
  if (!items) return [];

  // fast-xml-parser는 item이 1개면 객체, 여러 개면 배열로 반환
  const arr = Array.isArray(items) ? items : [items];

  // CDATA/text 노드를 평탄화 → 순수 key-value 변환
  return arr.map((item) => {
    const flat = {};
    for (const [key, val] of Object.entries(item)) {
      if (val && typeof val === "object" && ("__cdata" in val || "__text" in val)) {
        flat[key] = String(val.__cdata ?? val.__text ?? "").trim();
      } else {
        flat[key] = typeof val === "string" ? val.trim() : val;
      }
    }
    return flat;
  });
}

/**
 * API 호출 + 재시도 (최대 3회, 지수 백오프)
 */
export async function fetchMolitData(type, params, serviceKey) {
  const url = buildApiUrl(type, params, serviceKey);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return parseXmlResponse(xml);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/molit_api.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/molit_api.mjs tests/molit_api.test.mjs
git commit -m "feat: molit data.go.kr API client with fast-xml-parser and retry"
```

---

## Task 3: base_listing_adapter requiredPass 수정

**Files:**
- Modify: `scripts/adapters/base_listing_adapter.mjs:138-144`

매매 매물은 `rent_amount`/`deposit_amount`가 null이므로 `sale_price`를 대안 조건으로 추가해야 함. 이 수정은 molit뿐 아니라 네이버/KB 매매 매물 모두에 적용됨.

- [ ] **Step 1: requiredPass 수정**

기존 (line 138-144):
```js
function requiredPass(item) {
  return (
    isNonEmptyString(item.address_text) &&
    (toFloat(item.rent_amount) !== null || toFloat(item.deposit_amount) !== null) &&
    (toFloat(item.area_exclusive_m2) !== null || toFloat(item.area_gross_m2) !== null)
  );
}
```

변경:
```js
function requiredPass(item) {
  const hasPrice =
    toFloat(item.rent_amount) !== null ||
    toFloat(item.deposit_amount) !== null ||
    toFloat(item.sale_price) !== null;
  return (
    isNonEmptyString(item.address_text) &&
    hasPrice &&
    (toFloat(item.area_exclusive_m2) !== null || toFloat(item.area_gross_m2) !== null)
  );
}
```

- [ ] **Step 2: validateNormalized의 PRICE_PARSE_FAIL 경고도 동일하게 수정**

기존 (line 380-386):
```js
if (item.rent_amount == null && item.deposit_amount == null) {
```

변경:
```js
if (item.rent_amount == null && item.deposit_amount == null && item.sale_price == null) {
```

- [ ] **Step 3: priceRate 통계도 수정**

기존 (line 319-323):
```js
normalizedItems.filter(
  (i) => i.rent_amount != null || i.deposit_amount != null,
).length / normalizedItems.length,
```

변경:
```js
normalizedItems.filter(
  (i) => i.rent_amount != null || i.deposit_amount != null || i.sale_price != null,
).length / normalizedItems.length,
```

- [ ] **Step 4: has_price 통계도 수정**

기존 (line 290):
```js
has_price: normalized.rent_amount != null || normalized.deposit_amount != null,
```

변경:
```js
has_price: normalized.rent_amount != null || normalized.deposit_amount != null || normalized.sale_price != null,
```

- [ ] **Step 5: 기존 어댑터 테스트가 깨지지 않는지 확인**

Run: `npx vitest run`
Expected: 기존 테스트 전부 PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/adapters/base_listing_adapter.mjs
git commit -m "fix: requiredPass accepts sale_price as valid price for sale listings"
```

---

## Task 4: molit 어댑터 (BaseListingAdapter 확장)

**Files:**
- Create: `scripts/adapters/molit_listings_adapter.mjs`
- Create: `tests/molit_adapter.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/molit_adapter.test.mjs
import { describe, it, expect } from "vitest";
import { MolitListingAdapter } from "../scripts/adapters/molit_listings_adapter.mjs";

describe("MolitListingAdapter", () => {
  const adapter = new MolitListingAdapter();

  const aptRaw = {
    collected_at: "2026-03-26T00:00:00Z",
    payload_json: {
      _molit_type: "apt",
      "거래금액": " 32,000",
      "건축년도": "1995",
      "년": "2026", "월": "3", "일": "15",
      "법정동": "상계동",
      "아파트": "상계주공5단지",
      "전용면적": "59.99",
      "층": "5",
      "지번": "713",
      "지역코드": "11350",
    },
  };

  it("아파트 매매 항목 변환", () => {
    const results = adapter.normalizeFromRawRecord(aptRaw);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.lease_type).toBe("매매");
    expect(r.sale_price).toBe(32000);
    expect(r.area_exclusive_m2).toBeCloseTo(59.99);
    expect(r.floor).toBe(5);
    expect(r.building_year).toBe(1995);
    expect(r.building_name).toBe("상계주공5단지");
    expect(r.address_text).toContain("상계동");
    expect(r.area_claimed).toBe("exclusive");
    expect(r.rent_amount).toBe(null);
    expect(r.deposit_amount).toBe(null);
  });

  it("external_id 유니크 생성", () => {
    const r1 = adapter.normalizeFromRawRecord(aptRaw);
    const r2 = adapter.normalizeFromRawRecord({
      ...aptRaw,
      payload_json: { ...aptRaw.payload_json, "층": "10" },
    });
    expect(r1[0].external_id).not.toBe(r2[0].external_id);
  });

  it("거래금액 콤마/공백 제거", () => {
    const raw = {
      collected_at: "2026-03-26T00:00:00Z",
      payload_json: { ...aptRaw.payload_json, "거래금액": "  150,000  " },
    };
    const results = adapter.normalizeFromRawRecord(raw);
    expect(results[0].sale_price).toBe(150000);
  });

  const rhRaw = {
    collected_at: "2026-03-26T00:00:00Z",
    payload_json: {
      _molit_type: "rh",
      "거래금액": " 18,500",
      "건축년도": "2003",
      "년": "2026", "월": "2", "일": "20",
      "법정동": "면목동",
      "연립다세대": "현대빌라",
      "전용면적": "45.12",
      "층": "3",
      "지번": "123",
      "지역코드": "11260",
    },
  };

  it("연립다세대 항목 변환", () => {
    const results = adapter.normalizeFromRawRecord(rhRaw);
    expect(results[0].sale_price).toBe(18500);
    expect(results[0].building_name).toBe("현대빌라");
    expect(results[0].building_use).toBe("연립다세대");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/molit_adapter.test.mjs`
Expected: FAIL

- [ ] **Step 3: 어댑터 구현**

```js
// scripts/adapters/molit_listings_adapter.mjs
import crypto from "node:crypto";
import { BaseListingAdapter } from "./base_listing_adapter.mjs";
import { getDistrictName } from "../lib/molit_codes.mjs";

const TYPE_LABELS = { apt: "아파트", rh: "연립다세대", sh: "단독다가구" };
const NAME_KEYS = { apt: "아파트", rh: "연립다세대", sh: "단독다가구" };

function parseSalePrice(raw) {
  if (!raw) return null;
  const num = parseInt(String(raw).replace(/[,\s]/g, ""), 10);
  return Number.isFinite(num) ? num : null;
}

function makeExternalId(item, type) {
  const parts = [
    type, item["지역코드"], item["법정동"], item["지번"],
    item[NAME_KEYS[type]] || "",
    item["층"], item["년"], item["월"], item["일"],
    String(item["거래금액"] || "").replace(/\s/g, ""),
    item["전용면적"],
  ].join("|");
  return crypto.createHash("md5").update(parts).digest("hex").slice(0, 16);
}

export class MolitListingAdapter extends BaseListingAdapter {
  constructor(options = {}) {
    super({
      platformCode: "molit",
      platformName: "국토교통부",
      collectionMode: "DIRECT_API",
      options,
    });
    this.notes = ["국토교통부 실거래가 data.go.kr API"];
  }

  normalizeFromRawRecord(rawRecord) {
    const payload = rawRecord?.payload_json || rawRecord;
    const type = payload?._molit_type || "apt";
    const collectedAt = rawRecord?.collected_at || new Date().toISOString();

    const salePrice = parseSalePrice(payload["거래금액"]);
    const area = parseFloat(payload["전용면적"]);
    const floor = parseInt(payload["층"], 10);
    const buildingYear = parseInt(payload["건축년도"], 10);
    const dong = payload["법정동"] || "";
    const jibun = payload["지번"] || "";
    const districtCode = payload["지역코드"] || "";
    const districtName = getDistrictName(districtCode) || "";
    const buildingName = payload[NAME_KEYS[type]] || payload["아파트"] || payload["연립다세대"] || payload["단독다가구"] || null;
    const dealDate = `${payload["년"]}-${String(payload["월"]).padStart(2, "0")}-${String(payload["일"]).padStart(2, "0")}`;

    return [{
      platform_code: "molit",
      external_id: makeExternalId(payload, type),
      lease_type: "매매",
      sale_price: salePrice,
      rent_amount: null,
      deposit_amount: null,
      area_exclusive_m2: Number.isFinite(area) ? area : null,
      area_gross_m2: null,
      area_claimed: "exclusive",
      floor: Number.isFinite(floor) ? floor : null,
      building_year: Number.isFinite(buildingYear) ? buildingYear : null,
      building_name: buildingName,
      building_use: TYPE_LABELS[type] || null,
      address_text: `서울시 ${districtName} ${dong} ${jibun}`.trim(),
      address_code: districtCode,
      listed_at: dealDate,
      collected_at: collectedAt,
      title: `${buildingName || dong} ${salePrice ? salePrice + "만" : ""}`.trim(),
      source_url: null,
      source_ref: JSON.stringify({ type, dealYmd: `${payload["년"]}${String(payload["월"]).padStart(2, "0")}` }),
      // 국토교통부 API에서 제공하지 않는 필드 (의도적 null)
      room_count: null,
      bathroom_count: null,
      total_floor: null,
      direction: null,
      agent_name: null,
      agent_phone: null,
      available_date: null,
      lat: null,
      lng: null,
      loan_amount: null,
      image_urls: [],
    }];
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/molit_adapter.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/adapters/molit_listings_adapter.mjs tests/molit_adapter.test.mjs
git commit -m "feat: molit listing adapter extending BaseListingAdapter"
```

---

## Task 5: adapter_registry에 molit 등록

**Files:**
- Modify: `scripts/adapters/adapter_registry.mjs`

- [ ] **Step 1: import 추가**

파일 상단 import 블록에 추가:
```js
import { MolitListingAdapter } from "./molit_listings_adapter.mjs";
```

- [ ] **Step 2: ADAPTER_REGISTRY에 molit 항목 추가**

`kbland` 항목 다음에 추가:
```js
  molit: {
    platformCode: "molit",
    platformName: "국토교통부",
    collectionMode: "DIRECT_API",
    adapterFactory: () => new MolitListingAdapter(),
    readiness: "READY",
    notes: "국토교통부 실거래가 data.go.kr API — 아파트/연립다세대/단독다가구 매매",
  },
```

- [ ] **Step 3: ADAPTER_ALIAS에 별칭 추가**

```js
  국토교통부: "molit",
  "data.go.kr": "molit",
```

- [ ] **Step 4: 어댑터 목록 확인**

```bash
node -e "import('./scripts/adapters/adapter_registry.mjs').then(m => console.log(m.listAdapters().map(a => a.platform_code)))"
```

Expected: `[ 'naver', 'zigbang', 'dabang', 'r114', 'daangn', 'peterpanz', 'kbland', 'molit' ]`

- [ ] **Step 5: Commit**

```bash
git add scripts/adapters/adapter_registry.mjs
git commit -m "feat: register molit adapter in adapter registry"
```

---

## Task 6: 메인 수집기 (raw JSONL 출력)

**Files:**
- Create: `scripts/molit_transaction_collector.mjs`

수집기는 raw 데이터만 JSONL로 저장. 정규화는 어댑터가 담당 (기존 2단계 패턴).

- [ ] **Step 1: 수집기 구현**

```js
#!/usr/bin/env node

/**
 * 국토교통부 실거래가 수집기
 *
 * 사용법:
 *   node scripts/molit_transaction_collector.mjs \
 *     --types=apt,rh,sh \
 *     --months=202601,202602,202603 \
 *     --districts=노원구,중랑구 \
 *     --output-raw=data/molit/molit_raw.jsonl \
 *     --output-meta=data/molit/molit_meta.json
 *
 * 환경변수: MOLIT_API_KEY (data.go.kr 서비스키)
 */

import fs from "node:fs";
import path from "node:path";
import { fetchMolitData, ENDPOINTS } from "./lib/molit_api.mjs";
import { getLawdCd, SEOUL_DISTRICTS } from "./lib/molit_codes.mjs";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const found = args.find((a) => a.startsWith(`${name}=`));
  if (found) return found.split("=").slice(1).join("=");
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const API_KEY = process.env.MOLIT_API_KEY;
if (!API_KEY) {
  console.error("ERROR: MOLIT_API_KEY 환경변수 필요 (data.go.kr 서비스키)");
  process.exit(1);
}

const types = (getArg("--types", "apt,rh,sh")).split(",");
const monthsArg = getArg("--months", null);
const districtsArg = getArg("--districts", null);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outputRaw = getArg("--output-raw", `data/molit/molit_raw_${timestamp}.jsonl`);
const outputMeta = getArg("--output-meta", `data/molit/molit_meta_${timestamp}.json`);

function recentMonths(count = 3) {
  const result = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

const months = monthsArg ? monthsArg.split(",") : recentMonths(3);
const districts = districtsArg ? districtsArg.split(",") : Object.keys(SEOUL_DISTRICTS);

async function run() {
  fs.mkdirSync(path.dirname(path.resolve(outputRaw)), { recursive: true });
  const stream = fs.createWriteStream(outputRaw, { flags: "a" });
  const collectedAt = new Date().toISOString();

  let totalItems = 0;
  let totalErrors = 0;

  for (const district of districts) {
    const lawdCd = getLawdCd(district);
    if (!lawdCd) { console.warn(`SKIP: ${district} — 코드 없음`); continue; }

    for (const month of months) {
      for (const type of types) {
        try {
          const items = await fetchMolitData(type, { lawdCd, dealYmd: month }, API_KEY);
          for (const item of items) {
            // raw 저장: payload_json + 메타 (어댑터가 읽을 수 있는 형태)
            const record = {
              collected_at: collectedAt,
              platform_code: "molit",
              payload_json: { ...item, _molit_type: type },
            };
            stream.write(JSON.stringify(record) + "\n");
            totalItems++;
          }
          console.log(`  ${district} ${month} ${type}: ${items.length}건`);
          // rate limit: 200ms 대기
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          console.error(`  ERROR ${district} ${month} ${type}: ${e.message}`);
          totalErrors++;
        }
      }
    }
  }

  stream.end();

  const meta = {
    collector: "molit_transaction",
    timestamp: collectedAt,
    types, months,
    districts: districts.length,
    totalItems, totalErrors,
    outputRaw, outputMeta,
    quality: totalErrors === 0 ? "GOOD" : totalErrors < 5 ? "PARTIAL" : "DEGRADED",
  };
  fs.mkdirSync(path.dirname(path.resolve(outputMeta)), { recursive: true });
  fs.writeFileSync(outputMeta, JSON.stringify(meta, null, 2));

  console.log(`\nDONE: ${totalItems}건 수집, ${totalErrors}건 에러 → ${outputRaw}`);
  return meta;
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });
```

- [ ] **Step 2: dry-run 테스트 (구조 확인)**

```bash
MOLIT_API_KEY=test node scripts/molit_transaction_collector.mjs --types=apt --districts=노원구 --months=202603 2>&1 | head -5
```

Expected: HTTP/SERVICE_KEY 에러 (구조 정상 확인)

- [ ] **Step 3: 실제 API 키로 수집 테스트**

```bash
node scripts/molit_transaction_collector.mjs --types=apt --districts=노원구 --months=202603
```

Expected: `노원구 202603 apt: N건` 출력 + JSONL 파일 생성

- [ ] **Step 4: 어댑터로 정규화 테스트**

```bash
node scripts/run_listing_adapters.mjs --platform=molit --input=data/molit/molit_raw_*.jsonl
```

Expected: 정규화 성공, `requiredFieldsRate` > 0.8

- [ ] **Step 5: Commit**

```bash
git add scripts/molit_transaction_collector.mjs
git commit -m "feat: molit real transaction collector (raw JSONL output)"
```

---

## Task 7: orchestrator 통합

**Files:**
- Modify: `scripts/run_parallel_collect.mjs`
- Modify: `scripts/platform_sampling_targets.json`

- [ ] **Step 1: platform_sampling_targets.json에 molit 타겟 추가**

`targets` 배열 끝에 추가:
```json
{
  "platform": "국토교통부",
  "platform_code": "molit",
  "mode": "DIRECT_API",
  "source_type": "public_api",
  "notes": "data.go.kr 실거래가 공공 API — 아파트/연립다세대/단독다가구 매매",
  "leaseType": "매매",
  "query_hint": {
    "types": ["apt", "rh", "sh"],
    "months": "recent_3",
    "districts": ["노원구", "중랑구", "동대문구", "광진구", "성북구", "성동구", "중구", "종로구"]
  }
}
```

- [ ] **Step 2: run_parallel_collect.mjs — scriptPaths 추가**

`kblandCollect` 다음에 추가:
```js
molitCollect: path.resolve(process.cwd(), "scripts/molit_transaction_collector.mjs"),
```

- [ ] **Step 3: run_parallel_collect.mjs — platformAlias 추가**

```js
molit: "molit",
국토교통부: "molit",
"data.go.kr": "molit",
```

- [ ] **Step 4: run_parallel_collect.mjs — molit dispatch 블록 추가**

kbland dispatch 블록 (`if (normalizedCode === "kbland") { ... }`) 뒤에 추가:

```js
    // molit은 기본 목록에 없음 — --platforms=molit로 명시적 지정 시 실행 (실거래가는 별도 주기로 수집)
    if (normalizedCode === "molit") {
      const molitTargets = targets.filter((t) => normalizePlatform(t.platform_code || t.platform) === "molit");
      const molitHint = molitTargets[0]?.query_hint || {};
      const molitTypes = (molitHint.types || ["apt", "rh", "sh"]).join(",");
      const molitDistricts = unique([
        ...(molitHint.districts || []),
        ...selectedSigunguList,
        ...(overrideSigungu ? [overrideSigungu] : []),
      ]);

      jobs.push({
        name: "molit",
        run: async () => {
          const rawFile = path.join(workspace, `molit_raw_${runId}.jsonl`);
          const metaFile = path.join(workspace, `molit_meta_${runId}.json`);
          const molitArgs = [
            "--types", molitTypes,
            "--districts", molitDistricts.join(","),
            "--output-raw", rawFile,
            "--output-meta", metaFile,
          ];

          const collectResult = await runNode("molit_collect", scriptPaths.molitCollect, molitArgs, {
            stream: true,
          });

          let normalizedPath = null;
          let normalizeResult = null;
          if (runNormalize) {
            normalizedPath = path.join(workspace, `molit_normalized_${runId}.json`);
            normalizeResult = await runNode(
              "molit_adapter",
              scriptPaths.listingAdapters,
              ["--platform", "molit", "--input", rawFile, "--out", normalizedPath],
              { stream: false },
            );
          }

          return {
            platform: "molit",
            rawFile, metaFile, normalizedPath,
            collectResult, normalizeResult,
            success: true,
          };
        },
      });
      continue;
    }
```

- [ ] **Step 5: 통합 테스트**

```bash
node scripts/run_parallel_collect.mjs --platforms=molit --lease-type=매매 --skip-probe
```

Expected: molit 수집 → 어댑터 정규화 → 완료

- [ ] **Step 6: Commit**

```bash
git add scripts/run_parallel_collect.mjs scripts/platform_sampling_targets.json
git commit -m "feat: integrate molit collector into parallel orchestrator"
```

---

## Task 8: E2E 검증

- [ ] **Step 1: 전체 파이프라인 실행**

```bash
node scripts/molit_transaction_collector.mjs --types=apt,rh,sh --districts=노원구,중랑구 --months=202603
node scripts/run_listing_adapters.mjs --platform=molit --input=data/molit/molit_raw_*.jsonl --persist-to-db
```

- [ ] **Step 2: DB에서 molit 데이터 확인**

```bash
psql $DATABASE_URL -c "SELECT building_use, COUNT(*), AVG(sale_price) AS avg_price FROM normalized_listings WHERE platform_code='molit' GROUP BY building_use;"
```

Expected: 아파트/연립다세대/단독다가구 별 건수 + 평균 매매가

- [ ] **Step 3: API에서 매매 데이터 조회**

```bash
curl "http://localhost:3000/api/listings?lease_type=매매&limit=5" | jq '.listings[] | {platform_code, building_name, sale_price, building_use}'
```

Expected: molit + naver + kbland 등 복수 플랫폼 매매 매물

- [ ] **Step 4: 전체 매매 플랫폼 분포 확인**

```bash
psql $DATABASE_URL -c "SELECT platform_code, COUNT(*) FROM normalized_listings WHERE lease_type='매매' GROUP BY platform_code ORDER BY count DESC;"
```

Expected: molit이 가장 많은 건수 (실거래가 = 모든 거래 기록)
