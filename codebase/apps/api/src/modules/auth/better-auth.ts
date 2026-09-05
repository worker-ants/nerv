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

/**
 * baseURL 외에 추가로 신뢰할 오리진 — `NERV_TRUSTED_ORIGINS`(쉼표 구분, §5.2 전표).
 *
 * 이 목록은 CSRF 방어선이다. 늘리는 것은 **환경이 실제로 다른 오리진에서 화면을 띄울 때**
 * 뿐이고, 그 판단은 운영 주체가 env 로 명시한다 — 코드가 추측하지 않는다.
 */
function trustedOrigins(): string[] {
  const base = process.env['NERV_PUBLIC_URL'] ?? 'http://localhost:8080';
  const extra = (process.env['NERV_TRUSTED_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  return [...new Set([base, ...extra])];
}

/** 반환 타입은 옵션 리터럴에 의존한다 — 추론에 맡긴다(명시하면 타입이 좁아 대입이 깨진다). */
export type NervAuth = ReturnType<typeof createBetterAuth>;

export function createBetterAuth(pool: pg.Pool) {
  const secret = process.env['NERV_AUTH_SECRET'] ?? '';
  return betterAuth({
    // 서명 키가 없으면 개발 기본값으로 뜬다 — 운영 배포는 env 검증이 먼저 막는다(§5.2 필수 키).
    secret: secret === '' ? 'dev-only-insecure-secret-change-me' : secret,
    baseURL: process.env['NERV_PUBLIC_URL'] ?? 'http://localhost:8080',
    basePath: '/api/auth',
    // 브라우저의 Origin 이 baseURL 과 다를 수 있다 — **개발 루프가 그렇다**: 화면은 Vite(:5173)
    // 에서 뜨고 API 는 :8080 이라, 프록시를 거쳐도 Origin 은 :5173 로 남는다. baseURL 만
    // 신뢰하면 로그인이 `INVALID_ORIGIN` 으로 막힌다(실측 — compose 는 둘이 같아서 안 보였다).
    // 기본값을 비워 두는 것이 중요하다: 운영에서는 baseURL 하나만 신뢰한다(CSRF 방어선).
    trustedOrigins: trustedOrigins(),
    // 커넥션 풀을 그대로 넘긴다 — drizzle 어댑터를 쓰면 better-auth 가 끌고 오는
    // drizzle peer 집합이 @nerv/schema 의 것과 갈라져 같은 테이블 타입이 둘이 된다(실측).
    // 테이블·컬럼 이름은 아래 modelName·fields 매핑이 정한다.
    database: pool,
    // id 는 UUIDv7 이다 — 도메인 전체가 그것을 쓰고(REQ-DB-003), user.id 는 uuid 컬럼이다.
    advanced: { database: { generateId: (): string => newId() } },
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
      },
    },
    emailAndPassword: {
      enabled: true,
      // MVP 초대는 기존 사용자 배정이라 메일 발송 경로가 없다(screens.md §2.1) —
      // 검증 메일을 요구하면 아무도 로그인하지 못한다. 메일은 Phase 2 다.
      requireEmailVerification: false,
      minPasswordLength: 8,
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
