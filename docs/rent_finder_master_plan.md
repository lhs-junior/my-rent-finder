# 서울 원룸/투룸 매물 통합 수집·정리 프로젝트: 마스터 설계안

## 1. 목적
개인 사용자가 서울 주거 매물을 여러 플랫폼에서 반복 탐색하는 비용을 줄이기 위해, 조건(시·구·동, 월세, 평수, 월세유형) 기반으로 매물을 수집·정규화·중복매칭·비교 관리하는 단일 대시보드를 구축한다.

이 프로젝트의 핵심은 **매물 탐색 목적의 실제 사용성**이며, 자동수집은 플랫폼별 허용 범위 내에서만 실행한다.

---

## 2. 프로젝트 범위 (MVP)

### 2.1 필수 입력 조건
- 지역: `시·구·동`
- 월세 조건: 최소/최대 월세
- 최소 전용평수(또는 공용평수 선택 가능)
- 월세 유형(월세 우선, 전세/단기 옵션)

### 2.2 플랫폼 수집 방식 분류
플랫폼별로 하나의 수집 전략만 강제하지 않고, 아래 4종류로 분기한다.

- `API`: 공식/공개 API 허용
- `STEALTH_AUTOMATION`: 브라우저 기반 자동화 동반 동작(우회/보조 수집)
- `BLOCKED`: 현재 접근 제한, 추후 정책 변경 시 재검토

### 2.3 우선 가치(현재)
1. 플랫폼별 수집 적합성 분류 및 실패율 추적
2. 플랫폼별 어댑터 분리 설계
3. 동일 매물 매칭 정확도 향상
4. 이미지 저장량 통제
5. 상세 필드 품질 점검 대시보드
6. 오탐률/누락률 기반 튜닝 루프

---

## 3. 비기능 요구사항
- 데이터 신뢰성 우선: 누락/오류는 숨기지 않고 진단 데이터로 남김
- 비용 제약 준수: 이미지 저장은 선별 저장 + 캐시 + TTL 정책 적용
- 규제/준수: 플랫폼별 수집 정책을 문서화하고 경보 기반으로 차단
- 오토메이션 안정성: 수집 실패시 자동 재시도(백오프) 및 알림
- 확장성: 플랫폼 추가 시 어댑터만 추가하여 기능 확장
- 진실성 제어: 추정치·원문값·추론값을 구분해 저장
- 검색 정합성: 검색 조건과 실제 응답 편차 기록 및 경보

---

## 4. 아키텍처

### 4.1 3-layer 데이터 모델
1) 원시층 (`raw_*`): 수집 원본 보존, 파싱 실패 추적
2) 정규화층 (`normalized_*`): 통합 검색/노출 기준
3) 파생층 (`match_*`, `*_history`, `quality_*`): 중복매칭, 점수, 가격변동, 품질지표

### 4.2 핵심 컴포넌트
- `collector`: 플랫폼 어댑터 실행/스케줄러
- `normalizer`: 플랫폼별 raw를 canonical 스키마로 변환
- `matcher`: 동일매물 점수 기반 군집화
- `image manager`: 기본 대표 이미지 + on-demand 저장
- `quality service`: 필드 완성도, 신뢰도, stale 상태 계산
- `frontend`: 검색/리스트/상세/중복검토/이력/알림 UI
- `contract validator`: 스키마·타입·정책 위반을 구조화
- `lineage store`: 파생 값이 어떤 raw에서 생성되었는지 추적

---

## 5. 플랫폼 수집 정책

### 5.1 수집 정책 원칙
- 플랫폼 정책이 막혀 있거나 불투명하면 무리한 크롤링을 금지
- 정책이 허용되는 플랫폼부터 수집
- 허용 범위 밖 플랫폼은 `BLOCKED` 또는 `STEALTH_AUTOMATION`로 분리하여 운영 지속성 확보

### 5.2 진행 원칙(무료 우선)
- 가능하면 공식/공개 경로 우선
- 사용자 동반 수집일 때는 동작 모방(페이지열기, 검색어 입력, 정렬/스크롤) 범위로 최소화
- 실패/차단 발생 시 즉시 중단하고 사용자/운영자에게 원인 명시

### 5.3 운영 규칙(허용성 기반)
- 플랫폼 모드는 `BLOCKED` 또는 `STEALTH_AUTOMATION`에서 시작하고, 실제 검증 후 단계적으로 조정
- 최근 24h/1주 실패율이 임계 초과 시 해당 플랫폼을 강등 조치
- 플랫폼별 실패코드는 `collection_runs`에 저장해 추적성 보장

---

