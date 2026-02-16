<!-- Generated: 2026-02-16 | Updated: 2026-02-16 -->

# my-rent-finder

## Purpose
서울 원룸/투룸 월세 매물을 여러 부동산 플랫폼(네이버 부동산, 직방, 다방, 부동산114 등)에서 수집하고, 정규화(normalize)하여 동일 매물을 자동 매칭(dedup)하는 개인용 매물 통합 탐색 도구. 현재 MVP 단계로 백엔드 수집/정규화/매칭 파이프라인이 구현되어 있으며, 프론트엔드 대시보드는 설계 단계이다.

## Project Definition

### 핵심 목표
개인 사용자가 서울 주거 매물을 여러 플랫폼에서 반복 탐색하는 비용을 줄이기 위해, 조건(시/구/동, 월세, 평수, 월세유형) 기반으로 매물을 **수집 -> 정규화 -> 중복매칭 -> 비교** 관리하는 단일 시스템을 구축한다.

### 아키텍처 (3-Layer 데이터 모델)
1. **원시층 (Raw)**: 플랫폼 원본 데이터 그대로 보존, 파싱 실패 추적
2. **정규화층 (Normalized)**: 통합 검색/노출 기준 스키마로 변환
3. **파생층 (Derived)**: 중복 매칭 점수, 가격 변동, 품질 지표

### 수집 모드 분류
- `API`: 공식/공개 API 사용
- `STEALTH_AUTOMATION`: Playwright 기반 브라우저 자동화 + 네트워크 캡처
- `BLOCKED`: 접근 제한, 추후 재검토

### 현재 지원 플랫폼
| 플랫폼 | 수집 모드 | Adapter 상태 |
|--------|-----------|-------------|
| 네이버 부동산 | STEALTH_AUTOMATION | READY (전용 adapter) |
| 직방 | STEALTH_AUTOMATION | READY (범용 adapter) |
| 다방 | STEALTH_AUTOMATION | READY (범용 adapter) |
| 부동산114 | STEALTH_AUTOMATION | READY (범용 adapter) |

### 검색 조건 (현재 타겟)
- 지역: 서울시 (노원구, 중랑구, 동대문구, 광진구, 성북구, 성동구, 중구, 종로구)
- 매물유형: 빌라/연립, 단독/다가구
- 임대유형: 월세
- 월세: 0~80만원, 보증금: ~6000만원
- 최소면적: 40m²

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Node.js 프로젝트 설정. 의존성: playwright, playwright-extra, puppeteer-extra-plugin-stealth |
| `package-lock.json` | 의존성 lock 파일 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `scripts/` | 수집, 정규화, 매칭, 검증, 분석 실행 스크립트 (see `scripts/AGENTS.md`) |
| `docs/` | 설계 문서, 데이터 계약, 플랫폼 분석 보고서 (see `docs/AGENTS.md`) |
| `db/` | PostgreSQL 데이터베이스 스키마 (see `db/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- 모든 스크립트는 ESM (`import`/`export`) 기반 `.mjs` 파일이다
- CLI 인자는 `--key=value` 또는 `--key value` 형식으로 통일되어 있다
- 한국어 데이터(주소, 가격단위 억/만/원, 면적 평/m²)를 다루므로 유니코드 처리에 주의
- `.tmp_*` 파일들은 Playwright 캡처 중 생성되는 임시 스크린샷으로 무시해도 됨
- `--out-dir/`은 잘못된 CLI 파싱으로 생성된 아티팩트 디렉토리 (무시 가능)

### Tech Stack
- **Runtime**: Node.js (ESM)
- **Language**: JavaScript (.mjs)
- **Browser Automation**: Playwright + stealth plugin
- **Database**: PostgreSQL (스키마 정의됨, 아직 연동 코드 미구현)
- **Package Manager**: npm

### Data Pipeline Flow
```
[플랫폼 웹사이트]
    ↓ (Playwright stealth capture / API call)
[Raw JSONL 파일] (.jsonl)
    ↓ (Adapter: normalizeFromRawRecord)
[Normalized JSON] (통합 스키마)
    ↓ (matcher_v1.mjs: scorePair + unionFind)
[Match Groups] (AUTO_MATCH / REVIEW_REQUIRED / DISTINCT)
    ↓ (향후)
[PostgreSQL DB] + [Frontend Dashboard]
```

### Key Conventions
- 가격 단위: 만원 (rent_amount=75 → 월세 75만원)
- 면적 단위: m² (area_exclusive_m2)
- 주소 코드: FNV-1a 해시 기반 11자리 코드
- 매칭 점수: 0~100 (≥93 자동매칭, 80~93 검토필요, <80 별도매물)
- lease_type: 월세, 전세, 매매, 기타
- area_claimed: exclusive, gross, range, estimated

### Testing Requirements
- 현재 테스트 프레임워크 미설정 (`npm test`는 placeholder)
- 스크립트별 `--input` 인자로 샘플 JSON을 넣어 수동 테스트

## Dependencies

### External
- `playwright` ^1.58.2 - 브라우저 자동화 (stealth 네트워크 캡처)
- `playwright-extra` ^4.3.6 - Playwright stealth 확장
- `puppeteer-extra-plugin-stealth` ^2.11.2 - 봇 감지 우회 플러그인

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
