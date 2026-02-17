# 직방 수집 정합성 보정 및 전체 재수집 검증 보고서 (`manual_fixcheck_20260217b`)

## 1) 이슈 요약

- 사용자가 제공한 공유 URL 패턴은 `https://sp.zigbang.com/share/oneroom/<id>?...`였음.
- 기존에는 직방 정규화 시 `external_id`가 추출되지 않아 소스 링크가 지도 URL 또는 해시 기반 값으로 들어가고,
  상세 링크 이동, 주소/면적/이미지 표시에서 누락이 발생했음.

## 2) 수정 사항

수정 파일: `scripts/lib/ops_db_persistence.mjs`

- `extractExternalIdCandidates()`에서 직방 raw 필드 대응을 보강
  - 기존 후보: `id`, `item.id`, `listingId`, `idFromSource` 등
  - 추가: `item_id`, `itemId`
- 결과적으로 직방 상세 항목의 고유 ID(`item_id`)를 안정적으로 추출할 수 있게 됨
- `source_url`/`source_ref` 정합성이 `sp.zigbang.com/share/...` 형태로 일치

## 3) 재수집 실행

```
node scripts/run_ops_pipeline.mjs \
  --platforms=zigbang,dabang,naver,peterpanz,daangn \
  --sample-cap=20 \
  --skip-probe \
  --targets=scripts/platform_sampling_targets.json \
  --conditions=scripts/platform_search_conditions.json \
  --run-id=manual_fixcheck_20260217b \
  --skip-seed \
  --seed
```

- 실행 결과: `scripts/parallel_collect_runs/manual_fixcheck_20260217b/parallel_collect_summary_manual_fixcheck_20260217b.json`
- 대시보드 페이로드: `docs/rent_finder_operations_dashboard_payload.json`

## 4) 정합성 검증 결과 (요약)

### 전체 파이프라인 (5개 플랫폼)

- `jobs`: 40 / 성공: 40 / 실패: 0
- `raw_count`: 1183
- `normalized_count`: 210
- `required_quality_rate`: 0.780952380952381

| platform | raw_count | normalized_count |
|---|---:|---:|
| `zigbang` | 134 | 42 |
| `dabang` | 270 | 48 |
| `naver` | 505 | 40 |
| `peterpanz` | 58 | 38 |
| `daangn` | 216 | 42 |

### 매칭

- `scripts/parallel_collect_runs/manual_fixcheck_20260217b/match_result_manual_fixcheck_20260217b.json`
  - 입력 정규화 건수: 210
  - 후보 쌍 수: 0
  - AUTO_MATCH: 0
  - REVIEW_REQUIRED: 0
  - DISTINCT: 0
  - 그룹 수: 0

### 직방(zigbang) 세부 정합성

- `source_url`: `share` 패턴 42건, `map` 패턴 0건
- `address_text`: 42건
- `area_exclusive_m2 > 0`: 42건
- `floor` 값 존재: 36건
- `image_urls`: 42건
- `external_id` 해시 폴백(예: `11xxxxxxxxx`) 미발생

샘플 레코드(첫 번째):

```json
{
  "platform_code": "zigbang",
  "source_url": "https://sp.zigbang.com/share/oneroom/47943108?userNo=undefined&stamp=1771293738380",
  "external_id": "47943108",
  "address_text": "성북구 장위동",
  "rent_amount": 65,
  "deposit_amount": 2000,
  "area_exclusive_m2": 46.28,
  "floor": 1,
  "image_urls": ["https://ic.zigbang.com/ic/items/47943108/1.jpg"]
}
```

## 5) 화면 표시 확인 포인트

- API를 통해 표시값을 점검하면 이전보다 링크/이미지/면적이 더 안정적으로 들어가는 것을 확인 가능
  - `GET /api/collection/runs?platform=zigbang&limit=...`
  - `GET /api/listings?run_id=manual_fixcheck_20260217b&platform_code=zigbang`
- 직방 상세 열기 동작은 `source_url`이 공유 URL 패턴이므로 `/api/listings`의 `source_url`을 그대로 사용하면 해당 매물로 이동

## 6) 남은 확인 항목(권장)

- 프론트에서 실제 리스트 렌더링 시 `image_urls`를 참조하는지, `address` 표시가 `address_text`인지 확인
- `floor=0` 및 `null` 케이스는 필드 보정 규칙(예: `floor == -1` 또는 `null` 처리)에 따라 렌더링 가이드 고정
- 다음 재수집 전에는 `extractExternalIdCandidates()`에 `item_id`, `itemId` 케이스가 유지되는지 회귀 테스트
