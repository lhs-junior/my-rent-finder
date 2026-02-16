# 직방 (Zigbang) 데이터 수집 성공 리포트

## 요약

- **성공 전략**: `directApi` (Strategy 1) - 브라우저 없이 Node.js fetch로 직접 API 호출
- **수집 소요 시간**: ~2.5초 (브라우저 기동 불필요)
- **테스트 대상**: 서울시 노원구, 월세 ≤80만원, 보증금 ≤6000만원, 면적 ≥40㎡
- **수집 결과**: v2 API에서 280개 매물 ID → 상세 15건 → 조건 필터 후 14건 → 5건 캡

---

## 전략별 결과

| # | 전략 | 시도 | 성공 | 비고 |
|---|------|------|------|------|
| 1 | **Direct API** | O | **성공** | 2.5초, 브라우저 불필요 |
| 2 | Network Intercept | X (불필요) | - | Strategy 1 성공으로 미시도 |
| 3 | Browser API | X (불필요) | - | Strategy 1 성공으로 미시도 |
| 4 | DOM Parse | X (불필요) | - | Strategy 1 성공으로 미시도 |

---

## 성공 전략 상세: Direct API

### 플로우

```
1. 구별 중심좌표 → geohash(precision=5) 인코딩
   예: 노원구 (37.6542, 127.0568) → "wydq5"

2. v2 API로 3가지 매물 유형 동시 조회:
   - /v2/items/oneroom?geohash=wydq5&...  → 246건
   - /v2/items/villa?geohash=wydq5&...    →  23건
   - /v2/items/officetel?geohash=wydq5&...→  11건
   합계: 280 item IDs

3. 상세 API 호출 (POST):
   POST /house/property/v1/items/list
   Body: { "domain": "zigbang", "item_ids": [...] }
   → 15건 상세 정보 반환

4. 조건 필터 적용:
   - 월세 ≤ 80만원
   - 보증금 ≤ 6000만원
   - 면적 ≥ 40㎡
   - 바운딩 박스 위치 검증 (구 경계 + 0.005도 패딩)
   → 14건 통과 (1건 위치 필터에서 제외)

5. sampleCap 적용: 14건 → 5건 (캡)
```

### API 엔드포인트

#### v2 매물 목록 (GET)

```
GET https://apis.zigbang.com/v2/items/{propertyType}?geohash={hash}&depositMin=0&depositMax={원}&rentMin=0&rentMax={원}&salesTypes[0]=월세&domain=zigbang&checkAnyItemWith498=true
```

- `{propertyType}`: `oneroom`, `villa`, `officetel`
- 응답: `{ items: [{ itemId: 12345, ... }, ...] }`
- 필드명: **`itemId`** (camelCase) - `item_id` 아님

#### 상세 정보 (POST)

```
POST https://apis.zigbang.com/house/property/v1/items/list
Content-Type: application/json
Body: { "domain": "zigbang", "item_ids": [12345, 12346, ...] }
```

- 응답: `{ items: [{ item_id: 12345, sales_type: "월세", deposit: 500, rent: 45, ... }, ...] }`
- 한 번에 최대 ~20개 ID 권장 (더 많으면 분할 호출)

### 핵심 필드 매핑

| 직방 원본 필드 | 설명 | 단위 |
|---------------|------|------|
| `sales_type` | 거래유형 ("월세") | - |
| `deposit` | 보증금 | 만원 |
| `rent` | 월세 | 만원 |
| `size_m2` | 전용면적 | ㎡ |
| `floor` / `floor_string` | 층수 | - |
| `building_floor` | 건물 총 층수 | - |
| `address` | 약식 주소 ("노원구 월계동") | - |
| `addressOrigin.fullText` | 상세 주소 ("서울시 노원구 월계동") | - |
| `random_location.lat/lng` | 위치 좌표 (약간 랜덤화됨) | WGS84 |
| `images_thumbnail` | 썸네일 이미지 URL | - |
| `manage_cost` | 관리비 | 원 |
| `reg_date` | 등록일시 | ISO 8601 |
| `service_type` | 매물 유형 ("원룸", "빌라" 등) | - |

### 주의사항

