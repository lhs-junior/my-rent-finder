# KB부동산 자동 수집 및 DB 저장 가이드

## 1. 개요

KB부동산(kbland.kr)에서 서울 8개 구의 월세 매물을 자동 수집하여 PostgreSQL DB에 저장하는 파이프라인.

**전략**: Chrome CDP(Chrome DevTools Protocol)로 기존 로그인된 브라우저에 연결 → `page.route()` 인터셉트로 API 요청 필터를 변경 → 응답에서 매물 데이터 추출.

**핵심 차별점**: 별도 인증/쿠키 관리 불필요. 사용자가 이미 로그인한 Chrome 세션을 그대로 활용하므로 Vuex/Axios 인터셉터의 인증 헤더가 자동 전달됨.

## 2. 사전 준비

### 2.1 Chrome 디버깅 모드 실행

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-debug-profile"
```

- 반드시 **별도 프로파일**(`--user-data-dir`)을 사용해야 기존 Chrome과 충돌하지 않음
- 실행 후 `https://kbland.kr` 에 접속하여 지도 페이지가 로드된 상태 유지
- CDP 연결 확인: `curl -s http://localhost:9222/json/version`

### 2.2 필요 패키지

```bash
npm install playwright  # CDP 연결용
npm install pg          # PostgreSQL 클라이언트 (DB 저장 시)
```

### 2.3 DB 환경변수 (.env)

DB 저장을 위해 PostgreSQL 접속 정보가 필요:

```
PGHOST=localhost
PGDATABASE=rent_finder
PGUSER=your_user
PGPASSWORD=your_password
```

## 3. 수집 실행

### 3.1 기본 실행 (8개 구 전체)

```bash
node scripts/kbland_auto_collector.mjs \
  --sigungu "노원구,중랑구,동대문구,광진구,성북구,성동구,중구,종로구" \
  --sample-cap 9999 \
  --verbose
```

### 3.2 CLI 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--sigungu` | `노원구` | 수집 대상 구 (쉼표 구분) |
| `--sample-cap` | `200` | 구별 최대 수집 건수 (9999=무제한) |
| `--rent-max` | `80` | 월세 상한 (만원) |
| `--deposit-max` | `6000` | 보증금 상한 (만원) |
| `--min-area` | `40` | 최소 전용면적 (㎡) |
| `--verbose` | off | 상세 로그 출력 |

### 3.3 출력 파일

수집 완료 시 `scripts/` 디렉토리에 3개 파일 생성:

| 파일 | 설명 |
|------|------|
| `kbland_raw.jsonl` | 원본 매물 데이터 (platform_code, external_id, payload_json 포함) |
| `kbland_normalized.jsonl` | 정규화된 매물 데이터 (DB normalized_listings 테이블 호환) |
| `kbland_capture_results.json` | 수집 요약 + DB 저장용 summary (runId, results[] 포함) |

## 4. DB 저장

### 4.1 저장 실행

```bash
node scripts/kbland_persist_db.mjs
```

또는 summary 파일 경로를 직접 지정:

```bash
node scripts/kbland_persist_db.mjs --summary /path/to/kbland_capture_results.json
```

### 4.2 저장되는 테이블

| 테이블 | 설명 |
|--------|------|
| `collection_runs` | 수집 런 메타데이터 (run_id, status, query_district 등) |
| `raw_listings` | 원본 매물 (platform_code='kbland', external_id=매물일련번호) |
| `normalized_listings` | 정규화 매물 (주소, 월세, 보증금, 면적, 방수 등) |

### 4.3 DB 검증 쿼리

```sql
-- 저장 건수 확인
SELECT count(*) FROM raw_listings WHERE platform_code = 'kbland';
SELECT count(*) FROM normalized_listings WHERE platform_code = 'kbland';

-- 수집 런 확인
SELECT run_id, status, query_district
FROM collection_runs WHERE platform_code = 'kbland';

-- 샘플 데이터
SELECT external_id, address_text, rent_amount, deposit_amount, area_exclusive_m2, room_count
FROM normalized_listings WHERE platform_code = 'kbland'
ORDER BY listing_id LIMIT 10;
```

### 4.4 전체 파이프라인 (수집 + 저장)

