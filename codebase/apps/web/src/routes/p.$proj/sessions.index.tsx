// /p/:proj/sessions → S5 세션 모니터 (ui-wireframes §2.5 · screens.md §2.6)
//
// **master-detail 이다**(시안 반영 2026-08-24). 목록에서 줄을 고르면 오른쪽 레일에 그
// 세션의 활동이 흐른다 — 이전에는 목록 아래 "개입" 카드 격자가 따로 있어, "이 세션이
// 왜 멈췄나"를 보려면 상세 페이지로 건너가야 했다. 모니터가 답할 질문은 그 자리에서
// 답해야 모니터다.
//
// stop 은 "지시를 전달한다"가 아니라 "지금 회수한다"이다 — 세션이 이미 죽어 하트비트를 못
// 치는 것이 stop 을 누르는 가장 흔한 상황이라, 전달을 기다리면 아무 일도 일어나지 않는다.

import { useT } from '../../lib/i18n.js';
import { sessionState } from '@nerv/schema';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ActivityRail } from '../../features/session-monitor/activity-rail.js';
import { PluginCoverage } from '../../features/session-monitor/plugin-coverage.js';
import { SessionBoard } from '../../features/session-monitor/session-board.js';
import { useProject, useSessions } from '../../lib/queries.js';
import { PageBody, PageHeader } from '../../components/ui/primitives.js';
import type { SessionCard } from '../../features/session-monitor/types.js';
import { asProjectId } from '../../lib/query-keys.js';

export interface SessionSearch {
  /** 스트립에서 고른 상태 */
  state?: string;
  /** 레일에 편 세션 */
  s?: string;
}

/** 상태 어휘 — 정본은 `@nerv/schema` 다. 모르는 값은 버린다(부모 라우트는 검사하지 않은 인자를 흘린다) */
const isState = (value: unknown): value is string =>
  typeof value === 'string' && (sessionState.enumValues as readonly string[]).includes(value);

export const Route = createFileRoute('/p/$proj/sessions/')({
  // **거른 상태와 편 세션은 주소다**(2026-09-24 — UI/UX 검토 WORK-11 · REQ-WEB-212). 둘 다 컴포넌트
  // state 라 "이 세션 좀 봐" 를 링크로 줄 수 없었고, 새로고침 한 번에 첫 줄로 돌아갔다
  validateSearch: (search: Record<string, unknown>): SessionSearch => ({
    ...(isState(search['state']) ? { state: search['state'] } : {}),
    ...(typeof search['s'] === 'string' && search['s'] !== '' ? { s: search['s'] } : {}),
  }),
  component: SessionMonitor,
});

function SessionMonitor(): React.JSX.Element {
  const t = useT();
  const { proj } = Route.useParams();
  const project = useProject(proj);
  const search = Route.useSearch();
  const navigate = useNavigate();
  // 스트립에서 고른 상태 — 목록과 레일이 **같은 조각**을 봐야 하므로 여기가 그 자리다
  const state = isState(search.state) ? search.state : null;
  const sessions = useSessions(proj, asProjectId(project.data?.['id']), state);
  const projectId = project.data?.['id'];
  const selectedId = typeof search.s === 'string' && search.s !== '' ? search.s : null;
  /** 레일에 펴는 것은 이력에 쌓지 않는다 — 줄을 훑을 때마다 뒤로가기가 한 칸씩 늘지 않게 */
  const setSelectedId = (id: string): void =>
    void navigate({
      to: '/p/$proj/sessions',
      params: { proj },
      search: (prev: SessionSearch) => ({ ...prev, s: id }),
      replace: true,
    });

  const cards = (sessions.data?.items ?? []) as unknown as SessionCard[];
  // 고르지 않았으면 첫 줄이 초점이다 — 빈 레일은 화면 절반을 버리는 것이다
  const focused = cards.find((c) => c.id === selectedId) ?? cards[0] ?? null;

  return (
    <div className="flex min-h-[calc(100vh-var(--spacing-header))]">
      <div className="min-w-0 flex-1">
        <PageBody wide>
          <PageHeader title={t('sessions.title')} />
          <PluginCoverage projectSlug={proj} projectId={asProjectId(projectId)} />
          <SessionBoard
            projectSlug={proj}
            projectId={asProjectId(projectId)}
            selectedId={focused?.id}
            onSelect={setSelectedId}
            state={state}
            // 거른 뒤에도 앞서 고른 세션이 레일에 남아 있으면 화면 둘이 다른 말을 한다 — 고른 것을 푼다
            onStateChange={(next) =>
              void navigate({
                to: '/p/$proj/sessions',
                params: { proj },
                search: next === null ? {} : { state: next },
              })
            }
          />
        </PageBody>
      </div>

      {/* 오른쪽 레일 — 시안 372px. 세션이 없으면 레일도 없다(빈 패널을 세우지 않는다) */}
      {focused !== null && (
        <aside className="hidden w-93 shrink-0 border-l border-border bg-bg-sunken/40 px-5 py-7 lg:block">
          <ActivityRail
            projectSlug={proj}
            projectId={asProjectId(project.data?.['id'])}
            card={focused}
          />
        </aside>
      )}
    </div>
  );
}
