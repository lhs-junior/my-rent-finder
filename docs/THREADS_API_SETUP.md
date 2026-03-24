# Threads API 인증 설정 가이드

이 문서는 Meta Threads API를 사용하기 위한 인증 설정 과정을 단계별로 설명합니다.

## 📋 사전 요구사항

### 1. 필수 계정
- ✅ Facebook 계정 (Meta Developer Portal 접근용)
- ✅ Instagram Threads 계정 (비즈니스/크리에이터 계정 권장)

### 2. 계정 검증
Instagram Business/Creator 계정이 필요합니다. 일반 개인 계정은 API 사용이 제한될 수 있습니다.

**검증 방법**:
1. Instagram 앱 열기
2. 설정 → 계정 → 프로페셔널 계정으로 전환
3. 카테고리 선택 (예: 크리에이터, 비즈니스)
4. 필요 서류 제출 (1-2일 소요)

---

## 🔧 Step 1: Meta Developer Portal에서 앱 생성

### 1.1 Developer Portal 접속
```bash
https://developers.facebook.com/apps/creation/
```

### 1.2 새 앱 생성
1. **"앱 만들기"** 클릭
2. **사용 사례 선택**: "Access the Threads API" 선택
3. **앱 이름** 입력: `my-threads-builder` (또는 원하는 이름)
4. **연락처 이메일** 입력: 본인 이메일
5. **앱 만들기** 클릭

### 1.3 앱 ID 및 시크릿 확인
생성 후 대시보드에서:
- **앱 ID** (CLIENT_ID): 복사 → 메모장에 저장
- **앱 시크릿** (CLIENT_SECRET): "표시" 클릭 → 복사 → 메모장에 저장

```
CLIENT_ID=123456789012345
CLIENT_SECRET=abcdef1234567890abcdef1234567890
```

---

## 🔑 Step 2: Threads API 권한 설정

### 2.1 Threads 제품 추가
1. 앱 대시보드 왼쪽 메뉴 → **"제품 추가"** 클릭
2. **"Threads"** 찾기 → **"설정"** 클릭

### 2.2 권한 선택
자동으로 다음 권한이 추가됩니다:
- ✅ `threads_basic` (기본 읽기)
- ✅ `threads_content_publish` (게시 권한)

추가 권한 (선택):
- `threads_manage_insights` (분석 데이터)
- `threads_manage_replies` (답글 관리)

**현재 프로젝트에 필요한 권한**: `threads_basic`, `threads_content_publish`

---

## 👥 Step 3: 테스트 사용자 추가

### 3.1 테스터 역할 추가
1. 앱 대시보드 왼쪽 메뉴 → **"앱 역할"** → **"역할"**
2. **"테스터"** 탭 선택
3. **"사용자 추가"** 클릭
4. **"이 앱의 추가 역할"**에서 **"Threads Tester"** 선택
5. Threads 사용자 이름 입력 (본인 계정)

### 3.2 테스터 승인 (Threads 앱에서)
1. Threads 모바일 앱 열기
2. 설정 → 계정 → 앱 및 웹사이트
3. 테스터 초대 승인

---

## 🔐 Step 4: Redirect URI 설정

### 4.1 Redirect URI 구성
1. 앱 대시보드 → **"Threads"** → **"설정"**
2. **"유효한 OAuth 리디렉션 URI"** 섹션 찾기
3. 다음 URI 추가:

```
https://localhost:3000/callback
```

또는 Postman 사용 시:
```
https://oauth.pstmn.io/v1/callback
```

4. **"변경 사항 저장"** 클릭

### 4.2 메모장에 기록
```
REDIRECT_URI=https://localhost:3000/callback
```

---

## 🎫 Step 5: Authorization Code 받기

### 5.1 인증 URL 생성
다음 URL을 브라우저에 복사 (CLIENT_ID와 REDIRECT_URI를 본인 값으로 교체):

```
https://threads.net/oauth/authorize?client_id=[CLIENT_ID]&redirect_uri=[REDIRECT_URI]&scope=threads_basic,threads_content_publish&response_type=code
```

**예시**:
```
https://threads.net/oauth/authorize?client_id=123456789012345&redirect_uri=https://localhost:3000/callback&scope=threads_basic,threads_content_publish&response_type=code
```

### 5.2 인증 승인
1. 위 URL을 브라우저에 붙여넣기
2. Threads로 로그인 (테스터로 추가한 계정)
3. **"권한 부여"** 클릭

### 5.3 Authorization Code 추출
리디렉션된 URL에서 `code=` 파라미터 복사:

```
https://localhost:3000/callback?code=AQD...xyz#_
```

**`code` 값만 복사**:
```
AUTH_CODE=AQD...xyz
```

⚠️ **주의**: Authorization Code는 1회용이며 10분 후 만료됩니다!

---

## 🔑 Step 6: Short-Lived Access Token 발급

