# 모루 — 나의 오늘, 다음 한 걸음

혼자 사용하는 한국어 일정·목표 관리 MVP입니다. Next.js 16.3.8, React 19.3.0, TypeScript 7.0.2, Firebase 12.19.0, Firebase Admin 14.5.0을 사용하며 `package-lock.json`에 설치 버전을 고정했습니다. 개발 환경은 Node 22.22.0, Java 21에서 확인했습니다.

## 먼저 실행하기 — 외부 계정 없이

프로젝트 폴더에서 PowerShell 터미널을 여세요.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run emulators
```

새 터미널에서:

```powershell
npm run seed
npm run dev
```

[http://localhost:3000](http://localhost:3000)을 열고 **로컬 테스트 계정으로 시작**을 누르세요. `APP_ORIGIN`과 일치하도록 `localhost`로 접속합니다. 호스트를 변경하려면 `.env.local`의 `APP_ORIGIN`도 변경하세요.

- 개발 Firebase 프로젝트 ID: `demo-moru` — 실제 클라우드 프로젝트가 아닙니다.
- 가상 계정: `owner@example.test` / `moru-local-only`, UID `local-owner`.
- Firebase Emulator UI: [http://127.0.0.1:4000](http://127.0.0.1:4000).
- Auth 9099, Firestore 8080. 모든 서비스는 loopback으로 제한됩니다.
- `seed`는 `demo-moru`와 두 Emulator 환경변수가 있을 때만 동작합니다. 실제 프로젝트에는 실행할 수 없습니다.
- `seed`는 초기 가상 데이터를 생성합니다. 반복 실행하면 설정을 서울/이메일 꺼짐으로 재설정하므로 일상적인 시작에는 다시 실행하지 마세요.
- Emulator를 **Ctrl+C로 정상 종료**하면 `work/emulator-data`에 내보내고 다음 실행 때 자동 가져옵니다. 강제 종료한 메모리 변경분은 보장되지 않습니다.
- Java 21+가 필요합니다. 이 PC의 Android Studio JBR은 실행 스크립트가 자동으로 찾습니다. 다른 PC는 JDK를 설치한 뒤 `JAVA_HOME`을 지정하세요. 전역 설정은 자동으로 변경하지 않습니다.
- 사용자 전역 Firebase 로그인 정보를 사용하지 않도록 로컬 CLI 구성과 다운로드 캐시는 `work/`로 분리했습니다.

이미 제공된 작업 폴더에는 `.env.local`과 설치된 패키지가 준비되어 있습니다. ZIP을 새로 푼 경우 위 초기 단계를 실행하세요.

## 제공 기능

- 오늘: 오늘 마감·실행할 일, 지난 마감, 지난 실행 일정, 이번 주 마감, 직접 지정한 높은 우선순위, 계획별 다음 행동, 빠른 추가.
- 계획: 기본 5개 분야, 상태 필터, 목표·메모·자료 링크, 연결된 할 일, 완료 수/전체 수에 근거한 진행률.
- 할 일: 독립/계획 소속, 분야 일치, 상태·우선순위·날짜·시간·메모 수정, 완료/재개/보류/취소, 삭제와 복구.
- 캘린더: 월간/주간, 모바일 월간 날짜 선택과 당일 목록·주간 7일 세로 보기, 실행 시간·날짜 마감·Google 출처 구분, 시간 미정 목록, 여러 날에 걸친 일정.
- 알림함: 예약·처리·발송·실패·취소 기록, 이메일 별도 상태.
- 설정: IANA 시간대, 확인된 본인 주소에 대한 이메일 opt-in, Calendar 연결·캘린더 선택·연결 해제.
- dots: 계획·할 일 조회/등록/부분 수정 MCP 도구, 재시도 중복 방지, 버전 충돌 검사, 연결 허용·해제와 최근 변경 기록. **로컬 키·접근 허용·MCP 조회 점검은 완료했습니다. 개인 터널 실행과 ChatGPT 플러그인 연결을 완료했습니다. 실제 dots 대화로 항목을 변경하는 흐름은 아직 미검증입니다.** 설정·권한·검증 범위는 [DOTS-INTEGRATION.md](DOTS-INTEGRATION.md)를 참고하세요.

검토 중·보류·완료·삭제된 계획의 할 일은 확정 일정과 예약 알림에서 제외됩니다. 다음 행동은 현재 불러온 활동 가능한 할 일 중 하나를 보여줍니다. 미완료 항목은 다음 날로 자동 이동하지 않습니다. 삭제는 `deleted` 플래그로 보관하며 ‘삭제됨’ 목록에서 복구합니다. 계획을 삭제해도 소속 할 일을 지우지 않습니다.

## 구조와 저장 형식

### 모바일 사용성

- 650px 이하에서는 하단에 6개 메뉴를 고정하고 화면 하단 안전 영역을 확보합니다. 화면 이동 시 맨 위로 돌아갑니다.
- 완료·재개·삭제 등 주요 버튼은 최소 44px 터치 영역, 입력 필드는 16px 글자를 사용합니다. 모바일 로그아웃은 화면 하단에서 사용할 수 있습니다.
- 편집기는 모바일 전체 화면으로 열리고 입력 영역만 스크롤됩니다. 닫기·취소·저장 버튼과 저장 실패 메시지는 입력 영역 밖에 유지합니다.
- 월간 보기에서 날짜별 항목 개수를 확인하고 날짜를 선택하면 해당 날짜의 실행 일정과 마감을 표시합니다. 주간 보기는 월 경계의 날짜도 포함합니다.
- Chrome 320/390/430px 및 480px 높이에서 확인했습니다. 실제 iOS/Android 키보드와 Safari는 추가 기기 검증이 필요합니다.

### 디렉터리와 데이터

```text
src/domain/          Zod 검증, 날짜/시간대, 상태 규칙, 외부 일정 정규화
src/client/          Firebase Auth와 인증된 HTTP 클라이언트
src/components/      한국어 UI와 입력 폼
src/app/api/         인증·출처 검증 후 사용하는 서버 API
src/server/          Admin SDK 저장소, OAuth, 암호화, 예약 알림 작업자
scripts/             로컬 Emulator / 가상 데이터 / 독립 작업자 실행
tests/               도메인, 실제 Emulator 통합, Chromium 사용자 흐름
firestore.rules      소유권·필드·자료형·상태·날짜·계획 연결 검증
firestore.indexes.json 기간/알림 조회 인덱스
```

Firestore 경로:

```text
access/owner                         {uid: 소유자 UID}, 클라이언트 접근 불가
users/{uid}/plans/{id}                계획
users/{uid}/tasks/{id}                할 일
users/{uid}/settings/preferences      시간대·이메일 opt-in
users/{uid}/notifications/{jobId}      예약 및 처리 기록
privateCalendar/{uid}                 암호화된 OAuth 토큰, 선택, 동기화 상태
oauthStates/{hashedState}             일회성 OAuth state, PKCE, 10분 만료
```

`dueDate`, `targetDate`는 `YYYY-MM-DD` 문자열입니다. `startAt`, `endAt`, `updatedAt`, 알림 `dueAt`는 Firestore Timestamp입니다. HTTP 경계에서만 ISO 문자열로 바꿉니다. 서울 기본값을 사용하며 실제 실행 시각은 UTC로 저장합니다. 날짜 마감을 자정 실행 일정으로 변환하지 않습니다. 날짜 알림의 기본 09:00은 입력 폼에 명시된 별도 기준 시각입니다. DST로 존재하지 않거나 중복되는 수동 입력 실행 시간은 다른 시각을 선택하도록 거절합니다.

목록은 최근 수정순 100개씩 커서로 읽고 추가 로딩을 표시합니다. 전체 요약이 필요하면 ‘더 불러오기’를 사용하세요. 캘린더는 최대 93일의 기간 조회를 별도로 사용하며, 한 종류 조회가 500개를 넘으면 오류로 안내합니다. 시간 미정 목록은 별도 조회합니다. 실시간 전체 구독은 사용하지 않습니다.

일반 앱 변경은 인증된 서버 API와 공통 Zod 스키마를 사용합니다. Admin SDK는 Rules를 우회하므로 서버에서 토큰 유효성·계정 허용·UID·문서 소유권·연결 분야·버전을 직접 검사합니다. `version`이 오래된 편집은 409로 거절합니다. Rules는 직접 SDK로 쓰는 할 일에도 검증을 강제합니다. 계획·설정은 URL/IANA 시간대·계획 분야 변경의 교차 문서 검증을 위해 서버 전용 쓰기로 제한합니다. 비밀 문서와 알림 기록은 클라이언트가 쓸 수 없습니다.

## 실제 Firebase 설정 — 아직 실행하지 않음

**아래는 사용자가 외부 프로젝트·접근 권한 설정을 승인한 뒤 진행할 단계입니다. 이번 작업에서는 프로젝트 생성, IAM 변경, 규칙 배포, 결제 연결을 하지 않았습니다.**

1. 이 앱 전용 Firebase 프로젝트와 Web App을 새로 준비합니다. 기존 서비스의 프로젝트, 운영 데이터, 서비스 계정, 비밀값은 재사용하지 마세요.
2. Firebase Authentication에서 Google 제공자를 활성화하고 승인된 도메인을 등록합니다. Firestore를 준비합니다. 최초 사용 전 Rules를 배포하세요. 콘솔의 공개 테스트 규칙을 사용하지 마세요.
3. `.env.local`의 공개 Web App 설정을 해당 프로젝트 값으로 바꾸고 `NEXT_PUBLIC_USE_EMULATORS=false`로 설정합니다. `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`는 **삭제**합니다.
4. 서버는 전용 프로젝트에만 접근하는 Application Default Credentials를 사용합니다. 호스팅 환경의 워크로드 신원을 우선 사용합니다. 로컬 서비스 계정 파일이 꼭 필요하면 저장소 밖 제한된 폴더에 보관하고 `GOOGLE_APPLICATION_CREDENTIALS`에는 **파일 경로만** 넣습니다.
5. 본인의 Firebase Auth UID를 확인해 서버 `OWNER_UID`에 설정하고, 관리자 콘솔에서 `access/owner` 문서의 `uid`도 같은 값으로 설정합니다. 새 계정은 Firebase 로그인에 성공해도 두 값이 일치하기 전 앱 데이터에 접근할 수 없습니다.
6. 승인된 전용 프로젝트를 명시하여 Rules와 인덱스를 배포합니다. 다음 명령은 이 작업에서 실행하지 않았습니다.

```powershell
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_DEDICATED_PROJECT_ID
```

Firestore Emulator는 복합 인덱스 존재를 생산 환경처럼 강제하지 않습니다. 배포 후 인덱스 생성 완료를 확인하고 실제 프로젝트에서 조회 테스트를 추가로 해야 합니다. 소유자 변경은 서버 환경변수와 정책 문서를 함께 변경해야 합니다.

## 환경변수

| 이름 | 용도 |
| --- | --- |
| `NEXT_PUBLIC_USE_EMULATORS` | 로컬 Auth Emulator 사용 여부 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web App 공개 설정 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth 도메인 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Web App 프로젝트 ID |
| `FIREBASE_PROJECT_ID` | 서버 전용 프로젝트 ID |
| `FIREBASE_AUTH_EMULATOR_HOST` | 개발 전용 `127.0.0.1:9099` |
| `FIRESTORE_EMULATOR_HOST` | 개발 전용 `127.0.0.1:8080` |
| `OWNER_UID` | 허용하는 단 하나의 Firebase UID |
| `APP_ORIGIN` | 정확한 웹앱 origin, 운영 환경에서는 HTTPS |
| `GOOGLE_APPLICATION_CREDENTIALS` | 선택적 서버 자격증명 파일 경로; ADC 권장 |
| `GOOGLE_CLIENT_ID` | 별도 Calendar OAuth Web Client |
| `GOOGLE_CLIENT_SECRET` | 서버 전용 OAuth 비밀값 |
| `GOOGLE_REDIRECT_URI` | `/api/calendar/callback` 절대 URL |
| `TOKEN_ENCRYPTION_KEY` | 무작위 32바이트의 base64; 서버 전용 |
| `MORU_DOTS_TOKEN` | 선택적 dots 로컬 어댑터 전용 키. 승인 후 `npm run dots:prepare`로 생성하며 앱 설정의 접근 허용도 필요 |
| `SCHEDULER_ENABLED` | 운영자가 독립 예약 실행을 구성한 뒤 `true` |
| `EMAIL_MODE` | 기본 `test`; 명시적으로 준비한 경우에만 `live` |
| `RESEND_API_KEY` | 선택적 실제 이메일 제공업체 서버 키 |
| `EMAIL_FROM` | 제공업체에서 검증된 발신 주소 |

비밀값은 채팅, 소스, `NEXT_PUBLIC_` 변수 또는 Firestore의 사용자 읽기 문서에 넣지 마세요. `.env.local`은 Git에서 제외됩니다. 운영 환경에서는 호스트의 secret 저장소에 입력하고 로그에 값을 출력하지 마세요. Firebase Web App의 공개 설정과 서비스 계정 비밀 키는 서로 다릅니다.

## Google Calendar — 구현됨, 실제 OAuth 설정 미완료

같은 전용 프로젝트에서 Calendar API와 OAuth 동의 화면을 준비하고, 개인용 테스트 사용자에 본인 계정을 지정합니다. Google 로그인용 제공자 설정과 Calendar 권한 동의는 별개입니다. 다른 앱의 Google 권한이나 이 대화의 연결 권한을 사용하지 않습니다.

OAuth Web Client의 리디렉션 주소를 `GOOGLE_REDIRECT_URI`와 정확히 일치시킵니다. 로컬 기본값은 `http://localhost:3000/api/calendar/callback`입니다. 요청 권한은 다음 두 개뿐입니다.

