# 수동 수집 & 매물 정리 운영 가이드

## 개요

플랫폼별 매물 데이터를 최신으로 유지하고, 종료된 매물을 정리하는 운영 가이드.

| 플랫폼 | 수집 방식 | 자동화 가능 | 비고 |
|--------|-----------|-------------|------|
| daangn | Node.js fetch | Yes | CI 크론잡 |
| dabang | Node.js fetch | Yes | CI 크론잡 |
| zigbang | Node.js fetch | Yes | CI 크론잡 |
| peterpanz | Node.js fetch | Yes | CI 크론잡 |
| naver | Playwright stealth | Semi | 로컬 실행 권장 (429 rate limit) |
| kbland | Chrome CDP | No | 비-headless Chrome 필수 |

---

## 1. 종료 매물 정리 (전 플랫폼)

### 전체 플랫폼 상태 체크 + soft-delete

```bash
node scripts/check_listing_status.mjs --platform all
```

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--platform` | `all` | 특정 플랫폼만: `kbland`, `zigbang`, `dabang`, `peterpanz`, `naver`, `daangn` |
| `--batch-size` | `999` | 한 번에 체크할 최대 매물 수 |
| `--delay-ms` | `200` | API 호출 간 딜레이 (rate limit 방지) |
| `--dry-run` | off | DB 변경 없이 결과만 확인 |
| `--verbose` | off | 활성 매물도 로그 출력 |

### 드라이런으로 먼저 확인

```bash
node scripts/check_listing_status.mjs --platform kbland --dry-run --verbose
```

### 플랫폼별 체크 로직

| 플랫폼 | 체크 방식 | 종료 판정 기준 |
|--------|-----------|---------------|
| kbland | dtailInfo API | `매물상태구분 == "4"` 또는 `매물상태변경사유`에 노출종료/기간만료/거래완료/삭제 포함 |
| zigbang | items/list POST API | items 배열 비어있거나 status가 true/"open"이 아닌 경우 |
| dabang | 공개 room 페이지 | 404, redirect, 또는 "해당 방을 찾을 수 없" 등 텍스트 |
| peterpanz | house 페이지 | 404, redirect, 또는 "삭제된 매물" 텍스트 |
| naver | fin.land.naver.com 페이지 | "삭제된 매물", "거래가 완료" 텍스트 또는 빈 페이지 |
| daangn | realty 페이지 | 404, 또는 "삭제"/"만료" 텍스트 |

---

## 2. Naver 수집

### 자동 수집 (전 구역)

```bash
node scripts/run_parallel_collect.mjs --platforms naver --sample-cap=0 --persist-to-db
```

- Playwright stealth 브라우저로 네이버 부동산 API를 캡처
- 서울 8개 구 순차 수집
- `--persist-to-db`로 DB에 자동 저장

### 개별 구 수집

```bash
node scripts/naver_auto_collector.mjs \
  --sigungu 노원구 \
  --sample-cap 0 \
  --output-raw scripts/naver_raw.jsonl \
  --output-meta scripts/naver_meta.json
```

### DB 저장 (수동)

수집 후 별도로 DB에 저장하려면:

```bash
node scripts/run_parallel_collect.mjs --platforms naver --sample-cap=0 --persist-to-db
```

### 주의사항

- **429 rate limit**: 네이버 API가 빈번한 요청을 차단함. 로컬 실행 권장.
- **Playwright 필요**: `npm install playwright` (브라우저 바이너리 포함)
- 수집 후 반드시 상태 체크 실행하여 이미 종료된 매물 정리:
  ```bash
  node scripts/check_listing_status.mjs --platform naver
  ```

---

## 3. KBland 수집

KB부동산은 Vuex/Axios 인증 인터셉터로 인해 **비-headless Chrome**에서만 수집 가능.

### Step 1: Chrome 디버깅 모드 실행

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-debug-profile"
```

> 기존 Chrome이 실행 중이면 먼저 완전 종료해야 함

### Step 2: kbland.kr 접속

1. 열린 Chrome에서 `https://kbland.kr/map` 접속
2. 지도가 로드되고 매물 마커가 보일 때까지 대기
3. (로그인 불필요 — 지도 조회는 비로그인으로 가능)

### Step 3: CDP 연결 확인

```bash
curl -s http://localhost:9222/json/version | head -5
```

정상이면 `Browser`, `webSocketDebuggerUrl` 등이 출력됨.

### Step 4: 수집 실행

```bash
# 전체 8개 구 수집
node scripts/kbland_auto_collector.mjs \
  --sigungu-list=노원구,중랑구,동대문구,광진구,성북구,성동구,중구,종로구 \
  --sample-cap=0 --verbose

# 특정 구만 수집
node scripts/kbland_auto_collector.mjs --sigungu=노원구 --sample-cap=0 --verbose
```

### Step 5: DB 저장

```bash
node scripts/run_parallel_collect.mjs --platforms kbland --sample-cap=0 --persist-to-db
```

### Step 6: 종료 매물 정리

```bash
node scripts/check_listing_status.mjs --platform kbland
```

### 주의사항

- **headless 모드 불가**: Chrome headless에서는 Vuex 스토어가 인증 토큰을 제대로 주입하지 않아 API 응답이 빈 배열로 옴
- **별도 프로파일 필수**: `--user-data-dir`로 디버깅 전용 프로파일 사용
- 수집 결과가 0건이면: kbland.kr 탭에서 지도를 직접 조작(클러스터 클릭 등)하여 Vuex 스토어 초기화 후 재실행
- 상세 가이드: [docs/kbland_collection_guide.md](kbland_collection_guide.md)

---

## 4. 전체 운영 플로우 (권장)

```
1. 자동 수집 가능 플랫폼 먼저 실행
   node scripts/run_parallel_collect.mjs --platforms peterpanz,dabang,zigbang,daangn --sample-cap=0 --persist-to-db

2. Naver 수집 (로컬)
   node scripts/run_parallel_collect.mjs --platforms naver --sample-cap=0 --persist-to-db

3. KBland 수집 (Chrome CDP)
   → Step 1~5 위 가이드 참조

4. 전 플랫폼 종료 매물 정리
   node scripts/check_listing_status.mjs --platform all
```

---

## 5. 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| kbland 수집 0건 | Vuex 스토어 미초기화 | Chrome에서 kbland.kr 지도 직접 조작 후 재실행 |
| kbland CDP 연결 실패 | Chrome이 디버깅 모드가 아님 | `--remote-debugging-port=9222`로 재실행 |
| naver 429 에러 | API rate limit | `--delay-ms 500` 이상으로 늘리기 |
| peterpanz 0건 | API 변경 가능 | headers의 `x-peterpanz-version` 업데이트 필요 |
| DB 연결 실패 | `.env`에 DATABASE_URL 없음 | `.env`에 Neon.tech DATABASE_URL 설정 |
| status check에서 "unknown" | 플랫폼 API 응답 형식 변경 | 해당 체커 함수 디버깅 필요 |
