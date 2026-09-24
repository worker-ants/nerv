// better-auth 인스턴스 — 웹 세션 경로의 실물 (api.md §1.3 인증 2경로 ①)
//
// **인증만 맡긴다.** 신원 확인(이메일+비밀번호)과 세션 쿠키까지가 better-auth 의 몫이고,
// 역할·멤버십·권한은 도메인 테이블이 쥔다(`membership.role` 이 정본 — data-model §2.1).
// organization 플러그인을 켜지 않는 이유가 그것이다: 켜면 조직·멤버가 두 곳에 저장되고,
// 그 순간 "역할의 정본이 어디인가"라는 질문에 답이 둘이 된다(D-08 의 전제가 무너진다).
//
// 사용자 행은 도메인 `user` 테이블을 그대로 쓴다 — 인증용 사본을 만들면 같은 사람이 두 개의
// id 를 갖게 되고, event.actor_user_id 가 어느 쪽을 가리키는지 매번 물어야 한다.

import { RATE_LIMIT_AUTH_PER_MIN, RATE_LIMIT_SIGN_IN_PER_MIN, newId } from '@nerv/schema';
import { betterAuth } from 'better-auth';
import type pg from 'pg';
import { allowedOriginsFromEnv, apiUrlFromEnv, cookieDomainFromEnv } from '../../common/origins.js';
import { requireEmailVerificationFromEnv } from '../mail/mail.config.js';
import { returnToOf } from '../mail/verify-link.js';

/**
 * baseURL 외에 추가로 신뢰할 오리진 — **CORS 허용목록과 같은 목록이다**(2026-09-20 ·
 * REQ-CB-041 · docs/04-mvp/scope.md §2.3 2단계). 목록을 만드는 것은 `common/origins.ts` 의
 * `allowedOriginsFromEnv`(= `NERV_WEB_URL` + `NERV_TRUSTED_ORIGINS`)이고, `/mcp` 가드도
 * 같은 파일의 함수로 오리진을 읽는다 — 세 곳의 판정이 갈리지 않는 방법은 한 출처뿐이다.
 *
 * **전에는 `NERV_WEB_URL` 이 여기 없었다.** 1단계는 "동작이 한 줄도 바뀌지 않는다" 가
 * 조건이라 목록의 구성을 건드리지 않았고, 화면이 다른 오리진에 뜨는 배치(개발 루프의
 * `http://localhost:5173`)는 `NERV_TRUSTED_ORIGINS` 로 **한 번 더** 적어야 했다. 2단계는
 * 그 중복을 걷는다 — 화면 주소는 이미 `NERV_WEB_URL` 이 알고 있다.
 *
 * 이 목록은 CSRF 방어선이다. 늘리는 것은 **환경이 실제로 다른 오리진에서 화면을 띄울 때**
 * 뿐이고, 그 판단은 운영 주체가 env 로 명시한다 — 코드가 추측하지 않는다.
 *
 * `baseURL`(=`NERV_API_URL`)은 better-auth 가 언제나 자기 신뢰 목록에 넣지만, 여기서도
 * 명시한다 — 목록을 읽는 사람이 "API 자신은 어디 있나" 를 라이브러리 구현에서 찾지 않게.
 */
function trustedOrigins(): string[] {
  const base = apiUrlFromEnv();
  return [...new Set([base, ...allowedOriginsFromEnv()])];
}

/** 반환 타입은 옵션 리터럴에 의존한다 — 추론에 맡긴다(명시하면 타입이 좁아 대입이 깨진다). */
export type NervAuth = ReturnType<typeof createBetterAuth>;

/**
 * 인증 메일을 줄 세우는 쪽 — `MailOutbox` 의 두 메서드만 쓴다.
 *
 * 인터페이스로 받는 이유는 이 파일이 **Nest 밖**이기 때문이다(순수 함수다). 서비스를 그대로
 * import 하면 이 모듈이 DI 그래프에 끌려 들어가고, 그러면 테스트가 better-auth 를 만들 때마다
 * DB 를 세워야 한다.
 */
export interface VerificationMail {
  enqueueVerifyEmail(input: {
    email: string;
    name: string;
    token: string;
    locale?: string | null;
    returnTo?: string | null;
  }): Promise<boolean>;
}

