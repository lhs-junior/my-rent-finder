<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-16 | Updated: 2026-02-16 -->

# adapters

## Purpose
플랫폼별 raw 수집 데이터를 통합 정규화 스키마(normalized listing)로 변환하는 Listing Adapter 시스템. 상속 기반 아키텍처로 공통 로직은 base에, 플랫폼 고유 파싱 로직은 하위 클래스에 분리한다.

## Architecture

### 클래스 계층 구조
```
BaseListingAdapter (base_listing_adapter.mjs)
├── NaverListingAdapter (naver_listings_adapter.mjs)     ← 네이버 전용, 직접 상속
├── BaseUserOnlyAdapter (user_only_listing_adapter.mjs)  ← 범용 hint 기반 adapter
│   ├── ZigbangListingAdapter (zigbang_listings_adapter.mjs)
│   ├── DabangListingAdapter (dabang_listings_adapter.mjs)
│   └── R114ListingAdapter (r114_listings_adapter.mjs)
└── StubListingAdapter (stub_listing_adapter.mjs)        ← BLOCKED 플랫폼용 빈 구현
```

### 두 가지 어댑터 전략

1. **NaverListingAdapter** (전용 어댑터)
   - 네이버 부동산의 복잡한 API 응답 구조에 특화
   - `collectCandidates()`: 중첩 JSON에서 매물 후보를 재귀 탐색 (articleList, complexList 등)
   - `scoreListingCandidate()`: 매물 후보 품질 점수 계산 (이미지 유무, 가격, 면적 등)
   - `collectImageUrls()`: 이미지 URL 수집 (네이버 CDN 경로 정규화 포함)
   - `isAccessBlocked()`: 차단/로그인 요구 응답 감지

2. **BaseUserOnlyAdapter** (범용 hint 기반 어댑터)
   - `fieldHints` 설정으로 플랫폼별 필드명 매핑만 변경하면 동작
   - 직방, 다방, 부동산114가 이 방식 사용
   - `DEFAULT_FIELD_HINTS`: 200+ 한/영 필드명 후보 (address, 주소, addr 등)
   - `collectCandidates()`: hint의 `listHintPaths`를 따라 재귀 탐색

## Key Files

| File | Description |
|------|-------------|
| `base_listing_adapter.mjs` | **핵심 기반 클래스.** JSONL 스트림 읽기, 정규화 파이프라인 실행, 필수 필드 검증, 이미지 URL 검증, 통계(requiredFieldsRate, imageRate 등) 계산. 모든 어댑터가 상속 |
| `naver_listings_adapter.mjs` | **네이버 부동산 전용 어댑터.** 929줄의 가장 복잡한 구현. 한국어 가격 파싱(억/천만/만원), 면적 변환(평→m²), 층수 파싱, 임대유형 분류, 네이버 CDN 이미지 URL 정규화 |
| `user_only_listing_adapter.mjs` | **범용 hint 기반 어댑터.** fieldHints 설정만으로 다양한 플랫폼 raw 구조를 파싱. hash11 기반 중복 제거, 가격쌍 파싱(보증금/월세), 차단 감지 |
| `zigbang_listings_adapter.mjs` | 직방 어댑터. BaseUserOnlyAdapter 상속, 직방 고유 필드명 hint만 정의 |
| `dabang_listings_adapter.mjs` | 다방 어댑터. BaseUserOnlyAdapter 상속, 다방 고유 필드명 hint만 정의 |
| `r114_listings_adapter.mjs` | 부동산114 어댑터. BaseUserOnlyAdapter 상속, 부동산114 고유 필드명 hint만 정의 |
| `stub_listing_adapter.mjs` | BLOCKED 플랫폼용 빈 어댑터. normalizeFromRawRecord()이 항상 빈 배열 반환 |
| `adapter_registry.mjs` | 어댑터 레지스트리. platformCode → adapterFactory 매핑, getAdapter()/listAdapters() export |

## For AI Agents

### Working In This Directory
- 새 플랫폼 추가 시: `BaseUserOnlyAdapter`를 상속하고 `fieldHints`만 정의하면 됨 (zigbang 참고)
- 네이버처럼 복잡한 구조면: `BaseListingAdapter`를 직접 상속하고 `normalizeFromRawRecord()` 구현
- 새 어댑터 생성 후 반드시 `adapter_registry.mjs`의 `ADAPTER_REGISTRY`에 등록

### Normalized Output Schema (공통)
모든 어댑터는 다음 필드를 출력해야 한다:
```javascript
{
  platform_code: string,      // "naver", "zigbang", "dabang", "r114"
  collected_at: ISO8601,
  source_url: string,
  source_ref: string,          // 플랫폼 고유 매물 ID
  external_id: string,
  address_text: string | null, // 정규화된 주소
  address_code: string | null, // FNV-1a 11자리 해시
  lease_type: "월세" | "전세" | "매매" | "기타",
  rent_amount: number | null,  // 만원 단위
  deposit_amount: number | null,
  area_exclusive_m2: number | null,
  area_gross_m2: number | null,
  area_claimed: "exclusive" | "gross" | "range" | "estimated",
  room_count: number | null,
  floor: number | null,
  total_floor: number | null,
  image_urls: string[],
  validation: Array<{ level, code, message, detail }>,
}
```

### Validation Codes
- `RECORD_PARSE_FAIL`: JSONL 라인 파싱 실패
- `NORMALIZE_EXCEPTION`: normalizeFromRawRecord 예외
- `REQ_FIELD_MISSING`: 필수 필드 누락
- `ADDRESS_NORMALIZE_FAIL`: 주소 정규화 실패
- `PRICE_PARSE_FAIL`: 가격 파싱 실패
- `AREA_PARSE_FAIL`: 면적 파싱 실패
- `IMAGE_URL_INVALID`: 이미지 URL 형식 불일치
- `SOURCE_ACCESS_BLOCKED`: 차단/로그인 요구 감지

### Testing Requirements
- 어댑터 테스트: `node scripts/run_listing_adapters.mjs --platform=<code> --input=<raw.jsonl>`
- `parallel_collect_runs/` 하위에 실제 수집 raw 데이터가 있으므로 통합 테스트 데이터로 활용
- 핵심 검증 지표: `stats.requiredFieldsRate` (목표 ≥0.85), `stats.imageRate` (목표 ≥0.9)

### Common Patterns
- `pick(obj, keyList)`: 여러 가능한 필드명에서 첫 번째 유효값 추출 (한/영 혼용 대응)
- `parseMoney(value)`: 한국어 가격 문자열 → 만원 단위 숫자 ("1억 5000만원" → 15000)
- `parseArea(value)`: 면적 문자열 → m² ("12평" → 39.67, "33.5m²" → 33.5)
- `hash11(text)`: FNV-1a 해시로 11자리 주소 코드 생성
- `collectCandidates(payload)`: 중첩 JSON에서 매물 후보 객체 재귀 탐색
- `isAccessBlocked(payload)`: 차단/로그인/권한 부족 응답 자동 감지

## Dependencies

### Internal
- 서로 간 의존: base → naver/user_only → zigbang/dabang/r114
- `adapter_registry.mjs`가 모든 구현체를 import

### External
- `node:fs`, `node:readline` (표준 라이브러리만)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
