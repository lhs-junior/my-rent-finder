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
- **배점**: `scripts/score_and_pin_favorites.mjs` — 가중 점수(회사거리+지하철+면적+연식+층수+사진) → SS/S/A 등급 → pin_favorites 저장
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

## Scoring (배점 기준)

최대 15점: 회사거리(0~4) + 지하철(0~2) + 면적(0~3) + 연식(0~3) + 층수(0~2) + 사진(0~1)

- **회사**: 헤이그라운드 서울숲점 (37.5451, 127.0443)
- **등급**: SS=10점↑, S=8~9점, A=6~7점
- **탈락**: 반지하/지하(floor≤0), 저층("저/N"), 옥탑방, 1룸/원룸(room_count≤1), 사진0장, 가격이상치
- **중복제거**: lat/lng 근사(소수점 3자리) + 동일 월세 → 최고점만 유지

## Operation

```bash
# 하네스 파이프라인 (권장 — 수집→정규화→매칭→종료체크→배점 전체 실행)
node scripts/harness_runner.mjs

# 개별 실행
node scripts/check_listing_status.mjs --platform all     # 종료 매물 체크
node scripts/score_and_pin_favorites.mjs --pin=1004 \     # 배점 + 찜 저장
  --threshold-ss=10 --threshold-s=8 --threshold-a=6

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
