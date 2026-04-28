# 후속 작업 플랜 — 다방 dedup·features 작업 이후

작업 단위 = 수직 슬라이스 1개 (어댑터 매핑 → 백필 → 테스트 → UI → 검증 → 커밋 → push).
한 PR이 독립적으로 배포 가능한 상태를 유지합니다.

---

## A. 플랫폼별 features 매핑

raw payload의 옵션/시설/관리비 등 풍부한 attribute를 normalized_listings.features JSONB에 통일.
다방과 동일한 키 컨벤션을 사용 (options, safeties, tags, heating, parking, maintenance 등).

- [x] **dabang** — `buildDabangFeatures` (commit 39b3bd3)
- [ ] **naver** — articleAddition.tags / options / parking / heating / approvalDate
- [ ] **zigbang** — item.options, parking, elevator, manage_cost
- [ ] **kbland** — bascInfo의 옵션 코드 → 한글 매핑 (코드표 정리 필요)
- [ ] **daangn** — realty 매물의 옵션·안전시설
- [ ] **serve** — getAtclDetail의 photoList·optionList
- [ ] **peterpanz** — HTML detail 파싱 (제일 어려움 — 마지막)

각 작업은:
1. 어댑터에 `build{Platform}Features()` 추가
2. `tests/{platform}_features.test.mjs` (raw 샘플 → 결과 검증)
3. `scripts/enrich_{platform}_features.mjs` 백필 (raw_listings.payload_json에서 추출, 네트워크 호출 없음)
4. dry-run + apply 검증
5. 회귀 테스트 + lint

---

## B. 플랫폼별 jibun + 정확 좌표

- [x] **dabang** — /api/v5/room/{id}/near (commit 4b3f230)
- [ ] **naver** — articleAddition / articleDetail에 jibun 포함, 좌표 정확
- [ ] **kbland** — bascInfo에 lotNumber + lat/lng
- [ ] **zigbang** — detail 응답에 jibun_address 별도 필드
- [ ] **daangn** — realty 응답 주소 + 좌표
- [ ] **peterpanz** — HTML 파싱 (마지막)

작업 흐름:
1. 어댑터에 jibun 추출 강화
2. dedup 시그니처 검증 (jibun 들어오면 자동 적용됨)
3. 백필 스크립트 (raw_listings에서 추출)

---

## C. UI/UX 강화

- [x] 모달 features 섹션 (commit e534d6d)
- [ ] 카드 features 미리보기 (주요 옵션·태그 chips)
- [ ] features 기반 필터 (사이드바 토글: "주차", "엘리베이터", "풀옵션", "신축")
- [ ] 태그 검색 (features.tags ILIKE)
- [ ] 인기도 정렬 (features.popularity.week_views)
- [ ] 가격 변동 차트 (price_history 활용)

---

## D. AI 배점 정교화

- [ ] features 활용: 옵션 풍부도(0~2점), 주차 가점, 안전시설 가점
- [ ] 인기도 가점 (week_views 분위수)
- [ ] 신선도 점수 (listed_at 기반)
- [ ] 가격 비현실 매물 추가 필터

---

## E. dedup 일반화

- [x] dabang intra-platform jibun dedup
- [ ] naver intra-platform jibun dedup
- [ ] kbland intra-platform jibun dedup
- [ ] cross-platform dedup 강화 (lat4+lng4+rent+deposit + jibun 추가)
- [ ] 부활 매물 자동 복구 (deleted_at → NULL when active 응답)

---

## F. 운영 / 관측성

- [ ] CI 자동화: PR push 시 npm test + lint
- [ ] PR 템플릿: 게이트 체크리스트
- [ ] 일별 수집 리포트 (등급 분포, 신규/종료, 평균 수명)
- [ ] failure 추적 (수집/status 실패 매물 재시도 큐)
- [ ] features GIN 인덱스 (필터 활성화 시)
- [ ] jibun_address 인덱스

---

## G. 알림 / 변화 감지 (장기)

- [ ] 텔레그램/디스코드 봇 (신규 SS등급, 가격 인하)
- [ ] PIN별 조건 매칭 알림
- [ ] 가격 변동 detection job

---

## 작업 진행 규칙

1. **한 PR = 한 vertical slice** — 어댑터/테스트/백필/UI/회귀까지 묶음
2. **PRD 갱신 후 시작** (`.omc/prd.json` user story 모드)
3. **자동 게이트** — npm test, lint, architect 리뷰, deslop, 회귀 재실행
4. **GitHub Actions workflow_dispatch** 로 검증 후 머지
5. **이 문서 체크박스 갱신** — 작업 완료 시 즉시
6. **누락 발견 시** — 이 문서에 추가 후 진행

## 우선순위

1. CI/PR 인프라 (이 작업)
2. naver features (가장 큰 사용자 비중)
3. zigbang/daangn/serve features
4. kbland features (코드표 정리 필요)
5. 카드 features 미리보기
6. 다른 플랫폼 jibun + 백필
7. AI 배점에 features 활용
8. peterpanz features
9. 알림 시스템 (인프라)
