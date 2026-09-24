// /p/:proj — 프로젝트 셸. 멤버십 가드와 project:{id} 룸 join 이 여기 붙는다(E08-S03).
// 프로젝트 탭·스펙 트리는 앱 셸의 사이드바가 렌더한다(screens.md §1.3).
//
// **join 이 여기 있어야 하는 이유**(2026-08-29 정정): 예전에는 개요·세션 두 화면만 각자
// join 했다. 그래서 스펙 목록·스펙 상세에 있는 동안에는 `project:{id}` 이벤트가 아예
// 도착하지 않았고, 사이드바 트리도 마찬가지였다 — 에이전트가 스펙을 만들어도 새로고침
// 전에는 알 수 없었다. 룸은 **화면이 아니라 프로젝트에 속한다.**
//
// **열 수 없는 프로젝트는 여기서 말한다**(2026-09-24 · REQ-WEB-199). 예전에는 프로젝트를
// 불러오지 못해도 아래 화면을 그대로 그려, 오타 난 주소나 멤버가 아닌 프로젝트가 **방금 만든
// 빈 프로젝트**처럼 보였다. 조직이 다른 프로젝트의 주소(다른 조직의 알림·붙여넣은 링크)도
// 같은 모양으로 막혔다 — 조직은 주소가 아니라 기억에 있어서, 서버는 지금 조직 안에서만 찾는다.
import {
  createFileRoute,
  Link,
  Navigate,
  Outlet,
  useParams,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  ErrorState,
  NotFoundState,
  isNotFound,
  isNotMember,
} from '../../components/query-state.js';
import { useT } from '../../lib/i18n.js';
import { useMe, useProject } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { useScope } from '../../lib/scope.js';
import type { Membership } from '../../lib/session.js';

function ProjectShell(): React.JSX.Element {
  const { proj } = useParams({ from: '/p/$proj' });
  const project = useProject(proj);
  const { joinProject } = useRealtime();
  const projectId = project.data?.['id'];

  useEffect(() => {
    if (typeof projectId !== 'string') return;
    // slug 는 토스트가 문서 링크를 만들 때 쓴다 — 봉투는 id 만 싣는다(REQ-WEB-197)
    return joinProject(projectId, proj);
  }, [joinProject, projectId, proj]);

  if (project.isError && project.data === undefined) {
    return (
      <ProjectUnavailable slug={proj} error={project.error} retry={() => void project.refetch()} />
    );
  }
  return <Outlet />;
}

/**
 * 다른 조직에서 이 slug 를 가진 곳 — 정확히 그 프로젝트의 멤버십이 먼저고, 조직 전체
 * 멤버십(프로젝트를 가리지 않는다)은 그 조직에 있을 **수도** 있는 후보다.
 */
export function orgCandidates(
  memberships: readonly Membership[],
  slug: string,
  currentOrg: string | null,
): { exact: Membership[]; maybe: Membership[] } {
  const others = memberships.filter((m) => m.org_slug !== currentOrg);
  const uniq = (list: Membership[]): Membership[] =>
    list.filter((m, i) => list.findIndex((o) => o.org_slug === m.org_slug) === i);
  const exact = uniq(others.filter((m) => m.project_slug === slug));
  const maybe = uniq(
    others.filter(
      (m) =>
        (m.project_slug === null || m.project_slug === undefined) &&
        !exact.some((e) => e.org_slug === m.org_slug),
    ),
  );
  return { exact, maybe };
}

function ProjectUnavailable({
  slug,
  error,
  retry,
}: {
  slug: string;
  error: unknown;
  retry: () => void;
}): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const { orgSlug } = useScope();
  // 조직을 바꾼 뒤 **이 자리로** 돌아온다 — 쿼리·뷰 상태까지(알림이 짚은 코멘트 레일 같은 것).
  // **처음 선 자리를 한 번만 잡는다.** 전환으로 옮겨 가는 동안 이 컴포넌트는 잠깐 더 그려지는데,
  // 그때 지금 주소를 읽으면 그것은 이미 `/o/…?next=…` 라서 착지할 자리가 전환 주소 자신이 되고,
  // 그 주소로 다시 전환하는 고리가 끝없이 돈다(L1 에서 실측 — 메모리가 바닥났다).
  const router = useRouter();
  const [here] = useState(() => router.state.location.href);
  const home = (
    <Link to="/" className="text-sm text-link">
      {t('state.go_home')}
    </Link>
  );

  if (isNotMember(error)) {
    return (
      <NotFoundState
        className="mx-auto max-w-xl px-6 py-10"
        title={t('state.not_member', { slug })}
        hint={t('state.not_member_hint')}
        action={home}
      />
    );
  }

  if (isNotFound(error)) {
    const { exact, maybe } = orgCandidates(me.data?.memberships ?? [], slug, orgSlug);
    // **그 프로젝트가 있는 조직이 하나로 정해지면 그리로 옮긴다** — 전환 라우트가 기억을
    // 바꾸고 캐시를 비우고 "○○(으)로 전환했습니다" 라고 말하므로 조용한 이동이 아니다
    const only = exact.length === 1 ? exact[0] : undefined;
    if (only !== undefined) {
      return (
        <Navigate to="/o/$org" params={{ org: only.org_slug }} search={{ next: here }} replace />
      );
    }
    const candidates = [...exact, ...maybe];
    return (
      <NotFoundState
        className="mx-auto max-w-xl px-6 py-10"
        title={t('state.project_not_found', { slug })}
        hint={candidates.length > 0 ? t('state.project_not_found_hint') : undefined}
        action={
          candidates.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {candidates.map((m) => (
                <Link
                  key={m.org_slug}
                  to="/o/$org"
                  params={{ org: m.org_slug }}
                  search={{ next: here }}
                  className="rounded-nerv border border-border px-2.5 py-1 text-sm hover:bg-bg-hover"
                >
                  {t('state.project_in_org', { org: m.org_name })}
                </Link>
              ))}
            </div>
          ) : (
            home
          )
        }
      />
    );
  }

  return <ErrorState className="mx-auto max-w-xl px-6 py-10" error={error} onRetry={retry} />;
}

export const Route = createFileRoute('/p/$proj')({ component: ProjectShell });
