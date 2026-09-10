// 활동 레일 — 세션 모니터의 오른쪽 절반(시안 Sessions · screens.md §2.6)
//
// **2026-09-01 — "Bash / Bash" 를 383번 반복하던 자리다**(사람 보고). 원인은 화면이 아니라
// 적재였다: `title = tool_name` 이라 도구 이름만 남았고 성패도 몰랐다. 서버가 이제 한 줄
// 요약과 원문을 함께 주므로(REQ-API-065 · REQ-WEB-123) 여기서 할 일은 셋이다 —
// **묶고**(같은 도구 연속), **실패를 튀게 하고**, **펼치면 원문**.
//
// **그 셋과 [더 보기]는 이제 `ActivityTimeline` 에 있다**(2026-09-07 · REQ-WEB-142) —
// 세션 상세가 같은 것을 그려야 하는데 자기만의 단순 목록을 들고 있었기 때문이다. 이
// 파일에 남은 것은 레일이 레일인 이유뿐이다: 누구의 세션인가 · 개입 · 두 층의 배치.
//
// **고른 세션의 지금을 보여 준다.** 목록에서 줄을 고르면 그 세션의 Activity 가 여기
// 흐른다 — 상세 페이지로 건너가지 않고도 "왜 멈췄나 · 무엇을 하고 있나"를 답하게 하는
// 것이 master-detail 로 바꾼 이유의 전부다. 전체 이력·클레임 이력은 상세 페이지의 몫이다.

import { useT } from '../../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { Avatar, SectionLabel } from '../../components/ui/primitives.js';
import { ActivityTimeline, SessionTrajectory } from './activity-timeline.js';
import { SteerPanel } from './steer-panel.js';
import { relativeTime } from './format.js';
import { useCanIntervene } from '../../lib/scope.js';
import type { SessionCard } from './types.js';
import type { ProjectId } from '../../lib/query-keys.js';

export function ActivityRail({
  projectSlug,
  projectId,
  card,
  now = Date.now(),
}: {
  projectSlug: string;
  /** 개입 패널의 무효화가 이 축으로 잡힌다 — 통과만 시킨다(SteerPanelProps 주석) */
  projectId: ProjectId | undefined;
  card: SessionCard;
  now?: number;
}): React.JSX.Element {
  const t = useT();
  const canIntervene = useCanIntervene(projectSlug, card.user_id);

  return (
    <div data-testid="activity-rail" className="flex min-h-0 flex-col">
      {/* 초점 머리 — 누구의 세션을 보고 있는가 */}
      <div className="flex items-center gap-2">
        <Avatar name={card.user_name} size="md" />
        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{card.user_name}</span>
        <span className="font-mono text-xs text-text-faint">{card.hostname}</span>
        <Link
          to="/p/$proj/sessions/$session"
          params={{ proj: projectSlug, session: card.id }}
          className="ml-auto shrink-0 text-sm text-text-faint hover:text-link"
        >
          {t('sessions.detail_link')} ↗
        </Link>
      </div>
      <div className="mt-1.5 ml-8 text-xs text-text-faint">
        {relativeTime(t, card.started_at, now)} · {card.agent_type}
      </div>

      {/* 개입은 레일에 있다 — 보고 있는 세션에 지시하는 것이 자연스러운 동선이다 */}
      <div className="mt-4">
        <SteerPanel
          projectSlug={projectSlug}
          projectId={projectId}
          sessionId={card.id}
          state={card.state}
          canIntervene={canIntervene}
        />
      </div>

      {/* **위에는 한 일, 아래에 도구 로그**(2026-09-01 · REQ-WEB-124). 이 화면의 첫 물음은
          "무슨 도구를 썼나" 가 아니라 "무엇을 하는 중이고 막혀 있나" 다 — 도구 로그가
          첫 화면일 이유가 없다. 궤적은 새 저장 없이 이벤트를 세션 축으로 읽은 것이다. */}
      <SectionLabel className="mt-6 mb-2.5">{t('sessions.rail.trajectory')}</SectionLabel>
      <SessionTrajectory projectSlug={projectSlug} sessionId={card.id} now={now} className="mb-2" />

      <SectionLabel className="mt-4 mb-2.5">{t('sessions.rail.activity')}</SectionLabel>
      <ActivityTimeline
        projectSlug={projectSlug}
        sessionId={card.id}
        className="flex-1 overflow-y-auto"
      />
    </div>
  );
}
