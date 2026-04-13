# my-rent-finder

서울 월세 매물 통합 수집·비교 플랫폼 (개인 사용).

## Architecture

```
Collection (6 platforms) → Normalization → DB → Matching → Status Check → Scoring → API → Frontend
```

- **수집**: `scripts/{platform}_auto_collector.mjs` — Playwright Stealth 또는 직접 fetch
- **정규화**: `scripts/adapters/{platform}_listings_adapter.mjs` — `base_listing_adapter.mjs` 상속
- **매칭**: `scripts/matcher_v1.mjs` — 가중 점수 (주소 30%, 거리 20%, 면적 25%, 가격 15%, 속성 10%)
- **종료 체크**: `scripts/check_listing_status.mjs` — 플랫폼별 매물 활성/종료 확인 → `deleted_at` 설정
- **배점**: `scripts/score_listings.mjs` — 가성비+환승 기반 배점 → SS/S/A/B 등급 → scored_listings 저장 (pin_favorites와 분리)
- **하네스**: `scripts/harness_runner.mjs` — 전체 파이프라인 (수집→정규화→매칭→종료체크→배점)
- **API**: `scripts/api_server.mjs` — Express-like HTTP
- **Frontend**: `frontend/` — React 18 + Vite + Kakao Map

## Golden Principles

1. 어댑터는 반드시 `base_listing_adapter.mjs`를 상속할 것
2. DB 스키마 변경은 `db/migrations/` 에 순번 파일로 추가
3. 수집기 네이밍: `{platform}_auto_collector.mjs`
4. 에러는 삼키지 말고 `contract_violations` 테이블에 기록
5. 새 플랫폼 추가 시: collector + adapter + `platform_codes` INSERT 세트로
6. 테스트는 `tests/` 디렉토리, Vitest 사용, `npm test`로 실행

## Quality Standards

- 수집 성공률 >= 80%
- 필수 필드 완성률 >= 90% (address_text, area_exclusive_m2, rent_amount, deposit_amount)
- 매칭: autoMatch >= 93점, review 80~93점, distinct < 80점

## DB 구조 (핵심 테이블)

- **normalized_listings**: 정규화된 매물 (6개 플랫폼 통합)
- **scored_listings**: AI 배점 결과 (listing_id PK, 개별점수 7개, 등급, 실질 월비용)
- **pin_favorites**: 유저 수동 찜 (pin_hash + listing_id, toggle API 사용)
- **user_favorites**: deprecated (pin_favorites로 통합)
- **listing_images**: 매물 이미지 URL

## API 엔드포인트

- `GET /api/scores?grade=SS,S,A&sort=score|cost&limit=200` — AI 추천 매물 조회
- `GET /api/scores/summary` — 등급별 개수/평균 점수/평균 실질 월비용
- `GET /api/favorites`, `POST`, `DELETE /api/favorites/:id` — 유저 찜 CRUD
- `POST /api/profile/read` — PIN 기반 설정+찜+AI등급 조회
- `POST /api/profile/favorites/toggle` — PIN 기반 찜 토글

## Scoring (배점 기준 v2 — 가성비+환승 기반)

최대 16점: 가성비RPM(0~4) + 지하철근접(0~3) + 환승횟수(0~3) + 면적(0~2) + 층수(0~2) + 연식(0~1) + 사진(0~1)

- **가성비**: 구별 m²당 월세 순위 — 하위25%=4점, 50%=3점, 75%=2점, 평균이하=1점
- **지하철**: 300m이내=3점, 500m=2점, 700m=1점
- **환승**: 서울숲/뚝섬 기준 직통(2호선·수인분당)=3점, 1환승=2점, 2환승=1점
- **등급**: SS=12점↑, S=10~11점, A=8~9점
- **탈락**: 반지하/지하, 옥탑방, 1룸/원룸, 사진0장, 가격이상치, 전용면적>100m², RPM<0.8(데이터오류), --max-rent 초과
- **데이터정제**: 전용=공급 동일+RPM 비현실 매물 자동 필터링
- **중복제거**: lat/lng 근사(소수점 3자리) + 동일 월세 → 최고점만 유지

## Operation

```bash
# 하네스 파이프라인 (권장 — 수집→정규화→매칭→종료체크→배점 전체 실행)
node scripts/harness_runner.mjs

# 개별 실행
node scripts/check_listing_status.mjs --platform all     # 종료 매물 체크
node scripts/score_listings.mjs                           # AI 배점 → scored_listings 저장
node scripts/score_listings.mjs --interest-rate=0.04      # 이자율 지정 (기본 4%)

# 스킵 옵션
node scripts/harness_runner.mjs --skip-collect    # 수집 스킵
node scripts/harness_runner.mjs --skip-status     # 종료 체크 스킵
node scripts/harness_runner.mjs --skip-score      # 배점 스킵

# 리포트 확인
cat reports/harness-*.json | jq '.overall, .next_actions'
```

### 자동 수집 (launchd)

매일 08:00, 20:00 KST 자동 실행. 확인: `launchctl list | grep rent`

## Git

이 리포는 `lhs-junior` 개인 계정 소유. push 전 credential 확인 필요:

```bash
# 현재 credential 확인
git credential-manager get <<< "host=github.com"

# lhs-junior 계정으로 전환 후 push
git -c credential.helper='!gh auth token --user lhs-junior' push origin main

# 또는 gh CLI로 계정 전환
gh auth switch --user lhs-junior
git push origin main
```

## Key Commands

```bash
npm test                  # Vitest 전체
npm run lint              # ESLint
npm run collect:parallel:db:full  # 기존 전체 수집
npm run db:up             # PostgreSQL Docker
npm run db:migrate        # 마이그레이션
npm run dev:local         # 로컬 개발 스택
```
