// fail-open 격상 배너 — S5 세션 모니터 · S6 리뷰 센터 (2026-10-15 · 사람 결정 · screens.md REQ-WEB-319)
//
// 게이트가 판정하지 못하고 통과시킨 일(fail-open)이 정책의 시간 창 안에 기준 이상 쌓이면 서버가 격상하고
// (api.md REQ-API-319), 프로젝트 조회가 그 상태를 `failopen_status` 로 준다(REQ-API-320). 이 배너는 그 값을 그릴 뿐
// 판정하지 않는다(D-05). **조용히 꺼진 게이트가 최악이다**(roadmap R4) — 진행은 막지 않되 그 사실을 화면에 보여 준다.
// 격상이 아니면 아무것도 그리지 않는다. 사이드바와 같은 조회(`useProject`)라 격상 · 해제 이벤트가 오면 함께 다시 읽힌다.

import { Link } from '@tanstack/react-router';
import { useT } from '../lib/i18n.js';
import { useProject } from '../lib/queries.js';
import { cn } from '../lib/utils.js';

/** 프로젝트 조회의 `failopen_status` — 모양이 다르면 없는 것으로 본다 */
export interface FailopenStatusView {
  escalated: boolean;
  count: number;
  escalate_count: number;
  window_hours: number;
}

export function readFailopenStatus(value: unknown): FailopenStatusView | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const num = (key: string): number | null =>
    typeof v[key] === 'number' && Number.isFinite(v[key]) ? v[key] : null;
  const count = num('count');
  const threshold = num('escalate_count');
  const hours = num('window_hours');
  if (typeof v['escalated'] !== 'boolean' || count === null || threshold === null || hours === null)
    return null;
  return { escalated: v['escalated'], count, escalate_count: threshold, window_hours: hours };
}

export function FailOpenBanner({
  projectSlug,
  className,
}: {
  projectSlug: string;
  className?: string;
}): React.JSX.Element | null {
  const t = useT();
  const project = useProject(projectSlug);
  const status = readFailopenStatus(project.data?.['failopen_status']);
  if (status === null || !status.escalated) return null;
  return (
    <div
      role="alert"
      data-testid="failopen-banner"
      className={cn(
        'mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-nerv border border-status-danger bg-status-danger-soft px-3 py-2 text-sm',
        className,
      )}
    >
      <span className="font-medium text-status-danger">⚠ {t('failopen.banner.title')}</span>
      <span className="text-text-mute">
        {t('failopen.banner.body', {
          hours: status.window_hours,
          count: status.count,
          threshold: status.escalate_count,
        })}
      </span>
      {/* 무엇을 판정하지 못했는지는 기록에 있다 — 개요의 활동을 그 기록으로 거른 채 연다 */}
      <Link
        to="/p/$proj"
        params={{ proj: projectSlug }}
        search={{ events: 'failopen' }}
        data-testid="failopen-banner-events"
        className="text-sm text-link hover:underline"
      >
        {t('failopen.banner.events')} ▸
      </Link>
    </div>
  );
}
