// 지금 보고 있는 소속 — 조직과 프로젝트
//
// **한 곳에서만 정한다.** 화면마다 "내 멤버십에서 프로젝트를 하나 고른다"를 다시 쓰면
// 그때마다 조금씩 다르게 틀린다 — 실제로 그렇게 됐다(2026-08-24 실측): 설정의 게이트·토큰
// 탭은 멤버십 한 행의 `project_slug` 를 썼고, 조직 단위 멤버십만 가진 admin 은 그 값이
// `null` 이라 **자기 조직의 게이트 정책을 못 열고 토큰도 못 만들었다**.
//
// 규칙은 헤더의 select 두 개와 같다: 조직은 내가 속한 첫 곳, 프로젝트는 **라우트 → 마지막으로
// 본 것 → 첫 프로젝트** 순이다.

import { useEffect, useMemo, useState } from 'react';
import { rows, useMe, useProjects } from './queries.js';
import { rolesInProject } from './session.js';

export interface Scope {
  orgSlug: string | null;
  orgName: string | null;
  /** 이 조직의 프로젝트 목록(보관 제외) — 헤더 select 가 그리는 것과 같은 값이다 */
  projects: Record<string, unknown>[];
  projectSlug: string | null;
  project: Record<string, unknown> | undefined;
}

/**
 * @param routeProjectSlug 라우트가 아는 프로젝트. **라우트가 알면 라우트가 정본이다** —
 *   주소로 들어온 화면에서 기억된 값이 이기면 화면과 주소가 어긋난다.
 */
export function useScope(routeProjectSlug?: string | undefined): Scope {
  const me = useMe();

  // 멤버십에서 조직을 뽑는다: 고를 수 있는 곳만 목록에 있다는 사실이 목록 자체로 드러난다
  const orgs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of me.data?.memberships ?? []) seen.set(m.org_slug, m.org_name);
    return [...seen].map(([slug, name]) => ({ slug, name }));
  }, [me.data]);
  // **고른 조직을 기억한다.** 2026-09-06 까지 여기가 `orgs[0]` 고정이라, 조직이 둘인
  // 사용자가 헤더에서 두 번째를 고르면 `/o/:org` 가 홈으로 보내고 홈은 다시 첫 조직을
  // 그렸다 — **아무 일도 일어나지 않은 것처럼 보였다**(screens.md:151 대조).
  const rememberedOrg = useLastOrg();
  const currentOrg = orgs.find((o) => o.slug === rememberedOrg) ?? orgs[0] ?? null;

  const projects = rows(useProjects(currentOrg?.slug ?? null).data);
  const remembered = useLastProject(routeProjectSlug);
  const projectSlug =
    routeProjectSlug ??
    (projects.some((p) => p['slug'] === remembered) ? remembered : null) ??
    (typeof projects[0]?.['slug'] === 'string' ? String(projects[0]['slug']) : null);

  return {
    orgSlug: currentOrg?.slug ?? null,
    orgName: currentOrg?.name ?? null,
    projects,
    projectSlug,
    project: projects.find((p) => p['slug'] === projectSlug),
  };
}

/**
 * 이 세션에 개입할 수 있는가 — **세션 소유자와 admin 뿐이다**(EP-SES-04 · api.md §2.5).
 *
 * §1.8("화면은 서버가 허용할 것을 미리 말한다")이 요구하는 자리다. 2026-09-06 까지 steer
 * 패널은 누구에게나 활성이었고, 남의 세션에 **중단 사유까지 적은 뒤** 403 을 받았다.
 *
 * 역할은 `rolesInProject` 가 판정한다 — 조직 단위 멤버십까지 합집합으로 보는 그 규칙을
 * 여기서 다시 쓰면 그때마다 조금씩 다르게 틀린다(이 파일 머리말이 적은 그 사고다).
 */
export function useCanIntervene(projectSlug: string | null, sessionUserId: unknown): boolean {
  const me = useMe();
  const { orgSlug } = useScope(projectSlug ?? undefined);
  if (rolesInProject(me.data, orgSlug, projectSlug).includes('admin')) return true;
  return typeof sessionUserId === 'string' && sessionUserId === me.data?.id;
}

/**
 * 마지막으로 본 프로젝트를 기억한다.
 *
 * 홈·받은 요청·알림·설정은 조직 전역이라 라우트에 프로젝트가 없다. 기억이 없으면 그 화면들에서
 * 헤더의 프로젝트 칸이 매번 비고, **빈 칸은 "선택할 수 없다"로 읽힌다** — 실제로는 고를
 * 수 있는데도.
 *
 * localStorage 가 막힌 환경(사파리 프라이빗 등)에서도 화면은 그대로 돌아야 한다 —
 * 읽기·쓰기 모두 실패를 삼키고 `null` 로 떨어진다.
 */
const LAST_PROJECT_KEY = 'nerv.last-project';
const LAST_ORG_KEY = 'nerv.last-org';

/**
 * 고른 조직을 적어 둔다 — `/o/:org` 가 부른다.
 *
 * 조직 전환은 화면이 없다(§1.6: "컨텍스트만 바꾸고 홈으로"). 그 컨텍스트를 어디에도
 * 적지 않으면 전환은 리다이렉트만 남고 **바뀐 것이 없다.**
 */
export function rememberOrg(slug: string): void {
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // 기억하지 못해도 화면은 돈다 — 첫 조직으로 떨어질 뿐이다
  }
}

function useLastOrg(): string | null {
  const [remembered] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_ORG_KEY);
    } catch {
      return null;
    }
  });
  return remembered;
}

function useLastProject(projectSlug: string | undefined): string | null {
  const [remembered, setRemembered] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_PROJECT_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (projectSlug === undefined || projectSlug === remembered) return;
    setRemembered(projectSlug);
    try {
      localStorage.setItem(LAST_PROJECT_KEY, projectSlug);
    } catch {
      // 기억하지 못해도 화면은 돈다 — 라우트가 아는 동안은 라우트가 정본이다
    }
  }, [projectSlug, remembered]);

  return remembered;
}
