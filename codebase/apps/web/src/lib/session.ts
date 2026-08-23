// 세션·인증 클라이언트 — better-auth 핸들러(`/api/auth/*`)의 웹 쪽 짝 (screens.md §2.1)
//
// **토큰을 자바스크립트가 들지 않는다.** 세션은 HttpOnly 쿠키이고 이 파일은 그것을 만들거나
// 지우는 요청만 보낸다 — XSS 가 나도 세션을 훔쳐갈 손잡이가 없어야 한다(api.md §1.3).

import type { MessageKey, Translator } from '@nerv/schema';
import { apiFetch } from './api.js';

export interface Membership extends Record<string, unknown> {
  id: string;
  role: string;
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
export function landingFor(role: string, projectSlug: string | null): string {
  if (projectSlug === null) return '/inbox';
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

/** 첫 화면 계산에 쓸 멤버십 하나를 고른다 — 프로젝트 스코프가 있는 것을 우선한다. */
export function primaryMembership(me: Me): Membership | null {
  return me.memberships.find((m) => m.project_slug !== null) ?? me.memberships[0] ?? null;
}
