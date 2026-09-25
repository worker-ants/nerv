// 세션·인증 클라이언트 — better-auth 핸들러(`/api/auth/*`)의 웹 쪽 짝 (screens.md §2.1)
//
// **토큰을 자바스크립트가 들지 않는다.** 세션은 HttpOnly 쿠키이고 이 파일은 그것을 만들거나
// 지우는 요청만 보낸다 — XSS 가 나도 세션을 훔쳐갈 손잡이가 없어야 한다(api.md §1.3).

import type { MessageKey, Translator } from '@nerv/schema';
import { apiFetch } from './api.js';
import { apiBase } from './config.js';
import { acceptLanguageHeader } from './i18n.js';

export interface Membership extends Record<string, unknown> {
  id: string;
  /** 겸직은 **집합**이다 — 하나를 고르면 절반이 사라진다(0003_multi_role) */
  roles: string[];
  org_id: string;
  org_slug: string;
  org_name: string;
  project_id: string | null;
  project_slug: string | null;
  project_name: string | null;
}

export interface Me extends Record<string, unknown> {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  memberships: Membership[];
}

export async function fetchMe(): Promise<Me> {
  return apiFetch<Me>('/me');
}

type AuthMessageKey = MessageKey & `auth.${string}`;

export interface AuthFailure {
  /**
   * 서버가 준 문장. better-auth 가 자기 문구를 보내는 경우가 있고(로케일 협상 밖이다),
   * 그때는 우리 카탈로그로 갈아끼우지 않는다 — 사유를 지우는 것보다 낫다.
   */
  message?: string;
  /** 우리가 만든 문구. 화면이 로케일을 알 때 문장이 된다 */
  key?: AuthMessageKey;
  /**
   * **이메일을 아직 확인하지 않았다**(2026-09-22). 다른 실패와 갈라 두는 이유는 사람이 할 일이
   * 다르기 때문이다 — 비밀번호가 틀린 사람은 다시 치면 되지만, 이 사람은 메일함을 열거나
   * 다시 보내야 한다. 같은 "로그인 실패" 로 뭉뚱그리면 영영 들어오지 못한다.
   */
  unverified?: true;
}