```text
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
```

서버는 state + HttpOnly SameSite=Lax 쿠키 + PKCE를 사용합니다. state는 10분 후 만료되고 한 번만 소비됩니다. 토큰은 AES-256-GCM으로 암호화하여 Rules에서 전면 차단한 `privateCalendar`에 저장합니다. 암호화 키를 잃거나 교체하면 연결을 다시 해야 합니다. 운영 secret 접근은 서버 신원으로만 제한하세요. 토큰·인증 코드 응답은 로그에 출력하지 않습니다.

설정 → Google Calendar 연결 → 별도 동의 → 표시할 캘린더 선택 → 캘린더 화면에서 새로고침 순서입니다. 계정은 UID당 연결 하나이며 재연결하면 선택을 다시 합니다. 앱 데이터는 계속 Firestore에 저장합니다.

반복 일정은 `singleEvents=true`로 펼치고 전체 페이지를 읽습니다. 선택 기간의 결과를 새 스냅샷으로 교체하므로 변경·취소·기간 밖 이동을 반영합니다. `(calendarId,eventId)`로 중복을 제거하고 종일 일정의 종료 날짜는 배타적으로 처리합니다. **백그라운드 Google 동기화와 쓰기 동기화는 제공하지 않습니다.** 새 기간으로 이동한 뒤 Google 새로고침을 누르세요. 오류 시 앱의 계획·할 일은 계속 동작하고, 표시 중인 Google 결과는 이전 동기화 값일 수 있습니다.

