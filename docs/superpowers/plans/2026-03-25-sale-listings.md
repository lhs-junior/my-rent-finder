# 매매 매물 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 월세 수집 도구에 매매 매물 수집 + 구매 가능 여부 자동 판단 기능 추가

**Architecture:** lease_type='매매'로 기존 normalized_listings 테이블 확장, 서버사이드 구매 가능 여부 계산 API(PIN 보호 설정 + 공개 계산 엔드포인트), 프론트엔드 매매 탭 + 배지 컴포넌트.

**Tech Stack:** Node.js ESM, PostgreSQL, React(Vite), Vitest, Vercel Serverless

**Spec:** `docs/superpowers/specs/2026-03-25-sale-listings-design.md`

---

## File Map

| 파일 | 상태 | 역할 |
|------|------|------|
| `db/migrations/008_add_sale_columns.sql` | 신규 | lease_type CHECK 확장 + sale 컬럼 + user_settings 테이블 |
| `scripts/lib/api_routes/settings.mjs` | 신규 | PIN 보호 설정 읽기/쓰기 API |
| `scripts/lib/api_routes/affordability.mjs` | 신규 | 구매 가능 여부 계산 API (공개) |
| `api/handler.mjs` | 수정 | 새 라우트 2개 import + 분기 추가 |
| `scripts/lib/api_routes/listings.mjs` | 수정 | `leaseType` 쿼리 파라미터 필터 추가 |
| `scripts/adapters/naver_listings_adapter.mjs` | 수정 | sale_price / loan_amount / building_year 추출 |
| `scripts/adapters/kbland_listings_adapter.mjs` | 수정 | 동일 |
| `scripts/adapters/zigbang_listings_adapter.mjs` | 수정 | 동일 |
| `scripts/adapters/dabang_listings_adapter.mjs` | 수정 | 동일 |
| `scripts/naver_auto_collector.mjs` | 수정 | leaseType='매매' 분기 처리 |
| `scripts/kbland_auto_collector.mjs` | 수정 | 동일 |
| `scripts/platform_sampling_targets.json` | 수정 | 매매 타겟 추가 |
| `frontend/src/components/AffordabilityBadge.jsx` | 신규 | ✅가능 / ⚠️X만원 부족 배지 |
| `frontend/src/components/SettingsModal.jsx` | 신규 | PIN 인증 + 재정 설정 폼 |
| `frontend/src/App.jsx` | 수정 | 매매 탭 추가 |
| `tests/affordability.test.mjs` | 신규 | 계산 로직 단위 테스트 |
| `tests/settings_api.test.mjs` | 신규 | PIN 검증 단위 테스트 |

---

## Task 1: DB Migration

**Files:**
- Create: `db/migrations/008_add_sale_columns.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- db/migrations/008_add_sale_columns.sql

-- 1. lease_type CHECK 확장: '매매' 추가
ALTER TABLE normalized_listings
  DROP CONSTRAINT IF EXISTS normalized_listings_lease_type_check;
ALTER TABLE normalized_listings
  ADD CONSTRAINT normalized_listings_lease_type_check
    CHECK (lease_type IN ('월세', '전세', '단기', '기타', '매매'));

-- 2. 매매 전용 컬럼
ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS sale_price INTEGER,
  ADD COLUMN IF NOT EXISTS loan_amount INTEGER,
  ADD COLUMN IF NOT EXISTS building_year INTEGER;

CREATE INDEX IF NOT EXISTS idx_listings_sale
  ON normalized_listings(lease_type, sale_price)
  WHERE lease_type = '매매';

-- 3. 설정 저장 테이블
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
psql $DATABASE_URL -f db/migrations/008_add_sale_columns.sql
```

Expected: 오류 없이 완료

- [ ] **Step 3: 검증**

```bash
psql $DATABASE_URL -c "\d normalized_listings" | grep -E "sale_price|loan_amount|building_year"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM user_settings;"
```

Expected: 컬럼 3개 표시, user_settings 테이블 COUNT 0

- [ ] **Step 4: Commit**

```bash
git add db/migrations/008_add_sale_columns.sql
git commit -m "feat: add sale listing columns and user_settings table (migration 008)"
```

---

## Task 2: Affordability 계산 로직 + 테스트