## 6. 동일 매물 매칭 정밀 설계

### 6.1 왜 어려운가
동일 매물이 플랫폼마다 전용면적/공용면적 분기, 가격 표기 차이, 반올림 처리 차이로 다르게 보일 수 있음.

### 6.2 정규화 규칙
- 면적: 전용면적/공용면적을 별도 컬럼으로 보유, 공용값만 있는 경우 `area_claimed=GROSS` 마킹
- 주소: 도로명/지번/동 정보 정규화 + 행정동 코드 매핑
- 가격: 월세·보증금 분리 후 숫자 정규화, 빈칸 처리시 `null` 유지(임의 채우기 금지)

### 6.3 매칭 점수(권장 가중치)
`score = 0.30*주소 + 0.20*좌표거리 + 0.25*면적 + 0.15*가격 + 0.10*키워드/속성 일치`
- 주소 유사도: 1급(동일 동) 40, 2급(인접표기 정규화) 20
- 좌표거리: 20m 이내 고득점, 20~80m 감점 구간
- 면적 규칙
  - 둘 다 전용면적: 상대 오차 6% 이내 가산
  - 하나 공용/하나는 전용: 공용/전용 비율이 `1.05~1.35`면 면적 후보군 통과
  - 범위 표기(예: 20~22평)는 overlap 처리
- 가격 규칙
  - 월세 오차 5~8%, 보증금 8~12% 이내 가산

### 6.4 판별 단계
- `>= 93`: 자동 동일매물 후보군(자동 병합 허용)
- `80 ~ 93`: 인간 검토 필요(`REVIEW_REQUIRED`)
- `< 80`: 별도 매물로 유지

### 6.5 매칭 상태
- `AUTO_MATCH`, `REVIEW_REQUIRED`, `DISTINCT`
- 자동 병합은 raw 삭제 없이 그룹 참조만 유지해 추적 가능

### 6.6 오탐 방지 추가 규칙
- 같은 플랫폼 동일 `external_id`는 동일 매물 후보 강제
- 같은 건물/동/호수/층 조합은 면적/가격 오차 완화
- 같은 중개사명/연락처 + 유사 주소 + 가격군이면 가산(단, 오탐 위험이면 하향)
- `AUTO_MATCH`는 동일 플랫폼/동일 중개사 집약 건물에서 추가 상한 제약 적용

---

## 7. 이미지 저장 전략

### 7.1 저장 원칙
- 전체 이미지를 무조건 저장하지 않음
- 기본: 대표 1 + 썸네일 1 저장(eager)
- 상세 열람/찜/비교에서만 추가 이미지 지연 수집

### 7.2 중복/용량 제어
- image url hash + perceptual hash 기반 중복 제거
- 동일 매물군 내 상위 N개만 보관 + 참조 카운트
- 오래된/열람되지 않은 이미지는 TTL 만료 후 purge
- 초기에 로컬 우선, 운영 커짐 시 오브젝트 스토리지 이전

### 7.3 조회 정책
- 목록: 썸네일만 노출
- 상세: 중간/원본은 사용행동 기반 로드

---

## 8. DB 스키마(요약)

## 핵심 테이블
- `platforms(platform_id, name, home_url, collection_mode, last_policy_check_at, note)`
- `collection_runs(run_id, platform_id, mode, started_at, finished_at, status, conditions_json)`
- `raw_listings(raw_id, platform_id, external_id, source_url, payload_json, raw_html_ref, fetched_at, etag, status, parse_error_code, raw_area_unit, raw_price_unit, raw_room_type)`
- `normalized_listings(listing_id, raw_id, canonical_uid, title, address, address_code, lat, lng, lease_type, deposit_amount, rent_amount, exclusive_area_m2, gross_area_m2, room_count, floor, total_floor, move_in_date, available_at, area_claimed, estimation_flag, raw_flags)`
- `listing_attrs(listing_id, key, value_json, source_key, confidence, observed_at)`
- `listing_images(image_id, listing_id, source_url, local_path, status, width, height, sha256, phash, is_primary, file_size, downloaded_at)`
- `match_groups(group_id, canonical_title, status, created_at)`
- `match_candidates(id, group_id, listing_id, score, reason_json)`
- `match_group_members(group_id, listing_id, is_master, joined_at)`
- `listing_price_history(id, listing_id, deposit_amount, rent_amount, observed_at)`
- `quality_reports(id, listing_id, completeness_score, image_ok_rate, stale_score, hallucination_risk, risk_flags)`
- `contract_violations(id, scope, listing_id, violation_code, details_json, detected_at)`
- `matcher_runs(id, run_at, input_snapshot, algorithm_version, reviewed_count, auto_match_count, review_required_count, threshold_snapshot)`
- `image_fetch_jobs(id, listing_id, reason, status, requested_at, fetched_at, failure_reason)`
- `audit_logs(id, scope, target_id, level, message, payload_json, created_at)`

