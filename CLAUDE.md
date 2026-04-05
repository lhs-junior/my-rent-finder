# my-rent-finder

서울 월세 매물 통합 수집·비교 플랫폼 (개인 사용).

## Architecture

```
Collection (6 platforms) → Normalization (adapters) → DB → Matching → API → Frontend
```

- **수집**: `scripts/{platform}_auto_collector.mjs` — Playwright Stealth 또는 직접 fetch
- **정규화**: `scripts/adapters/{platform}_listings_adapter.mjs` — `base_listing_adapter.mjs` 상속
- **매칭**: `scripts/matcher_v1.mjs` — 가중 점수 (주소 30%, 거리 20%, 면적 25%, 가격 15%, 속성 10%)
- **하네스**: `scripts/harness_runner.mjs` — 파이프라인 실행 + 품질 게이트 + 리포트
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

## Operation

```bash
# 하네스 파이프라인 (권장)
node scripts/harness_runner.mjs

# 기존 파이프라인
node scripts/collect_ops_pipeline.mjs

# 리포트 확인
cat reports/harness-*.json | jq '.overall, .next_actions'
```

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
