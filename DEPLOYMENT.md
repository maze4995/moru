# 운영 배포 상태

2026-10-07 기준 소스는 `https://github.com/maze4995/moru`의 `main`에 게시했습니다. 운영 주소는 https://moru-nine.vercel.app 입니다. 모루 전용 Firebase Spark와 Vercel Hobby를 사용합니다. 현재 로컬 앱과 dots 터널은 `demo-moru` Emulator를 사용하며 운영 데이터로 자동 전환되지 않습니다.

## 배포 방식 선택

- Vercel Hobby + Firebase Spark: 개인용 무료 한도로 시작할 수 있습니다. Google 외부 호스트에서 Firebase Admin을 인증할 서버 자격증명 설정이 필요합니다. 기본은 Application Default Credentials이며, Vercel에서는 서버 전용 `FIREBASE_SERVICE_ACCOUNT_JSON` 비밀 환경변수도 지원합니다. 자격증명의 프로젝트 일치 여부를 검증하며 형식 오류에 원문을 노출하지 않습니다.
- Firebase App Hosting: Blaze 결제 연결이 필요합니다. Cloud Run, 빌드, 저장소, 네트워크, 비밀 저장소 등 사용량에 따라 비용이 발생할 수 있습니다. 전용 서비스 계정과 Application Default Credentials를 사용할 수 있습니다.

외부 프로젝트 생성, 새로운 접근 권한, 결제 연결은 소유자 확인 후 진행합니다. 상시 예약 작업은 웹 배포만으로 활성화되지 않습니다.

## Firebase 설정 순서

1. 일정 앱 전용 프로젝트를 만들고 Firestore를 프로덕션 모드로 생성합니다. 기존 다른 서비스 프로젝트와 비밀값을 재사용하지 않습니다.
2. 웹 앱을 등록하고 Firebase Authentication의 Google 공급자를 설정합니다. 승인 도메인에는 실제 배포 도메인을 추가합니다.
3. 본인 Google 계정의 Firebase Auth UID를 확인합니다. 서버의 `OWNER_UID`와 서버 전용 문서 `access/owner`의 `uid`를 같은 값으로 설정합니다. 이 설정이 없으면 데이터 접근을 거부합니다.
4. `firebase deploy --only firestore:rules,firestore:indexes --project <DEDICATED_PROJECT_ID>`로 저장소의 규칙·인덱스를 배포합니다. `.firebaserc` 기본값은 로컬 개발용 `demo-moru`로 유지하며 실제 프로젝트는 명시적으로 지정합니다.
5. 호스팅 서버 인증, 환경변수, HTTPS 주소를 설정한 뒤 빌드·배포합니다. 공개 환경변수는 빌드 시 반영되므로 변경 후 다시 빌드합니다.
6. 비로그인/다른 계정 차단, 본인 로그인, 계획·할 일 등록·수정·완료·재로그인 후 유지, 인덱스 준비 상태를 실제 운영 환경에서 확인합니다.

## 운영 환경변수

| 이름 | 운영 값 |
| --- | --- |
| `NEXT_PUBLIC_USE_EMULATORS` | `false` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | 전용 Firebase 웹 앱의 공개 구성 값 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | 전용 웹 앱의 Auth 도메인 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | 전용 프로젝트 ID |
| `FIREBASE_PROJECT_ID` | 같은 전용 프로젝트 ID |
| `OWNER_UID` | 본인 Firebase Auth UID |
| `APP_ORIGIN` | 실제 배포 HTTPS origin, 경로 없이 지정 |
| `SCHEDULER_ENABLED` | 상시 작업자 준비 전 `false` |
| `EMAIL_MODE` | 기본 `test` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 전용 서비스 계정의 JSON 전체, 서버 Secret에만 저장 |
| `NODE_OPTIONS` | Vercel Node 22에서 `--experimental-require-module` |

Vercel은 기본적으로 ESM의 `require()`를 비활성화합니다. 현재 Firebase Admin의 `jwks-rsa`/`jose` 의존성이 이 기능을 요구하므로 위 옵션이 없으면 빌드는 성공해도 API가 시작 중 500으로 실패합니다. [공식 런타임 설정](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)을 따릅니다.

`firestore.indexes.json`의 복합 색인 6개를 사용합니다. `status + __name__`, `reminder.enabled + __name__`의 같은 방향 정렬은 기본 단일 필드 색인이 제공하므로 중복 정의하지 않습니다. [Firestore 색인 설명](https://firebase.google.com/docs/firestore/query-data/index-overview).

운영에는 `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`를 설정하지 않습니다. 서버 인증은 호스팅의 안전한 비밀 저장소 또는 서비스 계정 신원을 사용합니다. JSON 키를 소스, 공개 환경변수, 사용자 Firestore 문서, 채팅에 넣지 않습니다.

Calendar의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`와 이메일의 `RESEND_API_KEY`, `EMAIL_FROM`은 별도 연동용입니다. 설정 전에는 해당 기능을 비활성 상태로 유지합니다. OAuth 콜백은 실제 HTTPS 도메인으로 등록합니다.

## dots와 데이터 전환

MCP 어댑터는 기본적으로 loopback HTTP로 로컬 앱에 연결합니다. `MORU_DOTS_PRODUCTION_ORIGIN`과 `MORU_DOTS_PRODUCTION_TOKEN`을 함께 설정하면 명시한 단일 HTTPS origin으로 연결합니다. 운영 origin만 있고 키가 없는 경우 로컬 연결로 대체하지 않고 시작을 거절합니다. 웹 앱을 배포해도 dots가 운영 데이터로 자동 전환되지 않습니다. 운영 전환 시 운영 origin과 서버 전용 키, 운영 소유자의 dots 접근 허용을 함께 구성하고 실제 대화에서 검증해야 합니다. 기존 개인 터널 방식은 PC와 터널 프로세스가 켜져 있어야 합니다.

가상 데모 데이터와 테스트 계정은 운영으로 복사하지 않습니다. 로컬 환경파일과 터널 설정은 공개 저장소에서 제외합니다.

## 이번 게시 전 확인

- 단위·MCP·운영 연결 경계 테스트 16/16 통과.
- TypeScript 검사와 Next.js 프로덕션 빌드 통과.
- 게시할 파일에서 현재 연결 키와 개인 터널 식별자 검사 통과.
- 이전 Emulator·모바일 검증 범위는 `TEST-RESULTS.md` 참조.
- 운영 Firebase에 Google 로그인, 본인 UID 정책, Security Rules, 복합 색인 6개를 적용했습니다.
- 운영 API의 비로그인/잘못된 토큰 401, 잘못된 Origin 403, 비로그인 Firestore 조회 403을 확인했습니다.
- 운영 UI에서 가상 계획·할 일 저장, 완료·재개·보류·날짜 변경, 새로고침 후 날짜와 실행 시간 유지를 확인했습니다. 자세한 최신 검증 상태는 `TEST-RESULTS.md`를 참고하세요.
- Google Calendar OAuth, 이메일 실발송, 상시 예약 실행, dots의 운영 연결은 아직 설정하지 않았습니다. 웹을 닫은 상태의 예약 알림이 완성된 상태가 아닙니다.

공식 안내: [Firebase Admin 설정](https://firebase.google.com/docs/admin/setup), [App Hosting 비용](https://firebase.google.com/docs/app-hosting/costs), [Vercel Hobby](https://vercel.com/docs/plans/hobby).
