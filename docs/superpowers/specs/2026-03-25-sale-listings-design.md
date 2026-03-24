# 매매 매물 기능 설계 문서

**날짜:** 2026-03-25
**범위:** 기존 월세 수집 도구에 매매 매물 수집 + 구매 가능 여부 판단 기능 추가

---

## 배경 및 목표

### 사용자 상황
- 92년생 남성, 만 34세
- 자기자본 1억, 연소득 7천만원
- 청년 주택드림 청약통장 2년 가입, 1,000만원 납입
- 서울 거주 필수

### 대출 분석 결과 (2026년 3월 기준 팩트)
- 서울 전역 투기과열지구 + 조정대상지역 (2025.10.16~)
- LTV 70% 적용 (생애최초 포함, 수도권 규제지역 기준)
- 연소득 7천만원 → 보금자리론 생애최초 자격 통과 (7천만원 이하)
- **현재 자본(1억)으로 최대 매수가: 3.3억** (LTV 70% 기준)
- **서울 5억 아파트 목표 시 필요 자기자본: 최소 1.6억** (자기자본 1.5억 + 부대비용)
- 다주택자 양도세 중과 유예 2026.5.9 종료 → 5월 이전 급매 가능성 존재

### 목표
매매 매물을 월세와 분리하여 탐색하고, 현재 내 자본/소득 조건으로 구매 가능한 매물을 즉시 식별할 수 있는 도구 추가.

---

## 선택한 접근 방식

**방식 B: 매매 탭 + 내 조건 기반 필터**

- 매매 매물 수집 (기존 월세 인프라 재사용)
- 서버 사이드 구매 가능 여부 계산 (개인 재정 정보 클라이언트 노출 없음)
- 국토부 실거래가 API 연동 (시세 대비 판단)
- PIN 보호 설정 화면

제외 (추후 확장): 신규 분양 청약홈 연동, 커뮤니티 기반 지역 인사이트

---

## 설계

### 1. 데이터 수집

#### 수집 플랫폼

| 플랫폼 | 매매 지원 | 방식 |
|--------|---------|------|
| 네이버부동산 | ✅ | 거래유형 파라미터 변경 |
| KB부동산 | ✅ | CDP 방식 유지, 물건종류 코드 추가 |
| 직방 | ✅ | API 파라미터 변경 |
| 다방 | ✅ | API 파라미터 변경 |
| 피터팬 | ❌ | 월세 전용, 대상 외 |

#### 수집 조건 (`platform_sampling_targets.json` 확장)

```json
{
  "leaseType": "매매",
  "propertyTypes": ["아파트", "빌라/연립", "단독/다가구"],
  "salePriceMax": 70000,
  "minAreaM2": 40
}
```

> 금액 단위: 만원 통일 (70000 = 7억). 기존 `rentMax`, `depositMax`와 동일 단위.

#### 플랫폼별 수집 변경 포인트

| 플랫폼 | 파일 | 변경 내용 |
|--------|------|----------|
| 네이버 | `naver_auto_collector.mjs` | `tradeType: "B2"` (월세) → `"A1"` (매매)로 분기; 아파트 타입 코드 `APT` 추가 |
| KB부동산 | `kbland_auto_collector.mjs` | `dealType` 파라미터 `"3"` (월세) → `"1"` (매매)로 분기 |
| 직방 | `zigbang_auto_collector.mjs` | `salesTypes` 파라미터에 `"buy"` 추가 |
| 다방 | `dabang_auto_collector.mjs` | `room_type` 파라미터에 매매 코드 추가 |

#### 어댑터 정규화 추가 (`scripts/adapters/*.mjs`)

각 플랫폼 어댑터에서 다음 필드 추출:

| 필드 | 네이버 원본키 (추정) | KB 원본키 (추정) | 직방 원본키 (추정) |
|------|------------|---------|----------|
| `sale_price` | `dealPrice` | `salePrice` | `price` |
| `loan_amount` | `loanPrice` | `loanAmount` | `loan` |
| `building_year` | `buildYear` | `useApproveYmd` (연도만) | `builtIn` |

