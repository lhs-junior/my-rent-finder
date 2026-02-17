# my-rent-finder

서울에서 월세 방을 구할 때, 네이버부동산·다방·직방·피터팬 등 플랫폼마다 올라오는 매물이 다르고, 같은 매물이 여러 곳에 중복 등록되어 있어 비교가 번거롭습니다.

이 프로젝트는 주요 부동산 플랫폼에서 **월세 매물을 자동 수집**하고, 플랫폼마다 다른 데이터 형식을 **하나의 통합 스키마로 정규화**한 뒤, 주소·면적·가격 기반 **중복 매칭**을 통해 동일 매물을 묶어주는 개인용 도구입니다. 수집된 결과는 React 대시보드에서 한눈에 확인할 수 있습니다.

## 수집 플랫폼

### 활성 (파이프라인 통합)

| 플랫폼 | 수집 방식 | 스크립트 | 비고 |
|--------|----------|---------|------|
| 네이버부동산 | Playwright Stealth | `naver_auto_collector.mjs` | 마커 기반 구역별 수집 |
| 다방 | Playwright Stealth | `dabang_auto_collector.mjs` | `hasMore` 기반 페이지네이션 |
| 직방 | Playwright Stealth | `zigbang_auto_collector.mjs` | 전용면적 40m² 이상 필터 |
| 피터팬 | Direct Node.js fetch | `peterpanz_auto_collector.mjs` | 브라우저 불필요 |
| 당근부동산 | Playwright Stealth | `daangn_auto_collector.mjs` | |

### 독립 수집기 (수동 실행)

| 플랫폼 | 수집 방식 | 스크립트 | 비고 |
|--------|----------|---------|------|
| KB부동산 | Chrome CDP + Playwright Route Intercept | `kbland_auto_collector.mjs` | Chrome 디버깅 모드 필요, 파이프라인 미통합 |

KB부동산은 Vuex/Axios 인터셉터가 주입하는 인증 헤더를 재현할 수 없어, Chrome CDP를 통해 실제 브라우저 세션에 붙어서 API 응답을 가로채는 방식으로 수집합니다. 자동화 파이프라인과 구조가 달라 별도 실행이 필요합니다.

### 비활성

| 플랫폼 | 상태 | 사유 |
|--------|-----|------|
| 부동산114 | BLOCKED | 수집/정규화 데이터 품질 저하로 비활성화. 원인 확인 후 재활성화 예정 |

## 기술 스택

- **런타임**: Node.js 20+
- **수집**: Playwright + puppeteer-extra-plugin-stealth
- **DB**: PostgreSQL 16 (Docker)
- **프론트엔드**: React 18 + Vite
- **테스트**: Vitest
- **린트/포맷**: ESLint + Prettier

## 프로젝트 구조

```
my-rent-finder/
├── scripts/                  # 수집·정규화·매칭·API 서버
│   ├── *_auto_collector.mjs  # 플랫폼별 수집기
│   ├── adapters/             # 플랫폼별 정규화 어댑터
│   ├── matcher_v1.mjs        # 크로스 플랫폼 중복 매칭
│   ├── run_parallel_collect.mjs    # 병렬 수집 오케스트레이터
│   ├── collect_ops_pipeline.mjs    # 전체 운영 파이프라인
│   ├── build_operations_payload.mjs # 대시보드 데이터 생성
│   ├── api_server.mjs        # REST API 서버
│   └── lib/                  # 공용 유틸 (DB 클라이언트, CLI 도구 등)
├── frontend/                 # React SPA 대시보드
│   └── src/
│       └── components/
│           ├── OperationsDashboard.jsx  # 수집 현황 대시보드
│           ├── ListingSearch.jsx        # 매물 검색
│           └── MatchingBoard.jsx        # 중복 매칭 결과
├── db/
│   ├── schema_v1.sql         # DB 스키마
│   └── migrations/           # 마이그레이션 파일
├── docker-compose.yml
└── package.json
```

## 시작하기

### 1. 사전 요구사항

- Node.js 20 이상
- Docker (PostgreSQL용)

### 2. 설치

```bash
# 의존성 설치
npm install

# Playwright 브라우저 설치
npx playwright install chromium

# 환경변수 설정
cp .env.example .env
# .env 파일을 열어 필요한 값 수정 (기본값으로도 동작)
```

### 3. 데이터베이스 설정

```bash
# PostgreSQL 컨테이너 실행
npm run db:up

# DB 준비 대기
npm run db:wait

# 스키마 초기화 + 마이그레이션
npm run db:init
npm run db:migrate
```