연결 해제는 서버 토큰 삭제와 Google 권한 철회를 시도합니다. 철회 API가 실패하면 앱에 안내하며 Google 계정의 연결된 앱에서도 수동 철회해야 합니다. OAuth 테스트 앱의 토큰 만료·동의 정책은 실제 Google 설정에 따라 재연결이 필요할 수 있습니다.

## 알림 — 서버 작업자는 구현, 운영 예약 활성화는 미완료

세 번째 터미널에서 독립 프로세스를 실행하세요.

```powershell
npm run worker
# 한 번만 처리
npm run worker -- --once
```

이 작업자는 브라우저와 별개로 60초마다 Firestore를 확인합니다. 브라우저를 닫아도 **작업자 프로세스와 Emulator/Firestore가 켜져 있으면** 동작합니다. PC 종료·절전이나 작업자 종료 후에는 동작하지 않습니다. 생산 환경은 상시 서버의 서비스 관리자/cron 또는 승인 후 클라우드 예약 실행이 필요합니다. `SCHEDULER_ENABLED`는 실제 실행을 자동 생성하는 스위치가 아니라 운영자의 구성 표시와 실메일 발송 차단 장치입니다.

작업자는 활성 상태에서 알림을 켠 할 일만 페이지 단위로 읽어 예약을 만들고 오래된 예약을 취소합니다. 날짜·시간대 변경은 다음 처리 주기에 재계산됩니다. 완료·취소·보류·삭제·미확정 계획은 남은 예약을 취소합니다. 발송 직전 상태·소유권·opt-in을 다시 확인합니다. 이미 외부 이메일 제공업체에 넘긴 요청까지 취소할 수는 없습니다.

