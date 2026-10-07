# dots HTTPS 직접 연결 운영 안내

## 구성과 비용
- 기존 Vercel Hobby와 전용 Firebase Spark만 사용합니다. 별도 VM, 상시 터널, 유료 인증업체, Redis, OpenAI API 호출은 없습니다.
- 무료 사용량 한도 내 추가 고정 비용 0원을 목표로 합니다. Vercel 함수/네트워크 및 Firestore 읽기·쓰기 한도가 적용되며 무제한 가용성을 보장하지 않습니다. 유료 전환은 별도 승인이 필요합니다.
- 요청별 Streamable HTTP + JSON 응답을 사용합니다. 상시 연결·주기적 keep-alive·예약 작업은 없습니다.

## 활성화 전
- 직접 연결은 기본 비활성화입니다. 기존 터널은 그대로 사용 가능합니다.
- 운영 환경의 APP_ORIGIN을 정확한 HTTPS origin으로 유지합니다. 현재 운영 주소의 MCP 경로는 /api/mcp 입니다.
- 승인 후 Vercel Production에 MORU_MCP_ENABLED=true를 설정하고 재배포합니다. 새 비밀키는 필요 없습니다.
- OWNER_UID, access/owner 정책, Firebase 관리자 계정은 기존 전용 프로젝트 값을 사용합니다.
- 기존 MCP SDK 1.32.1의 WebStandardStreamableHTTPServerTransport를 사용하며 도구 9개와 데이터 로직을 재사용합니다. jose 6.2.12를 명시적 의존성으로 추가했습니다.

## ChatGPT / dots 설정
1. 개인용 플러그인의 연결 주소를 운영 origin + /api/mcp로 설정합니다. 기존 플러그인이 연결 방식 변경을 지원하지 않으면 검증용 직접 연결 플러그인을 별도로 만든 뒤 전환합니다.
2. 인증은 OAuth, 클라이언트 등록은 CIMD를 사용합니다. DCR와 임의 API 키 입력 방식은 제공하지 않습니다.
3. 클라이언트 인증은 private_key_jwt 또는 none + PKCE를 지원합니다. ChatGPT가 공개하는 클라이언트 문서와 정확히 일치하는 callback만 허용합니다.
4. 모루 계정으로 로그인한 후 표시된 조회/변경 범위를 직접 승인합니다. 기존 직접 연결 1개가 새 승인으로 교체됩니다.
5. dots에서 조회를 확인한 뒤, 사용자 지정 할 일로 등록·수정·완료를 검증합니다. 운영 테스트용 데이터를 자동으로 생성하지 않습니다.

## 인증과 데이터 보호
- 본인 UID 및 access/owner 정책과 사용자 비활성화 여부를 검사합니다.
- 승인 페이지 POST는 Firebase ID 토큰과 정확한 Origin을 요구합니다. 잘못된 callback에는 리디렉션하지 않습니다.
- OAuth 코드는 PKCE S256, client_id, redirect_uri, resource에 묶이며 5분 안에 한 번만 교환할 수 있습니다.
- 액세스 토큰 15분, 갱신 권한 30일(최초 발급 기준)입니다. 토큰 갱신 시 이전 액세스 토큰도 무효화됩니다. 직전 갱신 토큰 재사용은 연결 전체를 해제합니다. 더 오래된 갱신 토큰도 거절합니다.
- 토큰/코드는 원문 대신 SHA-256 해시만 저장합니다. 서명 assertion은 OpenAI의 공개 JWKS로 RS256, issuer, subject, audience, 만료를 확인합니다. 최근 assertion ID 재사용은 Firestore 트랜잭션으로 막습니다.
- privateMcp/{uid}와 codes/pending 두 문서만 사용하며, assertion 재사용 검사 목록은 최대 64개/5분으로 제한합니다. TTL 유료 기능이나 정리용 Scheduler는 사용하지 않습니다.
- 기존 Firestore catch-all 거부 규칙으로 인증 문서는 소유자 브라우저에서도 읽거나 쓸 수 없습니다. 추가 인덱스는 필요 없습니다.
- JWT 키 확인은 chatgpt.com의 허용된 클라이언트 문서 및 /oauth/jwks.json만 사용하며 리디렉션을 따라가지 않습니다.
- 모루 설정의 직접 연결 해제는 현재 토큰·갱신 권한·발급 대기 코드를 무효화합니다. 기존 PC 터널의 접근 해제와 별개입니다.

## 검증과 전환
- npm test: 프로토콜·도메인 단위 테스트.
- npm run test:emulator: Firebase Auth/Firestore Emulator에서 소유권, 규칙, OAuth, 코드 재사용·경쟁, 토큰 갱신·해제 및 실제 MCP 도구 호출 검증.
- npm run typecheck / npm run build.
- 운영 활성화 후 dots의 실제 OAuth 연결, 토큰 갱신, 로컬 터널 중지 후 모바일 조회를 확인해야 최종 이전 완료입니다.
- 운영 활성화나 플러그인 권한 변경은 사용자 승인 후 수행합니다.

## 복구
- 직접 연결 문제 시 MORU_MCP_ENABLED=false로 재배포하면 요청이 차단됩니다. 이 설정은 일시 중단이며 토큰을 영구 폐기하려면 모루 설정에서 직접 연결을 해제하세요.
- 기존 터널 플러그인과 실행 스크립트는 전환 검증이 끝날 때까지 보존합니다.
- 직접 연결 완료 후 기존 터널 접근 및 키 폐기는 별도 확인을 거쳐 진행합니다.

## 이번 구현 범위 외
Google Calendar, 이메일 발송, 서버 예약 알림은 이번 연결 전환으로 활성화되지 않습니다.