### 4. 매물 수집

```bash
# 전체 플랫폼 병렬 수집 (정규화 포함, 플랫폼당 최대 100건)
npm run collect:parallel

# 수집 + DB 저장
npm run collect:parallel:db

# 전체 운영 파이프라인 (수집 → 정규화 → 매칭 → DB 저장)
npm run collect:parallel:db:full
```

KB부동산을 별도로 수집하려면:

```bash
# 1. Chrome을 디버깅 모드로 실행
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug-profile"

# 2. 수집기 실행
node scripts/kbland_auto_collector.mjs
```

### 5. 대시보드 실행

```bash
# 프론트엔드 빌드 + API 서버 실행
npm start
# → http://127.0.0.1:4100 에서 대시보드 확인
```

또는 전체 스택을 한번에:

```bash
# DB + 수집 파이프라인 + API 서버 올인원
npm run ops:full:stack
# → http://127.0.0.1:4100
```

## 주요 명령어

### 수집

| 명령어 | 설명 |
|-------|------|
| `npm run collect:parallel` | 활성 플랫폼 병렬 수집 (파일 저장) |
| `npm run collect:parallel:db` | 병렬 수집 + DB 저장 |
| `npm run collect:parallel:db:full` | 전체 운영 파이프라인 |

### 데이터베이스

| 명령어 | 설명 |
|-------|------|
| `npm run db:up` | PostgreSQL 컨테이너 시작 |
| `npm run db:down` | PostgreSQL 컨테이너 종료 (볼륨 삭제) |
| `npm run db:init` | 스키마 초기화 |
| `npm run db:migrate` | 마이그레이션 실행 |
| `npm run db:logs` | PostgreSQL 로그 확인 |

### 대시보드

| 명령어 | 설명 |
|-------|------|
| `npm start` | 프론트엔드 빌드 + API 서버 |
| `npm run api:server` | API 서버만 실행 (4100 포트) |
| `npm run front:dev` | 프론트엔드 개발 서버 (HMR) |
| `npm run front:build` | 프론트엔드 프로덕션 빌드 |
| `npm run ops:full:stack` | DB + 파이프라인 + API 올인원 |

### 개발

| 명령어 | 설명 |
|-------|------|
| `npm test` | 테스트 실행 (Vitest) |
| `npm run lint` | ESLint 검사 |
| `npm run format` | Prettier 포맷 적용 |
| `npm run format:check` | 포맷 검사만 |

## 대시보드 화면

대시보드는 3개의 뷰를 제공합니다:

- **수집 현황** (`/`) — 플랫폼별 수집 상태, 성공/실패 건수, 최근 수집 이력
- **매물 검색** (`/?view=listings`) — 정규화된 매물 목록 검색 및 상세 조회
- **매칭 보드** (`/?view=matching`) — 크로스 플랫폼 중복 매칭 결과 확인

## 데이터 파이프라인

```
수집 (Playwright)  →  정규화  →  DB 저장  →  중복 매칭  →  대시보드

naver              adapters/   raw_listings   matcher_v1   API 서버
dabang             *_adapter   normalized_    match_       React SPA
zigbang                        listings       groups
peterpanz
daangn
```

1. **수집**: 각 플랫폼에서 Playwright Stealth로 매물 데이터 크롤링
2. **정규화**: 플랫폼별 어댑터가 통합 스키마로 변환 (주소 코드, 면적 m², 월세/보증금 등)
3. **DB 저장**: raw + normalized 매물을 PostgreSQL에 저장
4. **중복 매칭**: 주소·면적·가격·속성 기반 가중 점수로 동일 매물 식별 (93점 이상 자동 매칭)
5. **대시보드**: REST API + React SPA로 결과 조회

## Docker 전체 실행

```bash
docker compose up -d
# postgres (5432) + api (4100) 실행
```

## 환경변수

| 변수 | 기본값 | 설명 |
|------|-------|------|
| `PGHOST` | `127.0.0.1` | PostgreSQL 호스트 |
| `PGPORT` | `5432` | PostgreSQL 포트 |
| `PGDATABASE` | `my_rent_finder` | 데이터베이스 이름 |
| `PGUSER` | `postgres` | DB 사용자 |
| `PGPASSWORD` | `postgres` | DB 비밀번호 |
| `PGHOST_PORT` | `5432` | Docker 포트 매핑 |
| `API_HOST` | `127.0.0.1` | API 서버 호스트 |
| `API_PORT` | `4100` | API 서버 포트 |