안정적인 예약 키, Firestore transaction, 2분 lease로 동시 처리를 막습니다. 실패 시 5분 뒤 동일한 키로 재시도합니다. Resend의 24시간 idempotency 보관 기간을 넘겨 재전송하지 않도록 최초 시도 20시간 이후는 `failed-final`로 멈추며 운영자 확인이 필요합니다. 동일한 일정의 메모·제목 변경만으로 재발송하지 않습니다. 재시도 메일 본문은 예약 시 제목을 유지합니다. 이메일 주소가 변경되면 기존 키로 다른 주소에 재발송하지 않습니다.

기본 `EMAIL_MODE=test`는 기록만 남기며 네트워크 메일을 보내지 않습니다. 실제 발송은 아래 조건을 **모두** 만족해야 합니다.

1. 사용자 설정에서 이메일을 명시적으로 켬
2. Firebase Auth 본인 이메일이 확인됨
3. `EMAIL_MODE=live`
4. `SCHEDULER_ENABLED=true`
5. `RESEND_API_KEY`, 검증된 `EMAIL_FROM` 설정

제공업체나 예약 실행이 없으면 실제 이메일 발송은 비활성화됩니다. 예약은 Firestore에 남지만 작업자가 실행되기 전에는 발송되지 않습니다. UI의 현재 날짜 갱신 타이머는 알림 예약 기능과 무관합니다.

