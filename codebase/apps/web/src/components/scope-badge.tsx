// 범위 표기 — "조직 / 프로젝트" 를 한 모양으로 (2026-09-24 · REQ-WEB-192 · 조직·프로젝트 경계 점검)
//
// **여러 조직에 걸친 목록**(받은 요청·홈의 오늘 할 일·알림·내 토큰·받은 초대)이 줄마다 범위를
// 말하지 않았다. 말하더라도 **slug** 였고 자리마다 모양이 달랐다 — 카드 오른쪽의 흐린 글자,
// 좁은 화면에서 사라지는 칸, 없는 것. 두 조직에 같은 slug 가 있으면 둘을 가를 길이 없었다.
//
// 규칙 셋:
//   ① **이름**을 그린다. slug 는 주소의 것이다 — 필요한 자리(`withSlug`)에서만 흐리게 곁들인다
//   ② **조직은 가를 필요가 있을 때만** 앞에 선다 — 내가 둘 이상의 조직에 속했거나, 그 항목이
//      지금 헤더의 조직이 아닐 때. 조직이 하나뿐인 사람에게 줄마다 "default /" 를 붙이면
//      정보가 아니라 잡음이다
//   ③ **지금 조직이 아니면 강조한다** — 다른 조직의 일이라는 사실이 곧 정보다(흐리게 두면
//      사람은 그것을 지금 조직의 일로 읽는다)
import { useMemo } from 'react';
import { useT } from '../lib/i18n.js';
import { useMe } from '../lib/queries.js';
import { useScope } from '../lib/scope.js';
import { cn } from '../lib/utils.js';

export interface ScopeBadgeProps {
  orgSlug?: unknown;
  orgName?: unknown;
  /** 없거나 null 이면 조직 전체 범위다 */
  projectSlug?: unknown;
  projectName?: unknown;
  /** 프로젝트 slug 를 흐린 보조로 곁들인다(설정 파일에 적는 값이 slug 인 자리 — 토큰) */
  withSlug?: boolean;
  className?: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function ScopeBadge({
  orgSlug,
  orgName,
  projectSlug,
  projectName,
  withSlug = false,
  className,
}: ScopeBadgeProps): React.JSX.Element {
  const t = useT();
  const me = useMe();
  const scope = useScope();
  const org = str(orgSlug);
  const project = str(projectSlug);
  const orgCount = useMemo(
    () => new Set((me.data?.memberships ?? []).map((m) => m.org_slug)).size,
    [me.data],
  );
  const elsewhere = org !== null && scope.orgSlug !== null && org !== scope.orgSlug;
  const showOrg = org !== null && (orgCount > 1 || elsewhere);

  return (
    <span
      data-testid="scope-badge"
      data-elsewhere={elsewhere}
      title={elsewhere ? t('scope.elsewhere', { org: str(orgName) ?? org }) : undefined}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 text-xs',
        elsewhere ? 'font-medium text-status-waiting' : 'text-text-mute',
        className,
      )}
    >
      {showOrg && (
        <>
          <span className="truncate">{str(orgName) ?? org}</span>
          <span aria-hidden="true" className="text-text-faint">
            /
          </span>
        </>
      )}
      <span className="truncate">
        {project === null ? t('scope.org_wide') : (str(projectName) ?? project)}
      </span>
      {withSlug && project !== null && str(projectName) !== null && projectName !== project && (
        <span className="font-mono text-2xs text-text-faint">{project}</span>
      )}
    </span>
  );
}
