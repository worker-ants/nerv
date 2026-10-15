// better-auth 인스턴스 — 웹 세션 경로의 실물 (api.md §1.3 인증 2경로 ①)
//
// **인증만 맡긴다.** 신원 확인(이메일+비밀번호)과 세션 쿠키까지가 better-auth 의 몫이고,
// 역할·멤버십·권한은 도메인 테이블이 쥔다(`membership.role` 이 정본 — data-model §2.1).
// organization 플러그인을 켜지 않는 이유가 그것이다: 켜면 조직·멤버가 두 곳에 저장되고,
// 그 순간 "역할의 정본이 어디인가"라는 질문에 답이 둘이 된다(D-08 의 전제가 무너진다).
//
// 사용자 행은 도메인 `user` 테이블을 그대로 쓴다 — 인증용 사본을 만들면 같은 사람이 두 개의
// id 를 갖게 되고, event.actor_user_id 가 어느 쪽을 가리키는지 매번 물어야 한다.

import { Logger } from '@nestjs/common';
import {
  EMAIL_VERIFY_TTL_MINUTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_TTL_MINUTES,
  RATE_LIMIT_AUTH_PER_MIN,
  RATE_LIMIT_SIGN_IN_PER_MIN,
  negotiateLocale,
  newId,
} from '@nerv/schema';
import { APIError, BASE_ERROR_CODES, betterAuth } from 'better-auth';
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { verifyJWT } from 'better-auth/crypto';
import type pg from 'pg';
import {
  allowedOriginsFromEnv,
  apiUrlFromEnv,
  cookieDomainFromEnv,
  webUrlFromEnv,
} from '../../common/origins.js';
import { clientIpHeaderFromEnv, trustedProxyEntriesFromEnv } from '../../common/client-ip.js';
import { mailEnabled, requireEmailVerificationFromEnv } from '../mail/mail.config.js';
import { returnToOf } from '../mail/verify-link.js';
import {
  consumePending,
  dropPending,
  hitAttempt,
  matchesPending,
  readPending,
  recordPending,
} from './email-change.js';
import type { EmailChangeStage } from './email-change.js';

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
 * 인증 메일을 줄 세우는 쪽 — `MailOutbox` 의 두 메서드(가입 확인 · 비밀번호 재설정)만 쓴다.
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
  enqueueResetPassword(input: {
    email: string;
    name: string;
    token: string;
    locale?: string | null;
  }): Promise<boolean>;
  /** 이메일 바꾸기 ① — 옛 주소로 승인 링크(2026-10-15 · REQ-API-310) */
  enqueueChangeEmailApprove(input: {
    email: string;
    name: string;
    newEmail: string;
    token: string;
    userId: string;
    locale?: string | null;
  }): Promise<boolean>;
  /** 이메일 바꾸기 ② — 새 주소로 확인 링크 */
  enqueueChangeEmailConfirm(input: {
    email: string;
    name: string;
    token: string;
    userId: string;
    locale?: string | null;
  }): Promise<boolean>;
  /** 이메일 바꾸기 ③ — 바뀐 뒤 옛 주소로 알림 */
  enqueueEmailChanged(input: {
    email: string;
    name: string;
    newEmail: string;
    userId: string;
    locale?: string | null;
  }): Promise<boolean>;
}

/**
 * 메일의 언어 — **요청한 화면의 것**이다(2026-09-25). 화면은 인증 요청에도 지금 언어를 `accept-language` 로
 * 싣는다(`apps/web/src/lib/session.ts`). 전에는 가입 확인 메일이 언제나 기본 언어(한국어)로 나갔다 — 영어 화면에서
 * 가입한 사람이 읽을 수 없는 첫 메일을 받았다.
 */
function localeOf(request: Request | undefined): string {
  return negotiateLocale(request?.headers.get('accept-language') ?? null);
}

/** 이메일 바꾸기 토큰의 속 — 인증 스택이 서명한 JWT 다(옛 주소 · 새 주소 · 단계) */
interface ChangeEmailClaim {
  email: string;
  updateTo: string;
  /** `legacy` 는 단계가 없는 토큰(인증 스택의 옛 한 단계 흐름)이다 — 이 배치는 만들지 않으므로 언제나 막는다 */
  stage: EmailChangeStage | 'legacy';
}

