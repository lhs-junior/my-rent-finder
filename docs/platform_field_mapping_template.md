# 플랫폼별 필드 추출 패턴 정리 템플릿 (analyze 단계)

## 사용 규칙
- 항목명은 `data-contract.md`의 정규화 필드명과 1:1로 정렬
- 값이 없으면 `N/A`가 아닌 `MISSING`으로 명시
- 추정값은 `ESTIMATED`로 태그, 추정 방식과 근거를 기록

## 대상 플랫폼
- 직방
- 다방
- 네이버 부동산
- 호갱노노
- 부동산114
- 당근 부동산

---

### 1) 직방
- raw selector/field 후보:
  - title: 제목(목록 카드 또는 상세 제목)
  - rent: 월세 값(문자열/숫자 혼재)
  - deposit: 보증금 값(문자열/숫자 혼재)
  - area_exclusive_m2: 전용면적(㎡ or 평)
  - area_gross_m2: 공용면적(㎡ or 평)
  - address_raw: 원문 주소
  - floor / total_floor: 현재층/총층
  - room_count / bathroom_count: 방/욕실 수
  - room_type: 원룸/투룸 등
  - images: 썸네일/상세 이미지 URL 리스트(최대 N)
- 샘플 추출 패턴(상태별):
  - 월세/보증금: `(\d+)\s*만원` , `(\d+)\s*보증금` 동시 추출 후 NaN이면 `PRICE_PARSE_FAIL`
  - 면적: `(\d+(\.\d+)?)\s*㎡` 또는 `(\d+(\.\d+)?)\s*평` 변환(평×3.3058)
  - 전용/공용: 라벨 텍스트에 `전용`/`공용`이 동시에 존재하면 `area_type=range` 후보
  - 주소: `서울특별시|서울시` 표준화 후 `sido/sigungu/dong` 분할
- 수집 모드: `STEALTH_AUTOMATION` (샘플 단계: 브라우저 기반 보조 수집)
- 샘플 목표: 20건
- 샘플 체크 항목:
  - 필수 필드 추출 완료율(필드별)
  - 월세/보증금 텍스트 패턴 10건 이상 분류
  - 면적 단위 혼재(㎡/평/범위) 확인
  - 주소 정규화 성공율
- 문제/노이즈 케이스:
  - 월세가 숫자 대신 텍스트(“협의”, “문의”)로 들어오는 케이스
  - 면적이 `A/B` 또는 `20~25` 형태로 들어오는 케이스
  - 주소 줄바꿈/구/동 비정규 표기
- 전용/공용 면적 혼재 규칙:
  - 전용만 존재: area_claimed=exclusive
  - 공용만 존재: area_claimed=gross
  - 범위형: overlap 처리 후 후보군 보강
  - 1.05~1.35 비율이면 공용/전용 유사 후보 허용

### 2) 다방
- raw selector/field 후보:
  - title: 매물 제목
  - rent: 월세/보증금
  - deposit: 보증금
  - area_exclusive_m2: 전용면적
  - area_gross_m2: 공용면적
  - address_raw: 주소 원문
  - floor / total_floor: 층/총층
  - room_count / bathroom_count: 방/욕실
  - room_type: 실거래/매물유형
  - images: 대표/썸네일 URL
- 샘플 추출 패턴(실전):
  - 월세/보증금 문구: `월세\s*([0-9.,]+)` + `보증금\s*([0-9.,]+)` 분기 파서
  - 면적 문자열: `공급면적|전용면적|전용` 라벨 매핑
  - 주소 텍스트는 `구/동` 누락 시 `ADDRESS_NORMALIZE_FAIL`
  - 같은 매물에서 공용면적만 오는 경우 `area_claimed=gross`
- 수집 모드: `STEALTH_AUTOMATION`(샘플 단계 시작)
- 샘플 목표: 20건
- 샘플 체크 항목:
  - 필수 필드 추출 완료율
  - 이미지 URL 유효성
  - 면적 단위(㎡/평/범위) 정합성
  - 동일 매물 후보군(주소+가격+면적) 테스트 5건
- 문제/노이즈 케이스:
  - 주소/동 표기 누락으로 인한 정규화 실패
  - 이미지가 1장만 제공되거나 링크 만료
  - 가격이 “월세 000 / 보증금 협의”로 분리되지 않는 패턴
- 전용/공용 면적 혼재 규칙:
  - 전용값 우선
  - 공용만 있을 때는 area_claimed=gross로 마킹
  - 공용/전용 비율 1.05~1.35는 후보군 허용
  - 범위 표기면 중앙값+범위 겹침 규칙 동시 적용

### 3) 네이버 부동산
- 수집 모드 제약:
  - `BLOCKED` 우선 확인, 실검 후 `STEALTH_AUTOMATION`로 운영
- raw selector/field 후보:
  - title: 사용자가 붙여넣은 링크 기준 title 텍스트
  - rent: 월세/보증금
  - deposit: 보증금
  - area_exclusive_m2: 전용면적
  - area_gross_m2: 공용면적
  - address_raw: 주소 원문
  - floor / total_floor: 층/총층
  - room_count / bathroom_count: 방/욕실
  - room_type: 매물 유형
  - images: 링크의 이미지 URL
- 수집 모드: `STEALTH_AUTOMATION` 또는 `BLOCKED` 확인 후 경로 분기
- 샘플 목표: 20건(초기)
- 샘플 체크 항목:
  - 링크 파싱 성공률
  - 사용자 입력 URL 오입력율
  - 필수 필드 누락률
  - 계약 위반 코드 발생률
- 문제/노이즈 케이스:
  - 페이지 접근/파싱 실패 빈번
  - 주소·가격 표기 다형성
  - 동적 렌더링 지연으로 미완성 DOM 노출
- 샘플 추출 패턴(예외):
  - 상세 URL 기반에서 제목/가격/주소를 최소값으로 우선 수집하고, 이미지 URL은 `og:image` 또는 미리보기 썸네일 우선 사용
  - 면적이 `range` 형태면 `area_type=range`, `min/max` 저장
  - `월세 0` 또는 `보증금 0`은 문자 "0만"이든 숫자 `0`이든 숫자화

### 4) 호갱노노
- raw selector/field 후보:
  - title:
  - rent:
  - deposit:
  - area_exclusive_m2:
  - area_gross_m2:
  - address_raw:
  - floor / total_floor:
  - room_count / bathroom_count:
  - room_type:
  - images:
- 문제/노이즈 케이스:
  - 

### 5) 부동산114
- raw selector/field 후보:
  - title:
  - rent:
  - deposit:
  - area_exclusive_m2:
  - area_gross_m2:
  - address_raw:
  - floor / total_floor:
  - room_count / bathroom_count:
  - room_type:
  - images:
- 문제/노이즈 케이스:
  - 

### 6) 당근 부동산
- raw selector/field 후보:
  - title:
  - rent:
  - deposit:
  - area_exclusive_m2:
  - area_gross_m2:
  - address_raw:
  - floor / total_floor:
  - room_count / bathroom_count:
  - room_type:
  - images:
- 문제/노이즈 케이스:
  - 

---

## 공통 검증 컬럼(표본 20~50건)
- 추출 성공률(필드별)
- raw 예시값 분포(문자열/숫자/누락)
- 정규화 오류 유형(파싱 실패/단위오류/범위오류)
- 사용자/운영 코멘트(오탐 가능성)
