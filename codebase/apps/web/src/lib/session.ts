// 세션·인증 클라이언트 — better-auth 핸들러(`/api/auth/*`)의 웹 쪽 짝 (screens.md §2.1)
//
// **토큰을 자바스크립트가 들지 않는다.** 세션은 HttpOnly 쿠키이고 이 파일은 그것을 만들거나
// 지우는 요청만 보낸다 — XSS 가 나도 세션을 훔쳐갈 손잡이가 없어야 한다(api.md §1.3).

import type { MessageKey, Translator } from '@nerv/schema';
import { apiFetch } from './api.js';

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
}

async function authFetch(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
}): Promise<AuthFailure | null> {
  const res = await authFetch('/sign-up/email', input);
  if (res.ok) return null;
  return failure(res);
}

export async function signOut(): Promise<void> {
  await authFetch('/sign-out', {});
}

async function failure(res: Response): Promise<AuthFailure> {
  try {
    const body = (await res.json()) as { message?: string; code?: string };
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

/** 첫 화면 계산에 쓸 멤버십 하나를 고른다 — 프로젝트 소속이 있는 것을 우선한다. */
export function primaryMembership(me: Me): Membership | null {
  return me.memberships.find((m) => m.project_slug !== null) ?? me.memberships[0] ?? null;
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