/**
 * 토큰이 이메일 바꾸기의 것이면 그 속을, 아니면 null 을 준다. **서명을 본다** — 서명이 틀리거나 만료된 토큰은 null 이고,
 * 그 판정과 오류 응답은 인증 스택이 그대로 한다(가입 확인 링크도 같은 자리를 지나간다).
 */
async function changeEmailClaim(token: unknown, secret: string): Promise<ChangeEmailClaim | null> {
  if (typeof token !== 'string' || token === '') return null;
  const payload = await verifyJWT(token, secret);
  if (payload === null) return null;
  const { email, updateTo, requestType } = payload as Record<string, unknown>;
  if (typeof email !== 'string' || typeof updateTo !== 'string') return null;
  const stage: ChangeEmailClaim['stage'] =
    requestType === 'change-email-confirmation'
      ? 'approve'
      : requestType === 'change-email-verification'
        ? 'confirm'
        : 'legacy';
  return { email: email.toLowerCase(), updateTo: updateTo.toLowerCase(), stage };
}

/** 쿼리의 돌아갈 화면에 오류 코드를 붙인 주소 — 인증 스택의 오류 모양(`?error=<코드>`) 그대로다 */
function withError(callbackURL: string, code: string): string {
  const url = new URL(callbackURL);
  url.searchParams.set('error', code);
  return url.toString();
}