> ⚠️ 위 키명은 추정값. 구현 시 실제 수집 테스트로 확인 후 확정 필요.

매매 매물의 `lease_type`은 `'매매'`로 설정. 기존 월세/전세 어댑터 로직 변경 없음.

#### 정규화 추가 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `sale_price` | INTEGER | 매매가 (만원) |
| `loan_amount` | INTEGER | 융자금 (만원) |
| `building_year` | INTEGER | 건축연도 |

---

### 2. DB 스키마 변경

마이그레이션 파일: `db/migrations/008_add_sale_columns.sql`

기존 `lease_type` CHECK 제약에 `'매매'` 추가 (별도 `deal_type` 컬럼 추가 없음 — 기존 한국어 컨벤션 유지).

```sql
-- 008_add_sale_columns.sql

-- lease_type CHECK 확장: '매매' 추가
ALTER TABLE normalized_listings
  DROP CONSTRAINT IF EXISTS normalized_listings_lease_type_check;
ALTER TABLE normalized_listings
  ADD CONSTRAINT normalized_listings_lease_type_check
    CHECK (lease_type IN ('월세', '전세', '단기', '기타', '매매'));

-- 매매 전용 필드 추가
ALTER TABLE normalized_listings
  ADD COLUMN IF NOT EXISTS sale_price INTEGER,       -- 매매가 (만원)
  ADD COLUMN IF NOT EXISTS loan_amount INTEGER,      -- 융자금 (만원)
  ADD COLUMN IF NOT EXISTS building_year INTEGER;    -- 건축연도

CREATE INDEX IF NOT EXISTS idx_listings_sale
  ON normalized_listings(lease_type, sale_price)
  WHERE lease_type = '매매';
```

기존 월세/전세 데이터는 변경 없음. 매매 매물은 `lease_type = '매매'`로 구분.

---

### 3. 구매 가능 여부 계산 (서버 사이드)

#### 설정 저장 구조

사용자 재정 설정은 DB의 `user_settings` 테이블에 저장. 읽기/쓰기 모두 PIN 인증 필요.

migration 008에 포함:
```sql
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 저장 키 목록:
-- my_capital   : 자기자본 (만원, 예: "10000")
-- my_income    : 연소득 (만원, 예: "7000")
-- loan_type    : 대출 상품 ("bogeumjari" | "general")
-- ltv_ratio    : LTV 비율 ("0.70")
-- dti_limit    : DTI 한도 ("0.60")
```

PIN은 서버 환경변수 `SETTINGS_PIN`으로 관리. 클라이언트에 절대 노출하지 않음.

#### API 엔드포인트

```
POST /api/settings/read         → PIN 인증 후 설정값 반환 (body에 pin 포함)
POST /api/settings              → 설정값 수정 (body에 pin 포함)
GET  /api/affordability?salePrice=48000  → 계산 결과만 반환 (공개, 재정 원본값 미포함)
```

**보안 모델 명확화:**
- `POST /api/settings/read`: body `{ pin }` 형태. PIN은 쿼리 파라미터로 전달하지 않음 (브라우저 히스토리/로그 노출 방지).
- `POST /api/settings`: body `{ pin, key, value }` 형태. PIN은 HTTPS 전송이므로 개인 도구 수준에서 적절.
- `GET /api/affordability`: **인증 불필요**. 원본 자기자본/소득 값은 응답에 포함하지 않음. 계산 결과(`feasible`, `shortage`, `monthlyPayment`, `dti`)만 반환 → 공개 URL에서 재정 정보 노출 없음.

**`api/handler.mjs` 라우팅 추가 필요:**
```javascript
import { handleSettings } from './routes/settings.mjs';
import { handleAffordability } from './routes/affordability.mjs';
// pathname === '/api/settings' → handleSettings
// pathname === '/api/affordability' → handleAffordability
```

#### 계산 로직

```
필요 자기자본 = 매매가 × (1 - LTV)
대출액 = 매매가 × LTV
월 상환액 = 대출액 × 월 상환계수  (보금자리론 3.5%, 30년 기준: 0.004490)
DTI = (월상환액 × 12) / 연소득

feasible = (내 자기자본 ≥ 필요 자기자본) AND (DTI ≤ DTI 한도)
shortage = max(0, 필요 자기자본 - 내 자기자본)
```

