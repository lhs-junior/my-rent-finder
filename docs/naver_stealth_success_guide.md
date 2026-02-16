# 네이버 부동산 자동 수집을 위한 고정밀 환경 구축 가이드

## 1. 개요 및 배경

네이버 부동산과 같은 고도화된 웹 서비스는 일반적인 자동화 도구(Standard WebDriver)를 사용할 때 브라우저의 일관성 결여(Inconsistency)를 감지하여 접근을 제한할 수 있습니다. 본 문서는 브라우저의 지문(Fingerprint)을 실제 사용자와 동일하게 맞추고, 인간과 유사한 상호작용 환경을 구축하여 안정적으로 데이터를 수집하는 방법을 설명합니다.

## 2. 기술 스택 (High-Fidelity Stack)

안정적인 수집을 위해 표준 자동화 도구에 추가적인 프로파일링 플러그인을 결합합니다.

- **Engine**: `playwright-extra` (표준 Playwright의 확장판)
- **Profile**: `puppeteer-extra-plugin-stealth` (브라우저 일관성 유지 플러그인)
- **Runtime**: Node.js

### 환경 구축 명령어

```bash
# 필요한 패키지 설치
npm install playwright-extra puppeteer-extra-plugin-stealth

# 브라우저 바이너리 설치
npx playwright install chromium
```

## 3. 핵심 구현 전략

### 3.1 브라우저 지문 일관성 유지 (Consistency Plugin)

자동화 도구가 생성하는 특유의 신호(예: `navigator.webdriver`)를 실제 브라우저와 동일하게 수정합니다.

```javascript
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// 고정밀 프로파일 적용
chromium.use(StealthPlugin());

const browser = await chromium.launch({
  headless: false, // 실제 렌더링 확인을 위해 유색 모드 권장
  args: ["--disable-blink-features=AutomationControlled"],
});
```

### 3.2 상호작용 신뢰도 향상 (Human-like Interaction)

단순한 API 호출이 아닌, 실제 사용자의 행동 패턴을 시뮬레이션하여 세션의 신뢰도를 높입니다.

- **비정형 패턴**: 클릭 전후에 랜덤한 대기 시간(300ms~1500ms) 추가.
- **포커스 유도**: 검색어 입력 시 `fill` 대신 실제 키보드 입력과 유사한 `type` 사용 고려.
- **좌표 기반 이동**: 마우스 휠 및 드래그를 통한 맵 스크롤.

### 3.3 네트워크 레이어 데이터 캡처

웹 UI의 변경에 영향을 받지 않도록, 브라우저가 내부적으로 주고받는 JSON 응답을 직접 캡처합니다.

```javascript
page.on("response", async (response) => {
  const url = response.url();
  // 매물 데이터가 포함된 API 엔드포인트 필터링
  if (url.includes("api/articles") && response.status() === 200) {
    const data = await response.json();
    // 데이터 추출 및 저장 로직
  }
});
```

## 4. 실행 가이드 (Quick Start)

본 프로젝트에 구현된 자동 수집기([scripts/naver_auto_collector.mjs](file:///Users/hyunsoo/personal-projects/my-rent-finder/scripts/naver_auto_collector.mjs))를 사용하여 즉시 수집을 시작할 수 있습니다.

```bash
# 노원구 매물 20건 자동 수집 실행
node scripts/naver_auto_collector.mjs --sigungu 노원구 --sample-cap 20 --headed
```

## 5. 단계별 워크플로우

1.  **환경 초기화**: `StealthPlugin`을 로드하여 브라우저의 표준성 확보.
2.  **세션 수립**: `new.land.naver.com` 접속 후 쿠키 및 세션 정보 로드 대기.
3.  **지역 검색**: 검색창을 통한 지역 코드(cortarNo) 매핑 및 맵 이동.
4.  **필터 최적화**: 거래 유형(월세), 가격대, 면적 등 필요한 필터 클릭 적용.
5.  **동적 캡처**: 지도를 이동하며 자동으로 생성되는 네트워크 응답 데이터를 실시간 저장.

## 6. 품질 및 안정성 관리

- **Rate Limit 방지**: 요청 간 최소 2~3초의 랜덤 간격을 두어 서버 부하 최소화.
- **예외 처리**: `try-catch` 블록을 활용하여 브라우저 타임아웃 또는 페이지 구조 변경 시 자동 재시도 및 로깅.
- **리소스 최적화**: 이미지 및 폰트 로딩을 선택적으로 차단하여 수집 성능 향상(옵션).

## 7. 결론 가이드라인

본 가이드는 기술적으로 브라우저 환경을 최적화하여 데이터를 수집하는 방법을 제시합니다. 대규모 수집 시에는 서버의 `robots.txt` 정책과 이용약관을 준수할 것을 권장하며, 수집된 데이터는 개인 연구 및 분석 목적으로 활용하시기 바랍니다.
