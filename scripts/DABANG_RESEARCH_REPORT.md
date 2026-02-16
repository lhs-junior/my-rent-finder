# 다방(Dabang) 데이터 수집 연구 보고서

이 문서는 다방 API 수집 시도 중 발생한 기술적 문제와 최종 해결 전략을 기록합니다.

## 1. 시도된 전략 및 결과 요약

| 전략                      | 설명                                         | 결과         | 주요 실패/성공 원인                                                       |
| :------------------------ | :------------------------------------------- | :----------- | :------------------------------------------------------------------------ |
| **Pure API Fetch**        | `fetch`를 이용해 직접 API(`/bbox`) 호출      | ❌ 실패      | 403 Forbidden, 401 Unauthorized (TLS 핑거프린팅)                          |
| **API Sniffer**           | 브라우저 요청 가로채기 후 헤더/파라미터 복제 | ⚠️ 부분 성공 | 동일 파라미터로 호출해도 결과가 0건 (Fingerprinting)                      |
| **Category API**          | 지역 필터 없이 카테고리별 전체 조회          | ❌ 실패      | 403 Forbidden (보안 강화)                                                 |
| **Mobile API 서브도메인** | `api.dabangapp.com` 직접 접근 시도           | ❌ 실패      | 502 Bad Gateway (App 전용 시그니처 필요)                                  |
| **Playwright 자동화**     | 브라우저를 띄워 필터 조작 후 리스트 파싱     | ❌ 실패      | 헤드리스 탐지 및 잦은 타임아웃                                            |
| **Playwright stealth + page.route()** | stealth 플러그인 + 필터 인젝션  | ✅ **성공**  | SPA가 만드는 API 요청에 필터 주입 + 응답 캡처                             |

## 2. 주요 기술적 장애물 (해결됨)

### 2.1. 강력한 Bot 탐지 및 Fingerprinting

Dabang은 TLS 지문, HTTP/2 우선순위, 브라우저 환경 변수 등을 종합적으로 검사합니다. Node.js `fetch`는 차단되지만, **playwright-extra의 stealth 플러그인**을 사용하면 실제 브라우저 세션을 유지하면서 봇 탐지를 우회할 수 있습니다.

### 2.2. SPA가 URL 파라미터를 API 필터에 반영하지 않는 문제

다방 SPA는 URL의 `pyeongRangeMin=12` 등의 파라미터를 내부 `/bbox` API 호출의 `filters` JSON에 반영하지 않습니다. **`page.route()`로 나가는 API 요청을 가로채서 `pyeongRange`, `depositRange`, `priceRange`를 직접 주입**하여 해결했습니다.

### 2.3. Detail API 403

개별 매물 상세 API (`/api/v5/room/{id}`)는 `page.evaluate(fetch)`로도 403을 반환합니다. 하지만 **리스트 API 응답의 `roomList` 데이터만으로 충분한 정보**(가격, 면적, 동, 이미지, 매물유형)를 확보할 수 있어 detail fetch 없이 수집 가능합니다.

## 3. 최종 해결 전략

### 핵심 구조
```
Playwright stealth → 다방 지도 페이지 네비게이션
    → page.route(): /bbox API 요청에 필터 주입
    → response 이벤트: /bbox 응답에서 roomList 캡처
    → 2개 카테고리 순회: onetwo(원/투룸) + house(주택/빌라)
    → 조건 필터링 + JSONL 저장
```

### API 엔드포인트
- **리스트**: `GET /api/v5/room-list/category/{onetwo|house}/bbox?filters=...&bbox=...&zoom=14&useMap=naver&page=1`
- **응답**: `result.roomList` (24건/페이지), `result.total`, `result.hasMore`

### 주입하는 필터
```json
{
  "depositRange": { "min": 0, "max": 6000 },
  "priceRange": { "min": 0, "max": 80 },
  "pyeongRange": { "min": 12, "max": 999999 }
}
```

### 수집 결과 (노원구 테스트)
- onetwo: 23건 캡처 (API total: 52)
- house: 23건 캡처 (API total: 42)
- 필터 후: 20건 통과 → 5건 (cap)
- requiredFields: **100%**, imageUrlRate: **100%**
- 소요 시간: **16초**

## 4. CLI 사용법

```bash
# 기본 실행
node scripts/dabang_auto_collector.mjs --sigungu 노원구 --sample-cap 10

# 전체 옵션
node scripts/dabang_auto_collector.mjs \
  --sigungu 노원구 \
  --sample-cap 20 \
  --rent-max 80 \
  --deposit-max 6000 \
  --min-area 40 \
  --verbose \
  --headed \        # 브라우저 UI 표시
  --no-detail       # 상세 API 호출 생략 (권장)
```

---

_최초 보고일: 2026-02-16 (Antigravity AI)_
_해결일: 2026-02-16 (Claude Code)_