**Files:**
- Create: `scripts/lib/affordability.mjs`
- Create: `tests/affordability.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/affordability.test.mjs
import { describe, it, expect } from "vitest";
import { calcAffordability } from "../scripts/lib/affordability.mjs";

describe("calcAffordability", () => {
  const settings = {
    my_capital: 10000,   // 1억 (만원)
    my_income: 7000,     // 7천만원 (만원)
    ltv_ratio: 0.70,
    dti_limit: 0.60,
    loan_rate: 0.035,
    loan_years: 30,
  };

  it("가능: 3.3억 이하 매물", () => {
    const result = calcAffordability(33000, settings);
    expect(result.feasible).toBe(true);
    expect(result.shortage).toBe(0);
    expect(result.requiredCapital).toBe(9900);
    expect(result.loanAmount).toBe(23100);
    expect(result.monthlyPayment).toBeGreaterThan(0);
    expect(result.dti).toBeLessThanOrEqual(0.60);
  });

  it("불가: 5억 매물, 자본 1억 (4천만원 부족)", () => {
    const result = calcAffordability(50000, settings);
    expect(result.feasible).toBe(false);
    expect(result.shortage).toBe(5000); // 1.5억 - 1억 = 5000만원
    expect(result.requiredCapital).toBe(15000);
  });

  it("DTI 초과 시 불가", () => {
    const lowIncome = { ...settings, my_income: 500 }; // 500만원 연소득
    const result = calcAffordability(33000, lowIncome);
    expect(result.feasible).toBe(false);
  });

  it("매매가 0 이하면 에러", () => {
    expect(() => calcAffordability(0, settings)).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run tests/affordability.test.mjs
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: 계산 로직 구현**

```js
// scripts/lib/affordability.mjs

/**
 * 월 원리금 균등상환 계수 계산 (PMT)
 * @param {number} rate - 연 금리 (예: 0.035)
 * @param {number} years - 대출 기간 (년)
 */