async function authFetch(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${apiBase()}/api/auth${path}`, {
    method: 'POST',
    // 화면의 언어를 싣는다 — 가입 확인·재설정 메일이 이 값으로 쓰인다(2026-09-25). 브라우저가 스스로 싣는 값은
    // 브라우저의 언어라, 로그인 화면에서 언어를 바꾼 사람(REQ-WEB-230)이 다른 말로 된 메일을 받았다.
    headers: { 'content-type': 'application/json', 'accept-language': acceptLanguageHeader() },
    credentials: 'include',
    body: JSON.stringify(body),
  });
}

/** 실패 사유는 폼 인라인으로 돌려준다 — 전역 토스트가 아니다(REQ-WEB-005). */
export async function signIn(input: {
  email: string;
  password: string;
}): Promise<AuthFailure | null> {
  const res = await authFetch('/sign-in/email', input);
  if (res.ok) return null;
  return failure(res);
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  /** 확인 메일의 링크가 끝나고 돌아올 **화면 경로**(`/invite/…`·`/onboarding`) */
  returnPath: string;
}): Promise<AuthFailure | null> {
  const { returnPath, ...body } = input;
  const res = await authFetch('/sign-up/email', { ...body, callbackURL: returnUrl(returnPath) });
  if (res.ok) return null;
  return failure(res);
}

/**
 * 확인 메일의 링크가 끝나고 돌아올 주소 — **화면 오리진의 절대 주소**다.
 *
 * 상대 경로로 보내면 better-auth 가 그것을 **API 호스트** 기준으로 읽는다(확인은 API 가
 * 한다). 서버도 화면 오리진 밖은 버리지만(`verify-link.ts`), 보내는 쪽이 처음부터 맞게 싣는다.
 *
 * 돌아올 자리를 싣는 이유(2026-09-24 — 사람 보고): 전에는 언제나 `/` 였다. 초대로 가입한
 * 사람이 초대 화면으로 돌아가지 못했고(REQ-WEB-089), 소속이 없는 사람은 빈 홈에 섰다.
 */
function returnUrl(path: string): string {
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 인증 메일을 다시 보낸다(2026-09-22).
 *
 * **성공과 실패를 가르지 않는다** — 없는 주소에 대해 "그런 계정 없습니다" 라고 답하면 그것이
 * 곧 계정 존재 확인기가 된다. 화면은 언제나 "보냈습니다" 로 말하고, 한도는 서버가 건다.
 */
export async function resendVerification(email: string, returnPath: string): Promise<void> {
  // 처음 메일과 **같은 자리**로 돌아온다 — 다시 받은 메일이 다른 곳으로 보내면 안 된다
  await authFetch('/send-verification-email', { email, callbackURL: returnUrl(returnPath) });
}

/**
 * 비밀번호를 바꾼다 — 인증 스택의 `/change-password`(2026-09-25 · REQ-API-186 · REQ-WEB-229). 지금 비밀번호를
 * 맞혀야 하고, `revokeOthers` 면 다른 기기의 세션을 모두 끊는다(이 브라우저는 새 쿠키를 받아 남는다).
 * 실패는 폼 인라인으로 돌려준다 — 사유마다 사람이 할 일이 다르다.
 */
export async function changePassword(input: {
  current: string;
  next: string;
  revokeOthers: boolean;
}): Promise<AuthFailure | null> {
  const res = await authFetch('/change-password', {
    currentPassword: input.current,
    newPassword: input.next,
    revokeOtherSessions: input.revokeOthers,
  });
  if (res.ok) return null;
  if (res.status === 429) return { key: 'auth.too_many' };
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code === 'INVALID_PASSWORD') return { key: 'auth.password_wrong' };
    if (body.code === 'PASSWORD_TOO_SHORT') return { key: 'auth.password_too_short' };
    return body.message === undefined ? { key: 'auth.sign_in_failed' } : { message: body.message };
  } catch {
    return { key: 'auth.sign_in_failed' };
  }
}

/**
 * 비밀번호 재설정 메일을 부탁한다(2026-09-25 · REQ-API-187 · REQ-WEB-231).
 *
 * **보냈다와 계정이 없다를 가르지 않는다** — 서버가 같은 답을 하고, 화면도 같은 문장으로 말한다. 가르는 것은
 * 사람이 할 일이 달라지는 둘뿐이다: 메일이 꺼진 배치(`disabled` — 기다려도 오지 않는다)와 한도.
 */
export async function requestPasswordReset(
  email: string,
): Promise<'sent' | 'disabled' | AuthFailure> {
  const res = await authFetch('/request-password-reset', { email });
  if (res.ok) return 'sent';
  if (res.status === 429) return { key: 'auth.too_many' };
  const body = await readBody(res);
  if (body.code === 'RESET_PASSWORD_DISABLED') return 'disabled';
  return body.message === undefined ? { key: 'auth.request_failed' } : { message: body.message };
}

/**
 * 메일의 링크로 새 비밀번호를 정한다(2026-09-25 · REQ-API-187). 서버가 이 사람의 **모든** 세션을 끊는다 — 여기서
 * 로그인하지 않는다. `invalid` 는 만료됐거나 이미 쓴 링크다: 비밀번호를 다시 치는 것이 아니라 새 링크가 답이다.
 */
export async function resetPassword(input: {
  token: string;
  next: string;
}): Promise<'ok' | 'invalid' | AuthFailure> {
  const res = await authFetch('/reset-password', { token: input.token, newPassword: input.next });
  if (res.ok) return 'ok';
  if (res.status === 429) return { key: 'auth.too_many' };
  const body = await readBody(res);
  if (body.code === 'INVALID_TOKEN') return 'invalid';
  if (body.code === 'PASSWORD_TOO_SHORT') return { key: 'auth.password_too_short' };
  return body.message === undefined ? { key: 'auth.request_failed' } : { message: body.message };
}

async function readBody(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    return (await res.json()) as { code?: string; message?: string };
  } catch {
    return {};
  }
}

/** 표시 이름을 바꾼다 — EP-AUTH-02(REQ-API-186). 바뀐 `me` 를 돌려받는다 */
export async function updateDisplayName(displayName: string): Promise<Me> {
  return apiFetch<Me>('/me', { method: 'PATCH', body: { display_name: displayName } });
}

export async function signOut(): Promise<void> {
  await authFetch('/sign-out', {});
}

async function failure(res: Response): Promise<AuthFailure> {
  // 한도는 우리 말로 — 인증 스택의 문구("Too many requests…")는 로케일 협상 밖이다(api.md §1.8). 로그인·가입은
  // 이 줄이 없어 영어 한 줄을 보였다(2026-09-25 E2E 실측 — 내 계정의 비밀번호 바꾸기만 옮기고 있었다)
  if (res.status === 429) return { key: 'auth.too_many' };
  try {
    const body = (await res.json()) as { message?: string; code?: string };
    // 미확인 계정은 **자격증명 오류가 아니다** — 화면이 다른 길을 줘야 한다(재발송).
    if (body.code === 'EMAIL_NOT_VERIFIED') {
      return { key: 'auth.email_unverified', unverified: true };
    }
    // better-auth 의 영문 코드를 그대로 노출하지 않는다 — 사용자가 읽을 문장이어야 한다.
    if (res.status === 401 || res.status === 403) return { key: 'auth.bad_credentials' };
    return body.message === undefined ? { key: 'auth.sign_in_failed' } : { message: body.message };
  } catch {
    return { key: 'auth.sign_in_failed' };
  }
}

/** 실패를 문장으로 — 화면이 로케일을 알 때 부른다 */
export function authFailureText(t: Translator, value: AuthFailure): string {
  return value.message ?? t(value.key ?? 'auth.sign_in_failed');
}

/**
 * 역할별 첫 화면 — ui-wireframes §1.5. qa 는 MVP 에서 커버리지(S6, Phase 2)가 아니라
 * 작업 보드로 보낸다(screens.md §2.1 각주 4).
 */
export function landingFor(roles: readonly string[], projectSlug: string | null): string {
  if (projectSlug === null) return '/inbox';
  // **겸직이면 앞선 역할을 따른다.** planner+developer 는 받은 요청으로 보낸다 — 사람이
  // 기다리는 결정이 있는 쪽이 먼저다. 아래 switch 의 순서가 그 우선순위다.
  for (const role of ['admin', 'planner', 'designer', 'qa', 'developer', 'viewer']) {
    if (roles.includes(role)) return landingForOne(role);
  }
  return landingForOne('viewer');

  function landingForOne(role: string): string {
    switch (role) {
      case 'planner':
      case 'designer':
      case 'admin':
        return '/inbox';
      case 'developer':
      case 'qa':
        return `/p/${projectSlug}/tasks`;
      default:
        return `/p/${projectSlug}`;
    }
  }
}

/**
 * 첫 화면 계산에 쓸 멤버십 하나를 고른다 — 프로젝트 소속이 있는 것을 우선한다.
 *
 * **기억된 조직이 먼저다**(2026-09-24 · NAV-09 · REQ-WEB-212). 조직과 무관하게 첫 프로젝트 멤버십을
 * 고르면, 지난번에 B 조직을 보던 사람이 로그인하자마자 A 조직의 작업 보드에 섰다 — 헤더는 B 를,
 * 본문은 A 를 말했다. 그 조직에 소속이 없을 때만 전체에서 고른다.
 */
export function primaryMembership(me: Me, preferOrg: string | null = null): Membership | null {
  const inOrg = preferOrg === null ? [] : me.memberships.filter((m) => m.org_slug === preferOrg);
  return (
    inOrg.find((m) => m.project_slug !== null) ??
    inOrg[0] ??
    me.memberships.find((m) => m.project_slug !== null) ??
    me.memberships[0] ??
    null
  );
}

/**
 * 한 조직에서 내가 가진 역할 **전부**.
 *
 * `primaryMembership` 은 프로젝트 소속 멤버십을 먼저 고르는데, 조직 단위 권한을 그걸로
 * 판정하면 **조직 admin 인데 프로젝트에서는 planner 인 사람이 admin 이 아니게 된다**
 * (실측 2026-08-24 — 조직 설정 화면이 그렇게 잠겼다). 겸직은 합집합이라는 규칙(0003)이
 * 여기에도 그대로 적용된다: 조직 안의 모든 멤버십을 합쳐 본다.
 */
export function rolesInOrg(me: Me | undefined, orgSlug: string | null): string[] {
  if (me === undefined || orgSlug === null) return [];
  const out = new Set<string>();
  for (const m of me.memberships) {
    if (m.org_slug !== orgSlug) continue;
    for (const role of m.roles) out.add(role);
  }
  return [...out];
}

/**
 * 한 **프로젝트**에서 내가 가진 역할 전부 — 서버의 `assertMembership` 과 같은 규칙이다.
 *
 * 프로젝트 소속 멤버십과 **조직 소속 멤버십(`project_slug === null`)을 합친다.** 한
 * 행만 보면 조직 단위로만 소속된 admin 이 어느 프로젝트에서도 아무 역할이 없는 사람이
 * 된다 — 스펙 메타 편집이 "planner·admin 만 가능합니다"로 잠겨 있던 원인이 그것이었다
 * (실측 2026-08-24). 서버는 이미 합집합으로 판정하고 있었으므로, 화면이 **서버가 허용할
 * 일을 못 한다고 말하고 있었다**. 권한 판정이 화면과 서버에서 갈라지면 사람은 화면을
 * 믿는다.
 *
 * 조직도 함께 본다: 다른 조직의 조직 단위 역할이 이 프로젝트로 새면 안 된다.
 */
export function rolesInProject(
  me: Me | undefined,
  orgSlug: string | null,
  projectSlug: string | null,
): string[] {
  if (me === undefined || orgSlug === null) return [];
  const out = new Set<string>();
  for (const m of me.memberships) {
    if (m.org_slug !== orgSlug) continue;
    if (m.project_slug !== null && m.project_slug !== projectSlug) continue;
    for (const role of m.roles) out.add(role);
  }
  return [...out];
}

/**
 * 이 범위의 멤버십·초대를 다룰 수 있는가 — 서버 `AuthService.assertCanManageScope` 와 **같은 규칙**
 * 이다(REQ-API-169 · REQ-WEB-075: 화면은 서버가 허용할 것을 미리 말한다).
 *
 * **조직 전체 범위는 조직 admin 만**(2026-09-24 사람 결정). 조직 admin 은 조직 단위
 * (`project_slug === null`) admin 멤버십을 가진 사람이고, 프로젝트 범위는 조직 admin 또는 그
 * 프로젝트의 admin 이다. `rolesInOrg` 로 판정하면 한 프로젝트의 admin 이 조직 전체 줄까지
 * 편집 가능하게 보인다 — 예전 화면과 서버가 그랬다.
 */
export function canManageScope(
  me: Me | undefined,
  orgSlug: string | null,
  projectSlug: string | null,
): boolean {
  if (me === undefined || orgSlug === null) return false;
  return me.memberships.some(
    (m) =>
      m.org_slug === orgSlug &&
      m.roles.includes('admin') &&
      (m.project_slug === null || (projectSlug !== null && m.project_slug === projectSlug)),
  );
}