1. **v2 API의 `itemId` vs 상세 API의 `item_id`**: v2 목록은 camelCase(`itemId`), 상세는 snake_case(`item_id`)
2. **좌표 랜덤화**: `random_location`은 실제 위치에서 약간 오프셋. 바운딩 박스 필터 시 0.005도(~500m) 패딩 필요
3. **금액 단위**: v2 API 필터 파라미터는 **원** 단위 (`rentMax=800000`), 응답의 `deposit`/`rent`는 **만원** 단위
4. **인증 불필요**: 공개 API로 별도 인증 토큰 없이 접근 가능. User-Agent + Referer 헤더만 설정
5. **v3 API 사용 금지**: `/v3/items` 엔드포인트는 404 반환. `/house/property/v1/items/list` 사용

---

## 수집 데이터 샘플

```json
{
  "platform_code": "zigbang",
  "collected_at": "2026-02-16T05:03:32.222Z",
  "source_url": "https://www.zigbang.com/home/oneroom/map?lat=37.6542&lng=127.0568&zoom=15",
  "request_url": "https://apis.zigbang.com/v2/items/oneroom?geohash=wydq5",
  "response_status": 200,
  "payload_json": {
    "item_id": 47720392,
    "sales_type": "월세",
    "deposit": 500,
    "rent": 45,
    "size_m2": 16.53,
    "floor": "1",
    "building_floor": "3",
    "title": "O샾O. 석계역 2분 풀옵션 원룸 월세 즉시입주",
    "service_type": "원룸",
    "address": "노원구 월계동",
    "addressOrigin": {
      "local1": "서울시",
      "local2": "노원구",
      "local3": "월계동",
      "fullText": "서울시 노원구 월계동"
    },
    "random_location": {
      "lat": 37.6173111141508,
      "lng": 127.063795288904
    },
    "manage_cost": "70000",
    "reg_date": "2026-01-22T14:45:48+09:00",
    "images_thumbnail": "https://ic.zigbang.com/ic/items/47720392/1.jpg"
  }
}
```

---

## 품질 메트릭

| 지표 | 값 |
|------|-----|
| 총 수집 매물 수 | 5 (sampleCap) |
| 주소 추출률 | 100% |
| 가격 정보 | 100% (보증금 + 월세) |
| 면적 정보 | 100% |
| 이미지 URL | 100% (썸네일) |
| 위치 좌표 | 100% |
| 관리비 정보 | 100% |
| 등록일시 | 100% |
| 품질 등급 | PARTIAL → GOOD (상세 API 포함 시) |

---

## 구별 좌표 & 지오해시 매핑

| 구 | 위도 | 경도 | Geohash(5) |
|----|------|------|------------|
| 노원구 | 37.6542 | 127.0568 | wydq5 |
| 중랑구 | 37.6066 | 127.0927 | wydq4 |
| 동대문구 | 37.5744 | 127.0394 | wydm6 |
| 광진구 | 37.5384 | 127.0822 | wydmf |
| 성북구 | 37.5894 | 127.0167 | wydm9 |
| 성동구 | 37.5633 | 127.0371 | wydm3 |
| 중구 | 37.5641 | 126.9979 | wydm2 |
| 종로구 | 37.5735 | 126.9790 | wydm8 |

---

## CLI 사용법

```bash
# 기본 실행 (노원구)
node scripts/zigbang_auto_collector.mjs --sigungu 노원구 --sample-cap 5 --verbose

# 다른 구 + 필터 조정
node scripts/zigbang_auto_collector.mjs \
  --sigungu 중랑구 \
  --sample-cap 20 \
  --rent-max 80 \
  --deposit-max 6000 \
  --min-area 40 \
  --verbose

# headless 모드 비활성화 (디버깅 시)
node scripts/zigbang_auto_collector.mjs --sigungu 노원구 --sample-cap 5 --headed --verbose
```

---

## 향후 유지보수 참고

1. **API 변경 모니터링**: 직방은 API 버전을 자주 변경함. v2 엔드포인트가 중단되면 Network Intercept(Strategy 2)로 자동 폴백
2. **Rate Limiting**: 현재 관찰되지 않으나, 대량 수집 시 요청 간 딜레이 추가 권장 (1~2초)
3. **Property Type 확장**: 현재 oneroom/villa/officetel 3종. 필요 시 `apt`, `commercial` 등 추가 가능
4. **Geohash Precision**: precision=5는 ~5km 반경. 더 좁은 영역이면 6으로 올리되, 매물 수가 줄어들 수 있음