#### 응답 예시

```json
{
  "feasible": false,
  "shortage": 4000,
  "requiredCapital": 14400,
  "loanAmount": 33600,
  "monthlyPayment": 151,
  "dti": 0.26
}
```

---

### 4. 국토부 실거래가 API 연동

공공데이터포털 아파트 매매 실거래가 API (무료, 인증키 필요).

- 단지명 + 지역코드로 최근 6개월 실거래가 조회
- 매물 상세 모달 내 "최근 실거래가" 섹션으로 표시
- 현재 매물가 vs 실거래 평균가 비교 표시 (예: "시세 대비 +3.2%")

---

### 5. UI 구조

#### 탭 변경

```
[월세] [매매] [즐겨찾기] [대시보드]
```

#### 매매 탭 필터

- 지역 (구 선택)
- 매매가 범위 (슬라이더)
- 면적 범위
- 매물 종류 (아파트 / 빌라 / 전체)
- **"내 자본으로 가능한 매물만" 토글**

#### 매물 카드 배지

```
✅ 가능   현재 자본으로 구매 가능
⚠️ 3,600만원 부족   추가 자본 필요
```

#### 설정 화면

우측 상단 설정 아이콘(🔧) → PIN 입력 모달 → 성공 시 설정 폼 표시

설정 항목:
- 자기자본 (만원)
- 연소득 (만원)
- 대출 상품 선택 (보금자리론 / 일반 주담대)
- LTV (자동 입력: 규제지역 70%)
- DTI 한도 (자동 입력: 60%)

#### 매물 상세 모달 추가

기존 모달에 섹션 추가:
- 구매 가능 여부 상세 (필요 자기자본, 월 상환액, DTI)
- 최근 실거래가 목록 (국토부 API)

---

## 데이터 흐름

```
수집 스크립트
  └─ leaseType: "매매" + propertyTypes: ["아파트", ...]
        ↓
raw_listings (payload_json에 매매 데이터)
        ↓
normalized_listings (lease_type: '매매', sale_price, ...)
        ↓
GET /api/listings?dealType=sale
GET /api/affordability?salePrice=N  ←  user_settings (서버 사이드)
        ↓
매매 탭 UI (배지 + 필터 + 실거래가 모달)
```

---

## 구현 범위 외 (추후 확장)

- 신규 분양 청약홈 연동
- 지역 커뮤니티 인사이트 (웹 검색 기반)
- 자동 시세 알림
- **국토부 실거래가 API**: 공공데이터포털 아파트 매매 실거래가 API (인증키 발급 필요). 주소 매칭 로직, 캐싱 전략, 요청 제한 처리 등 별도 설계 필요 → v2에서 구현.

## 매처(중복 매칭) 처리 방침

- 매매 매물은 **월세/전세 매물과 매칭하지 않음** (`lease_type` 기준으로 분리)
- 매매 매물끼리의 크로스 플랫폼 중복 매칭은 기존 `matcher_v1.mjs` 로직 재사용 (주소 + 면적 + 매매가 기준)
- `collection_runs` 테이블에 매매 수집 기록 시 `target_min_rent`/`target_max_rent` 대신 `extra` JSONB에 `{ "sale_price_max": 70000 }` 형태로 저장

## 미해결 항목 (구현 전 확인 필요)

- 각 플랫폼 어댑터의 실제 매매 원본 키명은 실제 수집 테스트 후 확정 필요 (위 표는 추정값)
- R114, 당근마켓 수집기의 매매 지원 여부: 수집 스크립트 확인 후 포함 여부 결정
- 현재 운영 DB의 `normalized_listings` 실제 컬럼 상태 확인 후 마이그레이션 실행

---

## 환경변수 추가 필요

```
SETTINGS_PIN=<사용자 지정 PIN>
```

> `MOLIT_API_KEY`는 v2(국토부 실거래가 API) 구현 시 추가.