```bash
# 1) 수집
node scripts/kbland_auto_collector.mjs \
  --sigungu "노원구,중랑구,동대문구,광진구,성북구,성동구,중구,종로구" \
  --sample-cap 9999 --verbose

# 2) DB 저장
node scripts/kbland_persist_db.mjs
```

## 5. 기술 아키텍처

### 5.1 수집 흐름

```
Chrome CDP 연결
  → kbland.kr 탭 탐색
    → 구별 루프:
      → 지도 페이지 이동 (/map/{bbox})
      → Vuex markerMaemulList에서 클러스터 ID 획득
      → 클러스터별 루프:
        → /cl/{클러스터ID} 이동
        → page.route() 인터셉트로 필터 변경:
           - 물건종류: 08(빌라),38(연립),09(단독)
           - 거래유형: 3(월세)
        → 응답에서 propertyList 추출
        → 매물일련번호 기준 중복 제거
      → 조건 필터 적용 (월세/보증금/면적)
      → JSONL 레코드 생성
```

### 5.2 Cross-District 중복 제거

- **클러스터 레벨**: `visitedClusters` Set — 이미 방문한 클러스터 ID는 다른 구에서 스킵
- **매물 레벨**: `globalSeenIds` Set — 매물일련번호 기준으로 같은 매물 중복 저장 방지

실측: 170개 클러스터 방문 중 82개 클러스터 스킵, 2,415건 원본 중 394건 필터 통과.

### 5.3 page.route() 인터셉트

KB부동산의 `/land-property/propList/filter` API 호출 시 요청 body를 가로채서 필터 조건을 주입:

```javascript
await page.route("**/propList/filter", async (route) => {
  const req = route.request();
  const body = JSON.parse(req.postData());
  body.물건종류코드 = "08,38,09";  // 빌라+연립+단독
  body.매물거래구분 = "3";          // 월세
  const response = await route.fetch({ postData: JSON.stringify(body) });
  // 응답 캡처 후 continue
});
```

핵심: 브라우저의 기존 인증 헤더(Vuex interceptor)가 유지되므로 별도 인증 불필요.

## 6. 트러블슈팅

### CDP 연결 실패

```
✗ CDP 연결 실패: connect ECONNREFUSED
```

→ Chrome이 `--remote-debugging-port=9222`로 실행 중인지 확인. 기존 Chrome 프로세스가 있으면 종료 후 재시작.

### kbland.kr 탭을 찾을 수 없음

```
✗ kbland.kr 탭을 찾을 수 없습니다
```

→ Chrome에서 kbland.kr 페이지가 열려있는지 확인. 지도 페이지(`/map/...` 또는 `/cl/...`)가 활성 상태여야 함.

### API 응답 0건

특정 클러스터에서 `API 0건`이 반복되는 경우:
- 해당 클러스터에 필터 조건에 맞는 매물이 없음 (정상)
- 또는 API 응답이 3초 내에 도착하지 않음 → wait 시간 조정 고려

### 페이지네이션 경고

```
⚠ 페이지네이션 필요: 총69건 중 64건만 반환됨
```

→ KB부동산 API가 한 번에 최대 ~65건까지만 반환. 현재는 첫 페이지만 수집. 누락률은 약 5% 이내로 실용적 수준.

### DB 저장 실패

```
❌ DB 저장 실패: connect ECONNREFUSED
```

→ PostgreSQL이 실행 중인지, `.env` 파일의 접속 정보가 올바른지 확인.

## 7. 수집 결과 예시 (2026-02-17)

| 구 | 원본 | 필터 후 | 스킵 클러스터 |
|---|---:|---:|---:|
| 노원구 | 245 | 53 | 0 |
| 중랑구 | 660 | 119 | 0 |
| 동대문구 | 484 | 89 | 2 |
| 광진구 | 620 | 83 | 1 |
| 성북구 | 138 | 17 | 15 |
| 성동구 | 50 | 5 | 29 |
| 중구 | 112 | 4 | 17 |
| 종로구 | 106 | 24 | 18 |
| **합계** | **2,415** | **394** | **82** |

필터 조건: 월세 ≤80만원, 보증금 ≤6,000만원, 전용면적 ≥40㎡, 빌라/연립/단독/다가구