export function createBetterAuth(pool: pg.Pool, mail?: VerificationMail) {
  const secret = process.env['NERV_AUTH_SECRET'] ?? '';
  // 값이 틀렸으면 여기서 던진다 — api·worker 둘 다 이 생성자를 거치므로 기동 거부가 양쪽에
  // 선다(브라우저가 Domain 쿠키를 조용히 버리는 것보다 뜨지 않는 편이 싸다 · REQ-CB-042).
  const cookieDomain = cookieDomainFromEnv();
  return betterAuth({
    // 서명 키가 없으면 개발 기본값으로 뜬다 — 운영 배포는 env 검증이 먼저 막는다(§5.2 필수 키).
    secret: secret === '' ? 'dev-only-insecure-secret-change-me' : secret,
    // 세션 핸들러가 사는 오리진이다 — 화면 주소가 아니라 API 주소다(REQ-CB-036).
    baseURL: apiUrlFromEnv(),
    basePath: '/api/auth',
    // 브라우저의 Origin 이 baseURL 과 다를 수 있다 — **개발 루프가 그렇다**: 화면은 Vite(:5173)
    // 에서 뜨고 API 는 :8080 이라, 프록시를 거쳐도 Origin 은 :5173 로 남는다. baseURL 만
    // 신뢰하면 로그인이 `INVALID_ORIGIN` 으로 막힌다(실측 — compose 는 둘이 같아서 안 보였다).
    // 2026-09-20 부터 화면 주소가 목록에 **자동으로** 들어가므로 그 배치는 따로 적지 않아도
    // 된다(REQ-CB-041). 목록이 더 자라는 것은 운영자가 `NERV_TRUSTED_ORIGINS` 로 명시할 때뿐이다.
    trustedOrigins: trustedOrigins(),
    // 커넥션 풀을 그대로 넘긴다 — drizzle 어댑터를 쓰면 better-auth 가 끌고 오는
    // drizzle peer 집합이 @nerv/schema 의 것과 갈라져 같은 테이블 타입이 둘이 된다(실측).
    // 테이블·컬럼 이름은 아래 modelName·fields 매핑이 정한다.
    database: pool,
    advanced: {
      // id 는 UUIDv7 이다 — 도메인 전체가 그것을 쓰고(REQ-DB-003), user.id 는 uuid 컬럼이다.
      database: { generateId: (): string => newId() },
      // **오리진 검증을 NODE_ENV 에 맡기지 않는다**(2026-09-20 실측 · better-auth 1.7.1).
      // 이 옵션을 비워 두면 라이브러리가 `isTest()` 일 때 검증을 **스스로 끈다**
      // (`skipOriginCheck: … isTest() ? true : false`). 운영에서는 켜져 있으니 동작은
      // 같지만, 그러면 **L2 가 끈 채로 초록을 본다** — 위 목록이 CSRF 방어선이라고
      // 적어 두고 그 방어선을 한 번도 태우지 않는 셈이다. 켜 두고 검사가 세게 한다.
      disableOriginCheck: false,
      // 쿠키를 한 호스트보다 넓게 둘 것인가는 `NERV_COOKIE_DOMAIN` 이 정한다(REQ-CB-042).
      // **비어 있으면 키 자체를 넣지 않는다** — 옵션만 켜고 도메인을 비우면 better-auth 가
      // baseURL 의 호스트를 도메인으로 써서(실물 `createCookieGetter`), 호스트 전용이던
      // 쿠키가 `Domain=api.…` 로 바뀐다. "비움 = 지금까지의 동작" 이 깨지는 자리다.
      ...(cookieDomain === null
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
    },
    // 한도를 코드에 적어 둔다 — 기본값에 맡기면 값이 어디에도 없고 문구도 우리 것이 아니다.
    // 주체가 IP 인 이유는 로그인 전에는 토큰도 세션도 없기 때문이다(api.md §1.8).
    rateLimit: {
      enabled: true,
      window: 60,
      max: RATE_LIMIT_AUTH_PER_MIN,
      // 로그인·가입은 따로 센다 — 무차별 대입의 표적이기 때문이다. 기본값(10초당 3회)에
      // 맡기지 않는 이유는 사람이 오타 세 번에 잠기고, 그 한도가 어느 문서에도 없기 때문이다.
      customRules: {
        '/sign-in/email': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
        '/sign-up/email': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
        // 재발송도 같은 한도다 — 남의 주소를 골라 두드리면 그 사람의 메일함이 시끄러워진다
        '/send-verification-email': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
      },
    },
    emailAndPassword: {
      enabled: true,
      // **강제한다**(2026-09-22 사람 결정). 다만 강제는 메일을 보낼 수 있을 때만 성립하므로
      // 기본값을 SMTP 에서 유도한다 — 판정은 `mail.config.ts` 한 곳이고, 메일 없이 켜 둔
      // 배치는 기동 단계에서 이미 거부됐다(`assertMailConfig`).
      requireEmailVerification: requireEmailVerificationFromEnv(),
      minPasswordLength: 8,
    },
    emailVerification: {
      // 가입하면 바로 나간다 — 따로 누를 것을 두지 않는다
      sendOnSignUp: true,
      // 확인한 사람을 다시 로그인시키지 않는다. 링크를 연 브라우저가 곧 그 사람이다.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url, token }): Promise<void> => {
        // **기다리지 않는다.** better-auth 문서 자신이 그렇게 적는다 — 발송을 await 하면
        // 응답 시간이 "그 이메일이 존재하는가" 를 흘린다. 우리는 애초에 보내지 않고
        // 줄만 세우므로(§2.17) 이 호출은 INSERT 하나다.
        await mail?.enqueueVerifyEmail({
          email: user.email,
          name: user.name,
          token,
          // 요청이 정한 돌아갈 자리 — 가입·재발송이 싣는다(REQ-WEB-089 · REQ-WEB-188)
          returnTo: returnToOf(url),
        });
      },
    },
    user: {
      modelName: 'user',
      fields: {
        name: 'display_name',
        image: 'avatar_url',
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'auth_session',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'auth_account',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verification',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
  });
}