### 6.1 cURL 명령 실행
터미널에서 다음 명령 실행 (본인 값으로 교체):

```bash
curl -X POST https://graph.threads.net/oauth/access_token \
  -F client_id=[CLIENT_ID] \
  -F client_secret=[CLIENT_SECRET] \
  -F grant_type=authorization_code \
  -F redirect_uri=[REDIRECT_URI] \
  -F code=[AUTH_CODE]
```

**예시**:
```bash
curl -X POST https://graph.threads.net/oauth/access_token \
  -F client_id=123456789012345 \
  -F client_secret=abcdef1234567890abcdef1234567890 \
  -F grant_type=authorization_code \
  -F redirect_uri=https://localhost:3000/callback \
  -F code=AQD...xyz
```

### 6.2 응답 확인
```json
{
  "access_token": "IGQW...short-lived-token",
  "token_type": "bearer",
  "expires_in": 3600,
  "user_id": "987654321"
}
```

**메모장에 기록**:
```
SHORT_LIVED_TOKEN=IGQW...short-lived-token
USER_ID=987654321
```

---

## ⏰ Step 7: Long-Lived Access Token 발급 (60일 유효)

### 7.1 토큰 교환 요청
```bash
curl -X GET "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=[CLIENT_SECRET]&access_token=[SHORT_LIVED_TOKEN]"
```

**예시**:
```bash
curl -X GET "https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=abcdef1234567890abcdef1234567890&access_token=IGQW...short-lived-token"
```

### 7.2 응답 확인
```json
{
  "access_token": "IGQW...long-lived-token",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

`expires_in: 5184000` = 60일 (초 단위)

**최종 토큰 저장**:
```
THREADS_ACCESS_TOKEN=IGQW...long-lived-token
```

---

## 📝 Step 8: 환경 변수 설정

### 8.1 프로젝트 `.env` 파일 생성
```bash
cd /Users/hyunsoo/personal-projects/my-rent-finder
touch .env
```

### 8.2 `.env` 파일에 토큰 저장
```bash
# Threads API Credentials
THREADS_ACCESS_TOKEN=IGQW...long-lived-token
THREADS_USER_ID=987654321

# Meta App Credentials (토큰 갱신용)
META_APP_ID=123456789012345
META_APP_SECRET=abcdef1234567890abcdef1234567890
```

### 8.3 `.gitignore`에 추가 (보안!)
```bash
echo ".env" >> .gitignore
```

---

## ✅ Step 9: 토큰 검증

### 9.1 테스트 API 호출
```bash
curl -X GET "https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=[THREADS_ACCESS_TOKEN]"
```

### 9.2 성공 응답 예시
```json
{
  "id": "987654321",
  "username": "your_username",
  "threads_profile_picture_url": "https://..."
}
```

✅ **성공!** Threads API 인증이 완료되었습니다.

---

## 🔄 토큰 갱신 (60일 후)

Long-lived 토큰은 60일 후 만료됩니다. 갱신 방법:

### 갱신 API 호출
```bash
curl -X GET "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=[CURRENT_LONG_LIVED_TOKEN]"
```

**응답**:
```json
{
  "access_token": "IGQW...new-token",
  "token_type": "bearer",
  "expires_in": 5184000
}
```

새 토큰으로 `.env` 파일 업데이트.

---

## 🚨 문제 해결 (Troubleshooting)

### 문제 1: "Invalid OAuth access token"
**원인**: 토큰 만료 또는 잘못된 토큰
**해결**: Step 6-7 재실행하여 새 토큰 발급

### 문제 2: "Redirect URI mismatch"
**원인**: 인증 URL의 `redirect_uri`와 앱 설정이 불일치
**해결**: Step 4에서 설정한 URI와 정확히 일치하는지 확인

### 문제 3: "User is not a tester"
**원인**: 테스터 역할 미승인
**해결**: Step 3에서 Threads 앱에서 초대 승인 확인

### 문제 4: "Invalid code"
**원인**: Authorization Code 만료 (10분 제한)
**해결**: Step 5부터 다시 시작 (빠르게 진행)

---

## 📚 참고 자료

- [Threads API Official Documentation](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Threads API Authentication Guide](https://blogs.bitesinbyte.com/posts/how-to-post-content-on-thread-using-api-part1/)
- [Threads API Integration Tutorial](https://www.ayrshare.com/threads-api-integration-authorization-posting-analytics-with-ayrshare/)
- [Threads API Nevin's Blog](https://blog.nevinpjohn.in/posts/threads-api-public-authentication/)

---

## 🎯 다음 단계

인증 설정 완료 후:
1. ✅ Threads API 클라이언트 스크립트 작성
2. ✅ 글로벌 스킬 파일 생성 (`~/.claude/skills/threads-builder.md`)
3. ✅ Writer로 500자 포스트 작성
4. ✅ 테스트 게시

**설정 완료 시간**: 약 15-20분