function monthlyPaymentFactor(rate, years) {
  const r = rate / 12;
  const n = years * 12;
  if (r === 0) return 1 / n;
  return (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/**
 * 구매 가능 여부 계산
 * @param {number} salePrice - 매매가 (만원)
 * @param {Object} settings - user_settings 값
 */
export function calcAffordability(salePrice, settings) {
  if (!salePrice || salePrice <= 0) throw new Error("salePrice must be positive");

  const {
    my_capital,
    my_income,
    ltv_ratio = 0.70,
    dti_limit = 0.60,
    loan_rate = 0.035,
    loan_years = 30,
  } = settings;

  const requiredCapital = Math.round(salePrice * (1 - ltv_ratio));
  const loanAmount = salePrice - requiredCapital;
  const factor = monthlyPaymentFactor(loan_rate, loan_years);
  const monthlyPayment = Math.round(loanAmount * factor);
  const annualPayment = monthlyPayment * 12;
  const dti = annualPayment / my_income;
  const capitalOk = my_capital >= requiredCapital;
  const dtiOk = dti <= dti_limit;

  return {
    feasible: capitalOk && dtiOk,
    shortage: capitalOk ? 0 : requiredCapital - my_capital,
    requiredCapital,
    loanAmount,
    monthlyPayment,
    dti: Math.round(dti * 100) / 100,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run tests/affordability.test.mjs
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/affordability.mjs tests/affordability.test.mjs
git commit -m "feat: affordability calculation logic with tests"
```

---

## Task 3: Settings API

**Files:**
- Create: `scripts/lib/api_routes/settings.mjs`
- Create: `tests/settings_api.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/settings_api.test.mjs
import { describe, it, expect } from "vitest";
import { validatePin, parseSettingsBody } from "../scripts/lib/api_routes/settings.mjs";

describe("settings PIN validation", () => {
  it("올바른 PIN 통과", () => {
    expect(validatePin("1234", "1234")).toBe(true);
  });

  it("틀린 PIN 거부", () => {
    expect(validatePin("wrong", "1234")).toBe(false);
  });

  it("PIN 미입력 거부", () => {
    expect(validatePin(undefined, "1234")).toBe(false);
    expect(validatePin("", "1234")).toBe(false);
  });
});

describe("parseSettingsBody", () => {
  it("유효한 설정값 파싱", () => {
    const body = { pin: "1234", key: "my_capital", value: "10000" };
    const result = parseSettingsBody(body);
    expect(result.key).toBe("my_capital");
    expect(result.value).toBe("10000");
  });

  it("허용되지 않는 key 거부", () => {
    const body = { pin: "1234", key: "unknown_key", value: "10000" };
    expect(() => parseSettingsBody(body)).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run tests/settings_api.test.mjs
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Settings API 구현**

```js
// scripts/lib/api_routes/settings.mjs
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";

const ALLOWED_KEYS = new Set([
  "my_capital", "my_income", "loan_type", "ltv_ratio", "dti_limit",
]);

export function validatePin(inputPin, serverPin) {
  if (!inputPin || !serverPin) return false;
  return inputPin === serverPin;
}

export function parseSettingsBody(body) {
  const { key, value } = body || {};
  if (!ALLOWED_KEYS.has(key)) throw new Error(`Invalid key: ${key}`);
  if (value === undefined || value === null) throw new Error("value required");
  return { key, value: String(value) };
}

export async function handleSettings(req, res) {
  const serverPin = process.env.SETTINGS_PIN;
  if (!serverPin) {
    sendJson(res, 500, { error: "SETTINGS_PIN not configured" });
    return;
  }

  const body = req._parsedBody || {};

  // POST /api/settings/read — 설정 조회
  if (req.method === "POST" && req.url?.includes("/read")) {
    if (!validatePin(body.pin, serverPin)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    const rows = await withDbClient((client) =>
      client.query("SELECT key, value FROM user_settings ORDER BY key")
    );
    const settings = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
    sendJson(res, 200, { settings });
    return;
  }

  // POST /api/settings — 설정 저장
  if (req.method === "POST") {
    if (!validatePin(body.pin, serverPin)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    let parsed;
    try {
      parsed = parseSettingsBody(body);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
      return;
    }
    await withDbClient((client) =>
      client.query(
        `INSERT INTO user_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [parsed.key, parsed.value]
      )
    );
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run tests/settings_api.test.mjs
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/api_routes/settings.mjs tests/settings_api.test.mjs
git commit -m "feat: settings API with PIN validation"
```

---

## Task 4: Affordability API 엔드포인트

**Files:**
- Create: `scripts/lib/api_routes/affordability.mjs`

- [ ] **Step 1: Affordability API 구현**

```js
// scripts/lib/api_routes/affordability.mjs
import { withDbClient } from "../db_client.mjs";
import { sendJson } from "../api_helpers.mjs";
import { calcAffordability } from "../affordability.mjs";

const DEFAULTS = {
  my_capital: "10000",
  my_income: "7000",
  loan_type: "bogeumjari",
  ltv_ratio: "0.70",
  dti_limit: "0.60",
};

export async function handleAffordability(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const salePriceParam = url.searchParams.get("salePrice");
  const salePrice = salePriceParam ? parseInt(salePriceParam, 10) : null;

  if (!salePrice || isNaN(salePrice) || salePrice <= 0) {
    sendJson(res, { error: "salePrice query param required (만원 단위)" }, 400);
    return;
  }

  // DB에서 설정값 로드 (없으면 기본값 사용)
  const rows = await withDbClient((client) =>
    client.query("SELECT key, value FROM user_settings")
  );
  const stored = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
  const merged = { ...DEFAULTS, ...stored };

  const settings = {
    my_capital: parseFloat(merged.my_capital),
    my_income: parseFloat(merged.my_income),
    ltv_ratio: parseFloat(merged.ltv_ratio),
    dti_limit: parseFloat(merged.dti_limit),
    loan_rate: merged.loan_type === "bogeumjari" ? 0.035 : 0.045,
    loan_years: 30,
  };

  try {
    const result = calcAffordability(salePrice, settings);
    sendJson(res, result);
  } catch (e) {
    sendJson(res, { error: e.message }, 400);
  }
}
```

- [ ] **Step 2: curl로 동작 확인 (로컬 서버 실행 후)**

```bash
curl "http://localhost:3000/api/affordability?salePrice=48000"
```

Expected: `{"feasible":false,"shortage":4400,...}`

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/api_routes/affordability.mjs
git commit -m "feat: affordability API endpoint"
```

---

## Task 5: handler.mjs 라우팅 + listings 필터

**Files:**
- Modify: `api/handler.mjs`
- Modify: `scripts/lib/api_routes/listings.mjs`

- [ ] **Step 1: handler.mjs에 새 라우트 추가**

`api/handler.mjs` **line 16 아래** (기존 import 블록 끝)에 추가:
```js
import { handleSettings } from "../scripts/lib/api_routes/settings.mjs";
import { handleAffordability } from "../scripts/lib/api_routes/affordability.mjs";
```

**line 111 아래** (`/api/matches` 분기 직후, `send404(res)` 호출 직전)에 추가:
```js
if (pathname === "/api/settings" || pathname === "/api/settings/read") {
  await parseJsonBody(req);
  await handleSettings(req, res);
  return;
}
if (pathname === "/api/affordability") {
  await handleAffordability(req, res);
  return;
}
```

- [ ] **Step 2: listings.mjs에 leaseType 필터 추가**

`handleListings` 함수의 WHERE 절 생성 부분에 추가:

```js
// 기존 파라미터 파싱 아래에 추가
const leaseType = url.searchParams.get("lease_type"); // '월세' | '매매' | null(전체)

// WHERE 절에 추가
if (leaseType) {
  conditions.push(`nl.lease_type = $${params.length + 1}`);
  params.push(leaseType);
}
```

SELECT에 sale_price 추가:
```js
// 기존 SELECT 컬럼 목록에 추가
nl.sale_price,
nl.loan_amount,
nl.building_year,
```

- [ ] **Step 3: 전체 테스트 통과 확인**

```bash
npx vitest run
```

Expected: 기존 테스트 모두 PASS

- [ ] **Step 4: Commit**

```bash
git add api/handler.mjs scripts/lib/api_routes/listings.mjs
git commit -m "feat: wire settings/affordability routes, add leaseType filter to listings API"
```

---

## Task 6: 어댑터 매매 필드 추가

> ⚠️ 각 플랫폼 원본 키명은 실제 수집 데이터로 확인 후 수정 필요. 아래는 추정값.

**Files:**
- Modify: `scripts/adapters/naver_listings_adapter.mjs`
- Modify: `scripts/adapters/kbland_listings_adapter.mjs`
- Modify: `scripts/adapters/zigbang_listings_adapter.mjs`
- Modify: `scripts/adapters/dabang_listings_adapter.mjs`

- [ ] **Step 1: 각 어댑터의 `normalize` 메서드에 매매 필드 추출 추가**

패턴 (각 어댑터에 동일하게 적용):
```js
// normalize() 반환 객체에 추가
sale_price: raw.dealPrice ?? raw.salePrice ?? raw.price ?? null,
loan_amount: raw.loanPrice ?? raw.loanAmount ?? raw.loan ?? null,
building_year: raw.buildYear
  ? parseInt(String(raw.buildYear).slice(0, 4), 10)
  : null,
```

naver: `dealPrice`, `loanPrice`, `buildYear`
KB: `salePrice`, `loanAmount`, `useApproveYmd`
zigbang: `price`, `loan`, `builtIn`
dabang: 수집 테스트 후 확인

- [ ] **Step 2: 기존 어댑터 테스트 통과 확인**

```bash
npx vitest run tests/kbland_adapter.test.mjs tests/daangn_adapter.test.mjs
```

Expected: PASS (기존 테스트 영향 없음)

- [ ] **Step 3: Commit**

```bash
git add scripts/adapters/
git commit -m "feat: add sale_price/loan_amount/building_year to listing adapters"
```

---

## Task 7: 수집 스크립트 매매 분기

**Files:**
- Modify: `scripts/naver_auto_collector.mjs`
- Modify: `scripts/kbland_auto_collector.mjs`
- Modify: `scripts/platform_sampling_targets.json`

- [ ] **Step 1: platform_sampling_targets.json에 매매 타겟 추가**

기존 targets 배열에 추가:
```json
{
  "query_hint": {
    "leaseType": "매매",
    "propertyTypes": ["아파트", "빌라/연립", "단독/다가구"],
    "salePriceMax": 70000,
    "minAreaM2": 40,
    "sigunguList": ["노원구", "중랑구", "동대문구", "성북구"]
  }
}
```

- [ ] **Step 2: naver_auto_collector.mjs 매매 분기 추가**

`tradeType` 파라미터를 `leaseType` 기반으로 분기:
```js
// 기존: tradeType: "B2" (하드코딩)
// 변경: leaseType 파라미터 참조
const tradeType = queryHint.leaseType === "매매" ? "A1" : "B2";
```

- [ ] **Step 3: kbland_auto_collector.mjs 매매 분기 추가**

```js
// dealType: "3" (월세) → leaseType 기반 분기
const dealType = queryHint.leaseType === "매매" ? "1" : "3";
```

- [ ] **Step 4: 수집 테스트 (1개 구, naver만)**

```bash
node scripts/run_parallel_collect.mjs \
  --lease-type=매매 \
  --platforms=naver \
  --sigungu=노원구 \
  --sample-cap=20
```

Expected: `lease_type='매매'` 데이터 DB에 저장됨

```bash
psql $DATABASE_URL -c \
  "SELECT COUNT(*), MIN(sale_price), MAX(sale_price) FROM normalized_listings WHERE lease_type='매매';"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/naver_auto_collector.mjs scripts/kbland_auto_collector.mjs scripts/platform_sampling_targets.json
git commit -m "feat: add 매매 collection support for naver and kbland collectors"
```

---

## Task 8: Frontend — AffordabilityBadge 컴포넌트

**Files:**
- Create: `frontend/src/components/AffordabilityBadge.jsx`

- [ ] **Step 1: 컴포넌트 구현**

```jsx
// frontend/src/components/AffordabilityBadge.jsx
import { useState, useEffect } from "react";

export function AffordabilityBadge({ salePrice }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!salePrice) return;
    fetch(`/api/affordability?salePrice=${salePrice}`)
      .then((r) => r.json())
      .then(setResult)
      .catch(() => setResult(null));
  }, [salePrice]);

  if (!result) return null;

  if (result.feasible) {
    return (
      <span className="badge badge-feasible">
        ✅ 가능
      </span>
    );
  }

  const shortageText = result.shortage >= 10000
    ? `${(result.shortage / 10000).toFixed(1)}억`
    : `${result.shortage.toLocaleString()}만원`;

  return (
    <span className="badge badge-shortage">
      ⚠️ {shortageText} 부족
    </span>
  );
}
```

- [ ] **Step 2: 스타일 추가** (`frontend/src/styles.css`)

```css
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
.badge-feasible { background: #d1fae5; color: #065f46; }
.badge-shortage { background: #fef3c7; color: #92400e; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AffordabilityBadge.jsx frontend/src/styles.css
git commit -m "feat: AffordabilityBadge component"
```

---

## Task 9: Frontend — SettingsModal 컴포넌트

**Files:**
- Create: `frontend/src/components/SettingsModal.jsx`

- [ ] **Step 1: 컴포넌트 구현**

```jsx
// frontend/src/components/SettingsModal.jsx
import { useState } from "react";

const FIELD_LABELS = {
  my_capital: "자기자본 (만원)",
  my_income: "연소득 (만원)",
  ltv_ratio: "LTV 비율 (예: 0.70)",
  dti_limit: "DTI 한도 (예: 0.60)",
};

export function SettingsModal({ onClose }) {
  const [pin, setPin] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAuth() {
    const res = await fetch("/api/settings/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) { setError("PIN이 틀렸습니다"); return; }
    const data = await res.json();
    setSettings(data.settings || {});
    setAuthenticated(true);
    setError("");
  }

  async function handleSave(key, value) {
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, key, value }),
    });
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>설정</h3>
        {!authenticated ? (
          <div>
            <input
              type="password"
              placeholder="PIN 입력"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <button onClick={handleAuth}>확인</button>
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <div>
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <div key={key} className="setting-row">
                <label>{label}</label>
                <input
                  type="text"
                  defaultValue={settings[key] || ""}
                  onBlur={(e) => handleSave(key, e.target.value)}
                />
              </div>
            ))}
            {saving && <p>저장 중...</p>}
            <button onClick={onClose}>닫기</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 스타일 추가** (`frontend/src/styles.css` 하단에 append)

```css
/* SettingsModal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 400px; width: 90%; }
.modal-content h3 { margin-top: 0; }
.setting-row { margin-bottom: 1rem; }
.setting-row label { display: block; margin-bottom: 0.25rem; font-weight: 600; font-size: 0.875rem; }
.setting-row input { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
.error { color: #d32f2f; font-size: 0.875rem; margin-top: 0.25rem; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SettingsModal.jsx frontend/src/styles.css
git commit -m "feat: SettingsModal with PIN authentication and styles"
```

---

## Task 10: Frontend — 매매 탭 통합

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: App.jsx에 매매 탭 추가**

기존 탭 상태에 `"sale"` 추가:
```jsx
// 탭 목록에 추가
{ key: "sale", label: "매매" }
```

매매 탭 뷰 렌더링:
```jsx
{activeTab === "sale" && (
  <SaleListingsView />
)}
```

설정 아이콘 추가 (헤더 우측):
```jsx
import { SettingsModal } from "./components/SettingsModal.jsx";

// 헤더에 추가
<button onClick={() => setShowSettings(true)}>🔧</button>
{showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
```

- [ ] **Step 2: SaleListingsView 컴포넌트 구현**

`frontend/src/components/SaleListingsView.jsx` 신규 생성:

```jsx
// frontend/src/components/SaleListingsView.jsx
import { useState, useEffect } from "react";
import { AffordabilityBadge } from "./AffordabilityBadge.jsx";

export function SaleListingsView() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    sigungu: "",
    salePriceMax: "",
    onlyFeasible: false,
  });
  const [feasibleIds, setFeasibleIds] = useState(new Set());

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ lease_type: "매매" });
    if (filters.sigungu) params.set("sigungu", filters.sigungu);
    if (filters.salePriceMax) params.set("sale_price_max", filters.salePriceMax);

    fetch(`/api/listings?${params}`)
      .then((r) => r.json())
      .then((data) => setListings(data.listings || []))
      .finally(() => setLoading(false));
  }, [filters.sigungu, filters.salePriceMax]);

  const displayed = filters.onlyFeasible
    ? listings.filter((l) => feasibleIds.has(l.listing_id))
    : listings;

  return (
    <div className="sale-listings">
      {/* 필터 바 */}
      <div className="filter-bar">
        <input
          placeholder="구 입력 (예: 노원구)"
          value={filters.sigungu}
          onChange={(e) => setFilters((f) => ({ ...f, sigungu: e.target.value }))}
        />
        <input
          placeholder="최대 매매가 (만원)"
          value={filters.salePriceMax}
          onChange={(e) => setFilters((f) => ({ ...f, salePriceMax: e.target.value }))}
        />
        <label>
          <input
            type="checkbox"
            checked={filters.onlyFeasible}
            onChange={(e) => setFilters((f) => ({ ...f, onlyFeasible: e.target.checked }))}
          />
          내 자본으로 가능한 매물만
        </label>
      </div>

      {/* 매물 카드 목록 */}
      {loading && <p>로딩 중...</p>}
      <div className="listing-grid">
        {displayed.map((listing) => (
          <div key={listing.listing_id} className="listing-card">
            <div className="listing-card-header">
              <span className="property-type">{listing.property_type}</span>
              <AffordabilityBadge
                salePrice={listing.sale_price}
                onResult={(r) => {
                  if (r?.feasible) setFeasibleIds((s) => new Set([...s, listing.listing_id]));
                }}
              />
            </div>
            <p className="address">{listing.address_road || listing.address_jibun}</p>
            <p className="price">매매가 {listing.sale_price?.toLocaleString()}만원</p>
            <p className="area">{listing.area_m2}㎡ · {listing.floor}층 · {listing.building_year}년</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`AffordabilityBadge`에 `onResult` prop 추가 (`frontend/src/components/AffordabilityBadge.jsx`):
```jsx
// useEffect 내 .then(setResult) 변경
.then((r) => { setResult(r); onResult?.(r); })
```

- [ ] **Step 3: 브라우저에서 동작 확인**

```bash
npm run dev
```

- 매매 탭 클릭 → 매물 목록 표시
- 각 카드에 배지 표시 (✅ 또는 ⚠️)
- 🔧 클릭 → PIN 모달 → 설정 입력 가능

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/
git commit -m "feat: 매매 탭, 설정 아이콘, AffordabilityBadge 통합"
```

---

## Task 11: Ship Blockers 최종 검증

스펙의 완료 기준 7개 체크:

- [ ] `\d normalized_listings | grep sale_price` → 컬럼 존재
- [ ] `POST /api/settings` PIN으로 값 저장 → DB 확인
- [ ] 매매 수집 100건 이상 → COUNT 확인
- [ ] `GET /api/affordability?salePrice=48000` → feasible/shortage/monthlyPayment 반환
- [ ] 브라우저 매매 탭 → 카드 + 배지 렌더링
- [ ] PIN 없이 `POST /api/settings/read` → 401 반환
- [ ] 월세 탭 정상 표시

```bash
npx vitest run
```

Expected: 전체 PASS

- [ ] **최종 Commit**

```bash
git add -A
git commit -m "feat: 매매 매물 기능 완성 — 수집/계산/UI 통합"
```