Cloud Functions/Cloud Scheduler는 이번 코드의 실행 필수 요소가 아니며 활성화하지 않았습니다. 선택한다면 Firebase Blaze 결제 연결과 Functions 실행/메모리/네트워크, Scheduler 작업, Firestore 읽기·쓰기, 비밀 저장소, 이메일 제공업체의 사용량 비용을 검토한 뒤 별도로 승인해야 합니다. 공식 안내상 Scheduler는 작업당 월 USD 0.10이며 계정당 3개 작업 무료 허용량이 있습니다. 무료 허용량은 전체 운영비 무료를 뜻하지 않습니다. 현재 worker는 개인용 polling 방식이므로 활성 알림 수와 실행 빈도에 따라 Firestore 읽기 비용이 발생합니다.

## 테스트와 현재 검증 범위

```powershell
npm run typecheck
npm run test
npm run test:emulator
npm run build
npm audit --omit=dev
```

`test:emulator`는 `demo-moru-tests`, Auth 9098, Firestore 8088의 일회성 Emulator를 시작하고 종료합니다. 개발용 `demo-moru`와 데이터·포트를 분리합니다. `test:integration`만 직접 실행하려면 해당 테스트 Emulator가 먼저 실행 중이어야 합니다.

Chrome이 설치되어 있고 개발 앱과 개발용 Emulator/seed가 실행 중인 상태에서:

```powershell
npm run test:e2e
```

브라우저 테스트는 가상 개발 공간에 테스트 제목의 계획/할 일을 추가합니다. 실제 프로젝트 환경에서 실행하지 마세요. `playwright.config.ts`는 설치된 Chrome을 사용합니다. 다른 시스템은 해당 환경에 맞는 브라우저를 준비하세요. 테스트는 초기 실행의 컴파일 시간을 기다립니다. 결과 화면은 `screenshots/`, 실패 trace는 `test-results/`, HTML 보고서는 `playwright-report/`에 기록합니다.

검증 기록은 `TEST-RESULTS.md`를 참고하세요. 실제 Google 계정 동의, 클라우드 프로젝트의 인덱스 배포, 실제 이메일 도착, 상시 서버 예약 실행, 클라우드 배포는 완료했다고 보고하지 않습니다.

## 공식 참고 자료

- [Next.js 설치 및 요구 버전](https://nextjs.org/docs/app/getting-started/installation)
- [Firebase Emulator 설치](https://firebase.google.com/docs/emulator-suite/install_and_configure)
- [Firestore Emulator와 Java 21](https://firebase.google.com/docs/emulator-suite/connect_firestore)
- [Google Calendar 최소 읽기 권한](https://developers.google.com/workspace/calendar/api/auth)
- [Google Calendar events.list](https://developers.google.com/calendar/api/v3/reference/events/list)
- [Resend idempotency와 24시간 보관](https://resend.com/changelog/idempotency-keys)
- [Firebase 예약 함수 및 비용](https://firebase.google.com/docs/functions/schedule-functions)
- [Firebase 요금제](https://firebase.google.com/pricing)

AI 계획 생성, dot 수집, Calendar 쓰기, 푸시, 협업, 가계부·일기·SNS 기능은 포함하지 않았습니다.