> `normalized_listings`는 검색/필터/정렬 기반으로 사용하고, 플랫폼 고유 필드는 `listing_attrs`로 보존한다.
> `contract_violations`는 추정/원문 혼동을 막고 UI 신뢰도 경고의 근거로 사용한다.

---

## 9. 수집-정상화-검증 파이프라인(상태 머신)

`SCHEDULED -> RUNNING -> FETCHING -> PARSING -> NORMALIZING -> MATCHING -> VALIDATING -> STORED -> COMPLETED`

실패 상태:
- `FETCH_FAILED`, `PARSE_FAILED`, `NORMALIZE_FAILED`, `MATCH_INCONCLUSIVE`, `STORED_PARTIAL`, `CONTRACT_FAIL`

실패 시 공통 규칙:
- 원인 코드 저장
- 다음 실행에서 재시도 횟수 증가(지수 백오프)
- 실패율 급증시 플랫폼 모드 강등(`API -> STEALTH_AUTOMATION`)
- 계약 위반 데이터는 표시만 허용하고 자동 점수 계산에서 제외

---

## 10. 사용자 경험(프론트)

### 10.1 필수 화면
1. 통합 검색 화면(시·구·동, 월세, 평수 필터)
2. 매물 리스트(가격/거리/신뢰도/이미지 유무 정렬)
3. 매물 상세(원본 노출, 정규화 정보, 매칭군 표시)
4. 중복 검토 화면(`REVIEW_REQUIRED` 큐)
5. 품질/수집 상태 모니터 패널

### 10.2 고급 필터
- 가격대, 전용/공용 면적 기준 범위
- 매칭 상태, 중개사, 업데이트 시점, 이미지 개수
- 플랫폼별 표시/비표시

### 10.3 사용자 참여형 보조
- 링크 직접 등록(사용자 입력)
- 잘못된 매물 신고/가격변경 신고
- 원하는 매물 알림 조건 저장
- 오탐 의심 매물 플래그 등록

---

## 11. 하위 작업(추천 실행 순서)

1) `데이터 계약 문서` 확정
- 플랫폼별 최소 스키마, 필수/선택 항목, 에러코드 정의
- 출력: `data-contract.md`

2) `플랫폼 어댑터 인터페이스` 정의
- `API`, `STEALTH_AUTOMATION`, `BLOCKED` adapter contract 분기

3) `DB 스키마 v1` 구현
- 핵심 테이블 + 인덱스 + 마이그레이션 문서

4) `면적 매칭 모듈` 구현 + 단위 테스트 시나리오
- 전용/공용 비율 규칙 + 점수 임계값

5) `이미지 정책 엔진` 구현
- 대표/지연 수집/TTL/중복 제거 정책

6) `프론트 기본 화면` + 품질 대시보드

7) `수집 정책/실패 모니터링` 대시보드

8) 소규모 파일럿(시·구·동 1개, 월세 1개 조건)
- 실패/누락 지표 확인 후 플랫폼 모드 조정

9) 실패·오탐·계약위반 지표 리뷰
- 첫 번째 임계값 튜닝

---

## 12. 추천 스킬(이후 하위 작업)

- 상위 기획/요구사항 정합성: `plan`
- 합의형 기획 승인 루프(권장): `ralplan`
- 플랫폼별 필드 추출 규칙 설계: `analyze`
- 구현 착수 및 병렬화: `ultrawork` 또는 `autopilot`
- 프론트 설계: `frontend-ui-ux`
- 최종 검토: `code-review`

---

## 13. 남은 의사결정 항목
- 플랫폼 1차 대상 목록(예: 직방, 다방, 네이버 부동산 등)은 실제 접근 테스트 후 모드 확정
- 저장소 기본 위치(로컬 vs 오브젝트 스토리지) 결정
- 중복 매칭 임계치 조정 실험 기준값(자동/검토 경계선)
- 초기 이미지 예산(하루 저장 개수/용량) 상한치 결정

## 14. 문서 검토 메모(릴리즈 0.1 기준)
- 본 문서는 수집 자동화와 수동/사용자 동반 수집의 하이브리드 설계를 모두 반영
- 초기 동작 범위는 필수 검색조건 수집으로 제한해 비용과 노이즈를 통제
- 정합성 실패 우선순위: `수집 실패 > 매칭 오탐 > 이미지 결함`