export function createBetterAuth(pool: pg.Pool, mail?: VerificationMail) {
  const secret = process.env['NERV_AUTH_SECRET'] ?? '';
  // 서명 키가 없으면 개발 기본값으로 뜬다 — 운영 배포는 env 검증이 먼저 막는다(§5.2 필수 키).
  // 이메일 바꾸기 훅이 토큰의 서명을 같은 키로 본다.
  const authSecret = secret === '' ? 'dev-only-insecure-secret-change-me' : secret;
  // 값이 틀렸으면 여기서 던진다 — api·worker 둘 다 이 생성자를 거치므로 기동 거부가 양쪽에
  // 선다(브라우저가 Domain 쿠키를 조용히 버리는 것보다 뜨지 않는 편이 싸다 · REQ-CB-042).
  const cookieDomain = cookieDomainFromEnv();
  // 이메일 바꾸기는 메일을 보낼 수 있을 때만 켠다(2026-10-15 · 사람 결정 · REQ-API-310) — 옛 주소의 승인과 새 주소의
  // 확인이 둘 다 메일이다. 꺼진 배치에서 인증 스택은 `/change-email` 에 400 `CHANGE_EMAIL_DISABLED` 로 답한다.
  const changeEmailOn = mail !== undefined && mailEnabled();
  const log = new Logger('EmailChange');
  return betterAuth({
    secret: authSecret,
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
      // **접속 주소는 접근 로그와 같은 규칙으로 읽는다**(2026-09-28 · REQ-API-244). 이 스택의 기본은
      // `X-Forwarded-For` 가 한 칸일 때만 믿어서, 프록시를 지나 두 칸 이상이 된 운영(Cloudflare → cloudflared
      // → ingress)에서는 주소를 못 찾았다 — 세션의 IP 가 비고, 로그인 · 가입 한도가 모든 사람이 **한 통**을
      // 나눠 쓰는 자리로 떨어졌다(라이브러리의 대체 동작). 클라이언트 주소 헤더(`NERV_CLIENT_IP_HEADER`)를
      // 먼저 보고, 없으면 신뢰 프록시(`NERV_TRUSTED_PROXIES`)를 오른쪽부터 건너뛴 첫 주소다(REQ-CB-055 와 같다)
      ipAddress: {
        ipAddressHeaders: [
          ...[clientIpHeaderFromEnv()].filter((h): h is string => h !== null),
          'x-forwarded-for',
        ],
        trustedProxies: trustedProxyEntriesFromEnv(),
      },
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
        // 비밀번호 바꾸기도 지금 비밀번호를 맞히는 자리라 로그인과 같은 한도다(2026-09-25 · REQ-API-186)
        '/change-password': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
        // 재설정 요청은 재발송과 같은 까닭이고(남의 메일함), 재설정 자체는 토큰을 맞히는 자리다(2026-09-25 ·
        // REQ-API-187). 인증 스택의 기본값(요청 분당 3회)에 맡기지 않는 이유는 위의 로그인과 같다
        '/request-password-reset': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
        '/reset-password': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
        // 이메일 바꾸기도 지금 비밀번호를 맞히는 자리다(2026-10-15 · REQ-API-310). 사람마다 세는 한도는 아래 훅이 더한다
        '/change-email': { window: 60, max: RATE_LIMIT_SIGN_IN_PER_MIN },
      },
    },
    /**
     * **이름을 바꾸는 문은 하나다**(2026-09-25 · REQ-API-186). 인증 스택의 `/update-user` 는 이름(→ `display_name`)과
     * 사진을 **검사 없이** 받는다 — 빈 이름·끝없는 이름이 멤버 표에 박힌다. 이름은 `PATCH /api/v1/me`(EP-AUTH-02 ·
     * 길이·공백 검사)만 바꾸고, 이 경로는 닫는다(404).
     */
    disabledPaths: ['/update-user'],
    emailAndPassword: {
      enabled: true,
      // **강제한다**(2026-09-22 사람 결정). 다만 강제는 메일을 보낼 수 있을 때만 성립하므로
      // 기본값을 SMTP 에서 유도한다 — 판정은 `mail.config.ts` 한 곳이고, 메일 없이 켜 둔
      // 배치는 기동 단계에서 이미 거부됐다(`assertMailConfig`).
      requireEmailVerification: requireEmailVerificationFromEnv(),
      minPasswordLength: PASSWORD_MIN_LENGTH,
      /*
       * **비밀번호를 잊었을 때**(2026-09-25 — 사람 결정 D10 · REQ-API-187). 메일을 보낼 수 있을 때만 켠다 — 켜지
       * 않으면 인증 스택이 `/request-password-reset` 에 400 `RESET_PASSWORD_DISABLED` 로 답하고, 화면은 그 코드를
       * 보고 "운영자에게 문의" 를 말한다. 켜 놓고 메일만 조용히 버리면 사람은 오지 않을 메일을 기다린다.
       *
       * 응답은 **계정이 있든 없든 같다** — 인증 스택이 없는 주소에도 토큰을 만드는 척하고 같은 문장을 돌려준다.
       * 우리 쪽 콜백은 아웃박스에 INSERT 하나라 응답 시간도 갈리지 않는다(가입 확인과 같은 까닭 — 4.3 §2.17).
       */
      ...(mail !== undefined && mailEnabled()
        ? {
            sendResetPassword: async ({ user, token }, request): Promise<void> => {
              await mail.enqueueResetPassword({
                email: user.email,
                name: user.name,
                token,
                locale: localeOf(request),
              });
            },
          }
        : {}),
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TTL_MINUTES * 60,
      // 재설정은 "누가 내 비밀번호를 안다" 의 답이기도 하다 — 이 브라우저를 포함해 **모든** 세션을 끊는다.
      // 바꾸기(`/change-password`)와 달리 여기는 로그인한 브라우저가 없다: 새 비밀번호로 다시 들어온다.
      revokeSessionsOnPasswordReset: true,
      /*
       * 메일의 링크로 비밀번호를 정했다는 것은 **그 메일함이 이 사람의 것**이라는 증명이다 — 확인 링크를 연 것과
       * 같다. 확인하지 않은 채 비밀번호를 잊은 사람이 재설정을 마치고도 "이메일을 아직 확인하지 않았습니다" 에
       * 막혀 메일을 한 통 더 기다리지 않게 한다.
       */
      onPasswordReset: async ({ user }): Promise<void> => {
        await pool.query(
          `UPDATE "user" SET email_verified = true, updated_at = now()
            WHERE id = $1 AND email_verified = false`,
          [user.id],
        );
      },
    },
    emailVerification: {
      // 가입하면 바로 나간다 — 따로 누를 것을 두지 않는다
      sendOnSignUp: true,
      // 확인한 사람을 다시 로그인시키지 않는다. 링크를 연 브라우저가 곧 그 사람이다.
      autoSignInAfterVerification: true,
      // 확인 링크의 수명 — 가입 확인과 이메일 바꾸기의 두 링크가 같은 값이다(인증 스택의 기본값과 같은 60분)
      expiresIn: EMAIL_VERIFY_TTL_MINUTES * 60,
      sendVerificationEmail: async ({ user, url, token }, request): Promise<void> => {
        /*
         * **이메일 바꾸기의 둘째 단계도 이 콜백을 지난다**(2026-10-15 · REQ-API-310). 옛 주소가 승인하면 인증 스택이 새
         * 주소의 확인 링크를 이 자리로 보낸다(`user.email` 은 이미 새 주소다). 대기 줄을 이 링크로 갈아 끼우면 승인 링크는
         * 다시 쓰이지 않는다. 지금 이메일을 확인하지 않은 사람은 옛 주소의 승인 없이 곧바로 여기로 온다 — 확인하지 않은
         * 주소의 승인은 아무것도 증명하지 못한다.
         */
        const claim = await changeEmailClaim(token, authSecret);
        if (claim !== null && claim.stage === 'confirm') {
          await recordPending(pool, {
            userId: user.id,
            newEmail: claim.updateTo,
            stage: 'confirm',
            token,
          });
          await mail?.enqueueChangeEmailConfirm({
            email: claim.updateTo,
            name: user.name,
            token,
            userId: user.id,
            locale: localeOf(request),
          });
          return;
        }
        // **기다리지 않는다.** better-auth 문서 자신이 그렇게 적는다 — 발송을 await 하면
        // 응답 시간이 "그 이메일이 존재하는가" 를 흘린다. 우리는 애초에 보내지 않고
        // 줄만 세우므로(§2.17) 이 호출은 INSERT 하나다.
        await mail?.enqueueVerifyEmail({
          email: user.email,
          name: user.name,
          token,
          locale: localeOf(request),
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
      /*
       * **이메일 바꾸기**(2026-10-15 · 사람 결정 · REQ-API-310). 인증 스택의 두 단계 흐름을 쓴다 — 옛 주소가 승인하고
       * (`sendChangeEmailConfirmation`) 새 주소가 확인하면 바뀐다. 확인하지 않은 주소를 곧바로 바꾸는 길
       * (`updateEmailWithoutVerification`)은 켜지 않는다. 인증 스택에 없는 보장(지금 비밀번호 · 사람마다 한도 · 링크 한 번 ·
       * 다른 로그인 끊기 · 옛 주소로 알림 · 로그인하지 않은 브라우저에 세션을 남기지 않기)은 아래 `hooks` 가 메운다.
       */
      changeEmail: changeEmailOn
        ? {
            enabled: true,
            sendChangeEmailConfirmation: async (
              { user, newEmail, token },
              request,
            ): Promise<void> => {
              await recordPending(pool, { userId: user.id, newEmail, stage: 'approve', token });
              await mail?.enqueueChangeEmailApprove({
                email: user.email,
                name: user.name,
                newEmail,
                token,
                userId: user.id,
                locale: localeOf(request),
              });
            },
          }
        : { enabled: false },
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!changeEmailOn) return;
        if (ctx.path === '/change-email') {
          /*
           * **요청 — 지금 비밀번호를 다시 묻는다.** 인증 스택은 세션만 보므로, 열어 둔 브라우저를 잠깐 쓴 사람이 계정의
           * 주소를 가져갈 수 있었다. 사람마다 1분에 로그인과 같은 횟수까지 센다 — 인증 스택의 한도는 IP 로만 센다.
           * 세션이 없으면 아무것도 하지 않는다(인증 스택이 401 로 답한다).
           */
          const session = await getSessionFromCtx(ctx);
          if (session === null) return;
          if (!(await hitAttempt(pool, session.user.id))) {
            throw APIError.from('TOO_MANY_REQUESTS', {
              code: 'TOO_MANY_REQUESTS',
              message: 'Too many requests. Please try again later.',
            });
          }
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const password = typeof body['password'] === 'string' ? body['password'] : '';
          const account = await ctx.context.internalAdapter.findCredentialAccount(session.user.id);
          const hash = account?.password ?? null;
          if (
            password === '' ||
            hash === null ||
            !(await ctx.context.password.verify({ hash, password }))
          ) {
            throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_PASSWORD);
          }
          /*
           * **이미 쓰는 주소에도 같은 답을 한다.** 인증 스택은 그 경우 메일 없이 같은 200 을 준다. 대기 줄도 같은 모양으로
           * 남겨(아무도 갖지 않은 토큰의 지문) 내 계정의 진행 상태(EP-AUTH-06)가 그 차이를 드러내지 않게 한다.
           */
          const newEmail =
            typeof body['newEmail'] === 'string' ? body['newEmail'].toLowerCase() : '';
          if (
            newEmail !== '' &&
            newEmail !== session.user.email.toLowerCase() &&
            (await ctx.context.internalAdapter.findUserByEmail(newEmail)) !== null
          ) {
            await recordPending(pool, {
              userId: session.user.id,
              newEmail,
              stage: session.user.emailVerified ? 'approve' : 'confirm',
              token: newId(),
            });
          }
          return;
        }
        if (ctx.path === '/verify-email') {
          /*
           * **링크 — 지금 살아 있는 그 링크만 받는다.** 인증 스택의 토큰은 서명만 보는 JWT 라 60분 안에서는 몇 번이고 다시
           * 쓸 수 있다. 대기 줄과 대조해(같은 새 주소 · 같은 단계 · 같은 토큰) 한 번만, 그리고 가장 새 요청의 것만 받는다.
           * 가입 확인 링크와 서명이 틀린 토큰은 그대로 인증 스택에 맡긴다.
           */
          const query = (ctx.query ?? {}) as Record<string, unknown>;
          const token = query['token'];
          const claim = await changeEmailClaim(token, authSecret);
          if (claim === null || typeof token !== 'string') return;
          const reject = (code: string): never => {
            const back = typeof query['callbackURL'] === 'string' ? query['callbackURL'] : '';
            // 돌아갈 곳은 화면뿐이다 — 링크의 쿼리를 고쳐 다른 호스트로 보내게 두지 않는다
            if (back !== '' && sameOrigin(back, webUrlFromEnv())) {
              throw ctx.redirect(withError(back, code));
            }
            throw APIError.from('UNAUTHORIZED', { code, message: 'Invalid token' });
          };
          if (claim.stage === 'legacy') return reject('INVALID_TOKEN');
          const owner = await ctx.context.internalAdapter.findUserByEmail(claim.email);
          // 이미 바뀌었거나 없는 계정이다 — 인증 스택이 USER_NOT_FOUND 로 답한다
          if (owner === null) return;
          const pending = await readPending(pool, owner.user.id);
          if (!matchesPending(pending, { newEmail: claim.updateTo, stage: claim.stage, token })) {
            return reject('INVALID_TOKEN');
          }
          // 그사이 새 주소를 다른 계정이 차지했으면 끝까지 갈 수 없다 — 그대로 두면 인증 스택이 고유 제약에 걸려 500 이 된다
          if ((await ctx.context.internalAdapter.findUserByEmail(claim.updateTo)) !== null) {
            await dropPending(pool, owner.user.id);
            return reject('INVALID_TOKEN');
          }
          return;
        }
        return;
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!changeEmailOn || ctx.path !== '/verify-email') return;
        /*
         * **바뀐 뒤 — 인증 스택이 하지 않는 셋.** ① 다른 로그인을 모두 끊는다(이 링크를 연 브라우저가 이미 그 사람으로
         * 로그인해 있었다면 그것만 남는다). ② 로그인하지 않은 브라우저에서 열었으면 인증 스택이 방금 만든 세션도 지우고
         * 쿠키를 비운다 — 새 주소의 메일함을 연 사람이 그대로 로그인되지 않게 한다. ③ 옛 주소로 알림을 보낸다.
         */
        const query = (ctx.query ?? {}) as Record<string, unknown>;
        const token = query['token'];
        const claim = await changeEmailClaim(token, authSecret);
        if (claim === null || claim.stage !== 'confirm' || typeof token !== 'string') return;
        const changed = await ctx.context.internalAdapter.findUserByEmail(claim.updateTo);
        if (changed === null) return;
        const userId = changed.user.id;
        // 이 요청이 바꾼 것인가 — 대기 줄을 지운 쪽만 마무리한다(같은 링크가 동시에 두 번 열려도 한 번)
        if (!(await consumePending(pool, { userId, newEmail: claim.updateTo, token }))) return;
        const before = await getSessionFromCtx(ctx).catch(() => null);
        const keep = before !== null && before.user.id === userId ? before.session.id : null;
        const revoked = await pool.query(
          `DELETE FROM auth_session WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
          [userId, keep],
        );
        if (keep === null) deleteSessionCookie(ctx);
        await mail?.enqueueEmailChanged({
          email: claim.email,
          name: changed.user.name,
          newEmail: claim.updateTo,
          userId,
          locale: localeOf(ctx.request),
        });
        // 운영자가 보는 한 줄 — 주소는 적지 않는다(누구의 것인지는 id 로 충분하다)
        log.log(
          `사용자 ${userId}의 이메일을 바꿨다 — 다른 로그인 ${revoked.rowCount ?? 0}개를 끊었다`,
        );
      }),
    },
  });
}

/** 같은 오리진인가 — 깨진 주소는 아니다 */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
