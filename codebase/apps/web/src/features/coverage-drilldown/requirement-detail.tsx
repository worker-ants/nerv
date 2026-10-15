// 펼친 요구사항 — 드릴다운의 끝 (screens.md §2.3a · ui-wireframes §4.4 · REQ-WEB-316)
//
// **약속 하나와 그것을 지키는 일 · 보일 것 · 그것을 본 리뷰를 한자리에 둔다.** 파생 작업 · 증적 · 발견 · 최근 리뷰가 각자의 화면에
// 흩어져 있으면 "이 요구사항은 정말 됐나" 에 답하려고 네 화면을 오가야 한다. 그리고 **드릴다운의 끝은 행동이다** — 검증
// 증적이 없으면 그 자리에서 그 요구사항을 출처로 한 검증 작업을 만든다(FR-13). 만드는 폼은 스펙 상세의 "이 버전에서 파생"
// 과 같다(REQ-WEB-147) — 같은 일을 하는 폼을 둘 만들지 않는다.

import { Link } from '@tanstack/react-router';
import { TASK_CREATE_ROLES, statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { rows, useMe, useProject, useRequirementDetail } from '../../lib/queries.js';
import { evidenceTarget } from '../../lib/evidence.js';
import { evidenceKindText, taskStatusText } from '../../lib/format.js';
import { useRolesOnly, useScope } from '../../lib/scope.js';
import { rolesInProject } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import { Button, Mono, Skeleton, buttonClass } from '../../components/ui/primitives.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { StatusBadge } from '../../components/status-badge.js';

const SEVERITY_TOKEN = { critical: 'danger', warning: 'waiting', info: 'idle' } as const;

export function RequirementDetail({
  projectSlug,
  specKey,
  requirementRef,
}: {
  projectSlug: string;
  specKey: string;
  requirementRef: string;
}): React.JSX.Element {
  const t = useT();
  const detail = useRequirementDetail(projectSlug, specKey, requirementRef);
  const project = useProject(projectSlug);
  const me = useMe();
  const { orgSlug } = useScope(projectSlug);
  const rolesOnly = useRolesOnly();
  const canCreate = rolesInProject(me.data, orgSlug, projectSlug).some((role) =>
    (TASK_CREATE_ROLES as readonly string[]).includes(role),
  );

  if (detail.isPending) return <Skeleton rows={3} className="[&>div]:h-8" />;
  // 받지 못한 것을 "작업 없음 · 증적 없음" 으로 그리지 않는다(REQ-WEB-198)
  if (failedWithoutData(detail)) {
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  const data = detail.data ?? {};
  const tasks = rows(data['tasks']);
  const evidence = rows(data['evidence']);
  const findings = rows(data['findings']);
  const reviews = rows(data['reviews']);
  // 증적이 데려갈 곳 — 작업 상세와 같은 규칙이다(REQ-WEB-159~162)
  const repoUrl = typeof project.data?.['repo_url'] === 'string' ? project.data['repo_url'] : null;
  const defaultBranch =
    typeof project.data?.['default_branch'] === 'string' ? project.data['default_branch'] : null;
  const repoHost =
    typeof project.data?.['repo_host'] === 'string' ? project.data['repo_host'] : null;
  const approved =
    typeof data['approved_version'] === 'object' && data['approved_version'] !== null
      ? (data['approved_version'] as { id?: unknown; version_no?: unknown })
      : null;
  // **검증 증적은 서버가 판정한다**(REQ-API-313) — 지금 문장에 서명된 test 증적이 있는가. 화면이 증적 줄을 세어 다시 정하지 않는다
  const verified = data['verification_evidence'] === true;

  return (
    <div data-testid="coverage-req-detail" className="mt-2 flex flex-col gap-3 text-xs">
      {data['impl_status_source'] === 'import' && (
        <p data-testid="import-source-hint" className="text-text-faint">
          {t('coverage.source_import_hint')}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Section title={t('coverage.req.tasks')} empty={tasks.length === 0}>
          {tasks.map((task) => (
            <li key={String(task['id'])} className="flex items-center gap-1.5">
              <Link
                to="/p/$proj/tasks/$task"
                params={{ proj: projectSlug, task: String(task['key']) }}
                data-testid="coverage-req-task"
                className="flex min-w-0 items-center gap-1.5 hover:underline"
              >
                <Mono>{String(task['key'])}</Mono>
                <span className="truncate">{String(task['title'] ?? '')}</span>
              </Link>
              <span className="shrink-0 text-text-faint">
                {task['archived_at'] == null
                  ? taskStatusText(t, task['status'])
                  : t('coverage.req.archived')}
              </span>
            </li>
          ))}
        </Section>

        <Section title={t('coverage.req.evidence')} empty={evidence.length === 0}>
          {evidence.map((e) => {
            const target = evidenceTarget({
              kind: String(e['kind']),
              locator: String(e['locator']),
              repoUrl,
              defaultBranch,
              repoHost,
              repo: typeof e['repo'] === 'string' ? e['repo'] : null,
              projectSlug,
            });
            return (
              <li key={String(e['id'])} className="flex items-center gap-1.5">
                <span className="w-16 shrink-0 text-text-faint">
                  {evidenceKindText(t, e['kind'])}
                </span>
                {target === null ? (
                  <span className="truncate">{String(e['locator'])}</span>
                ) : (
                  <a
                    href={target.href}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="coverage-req-evidence-link"
                    className="truncate text-link hover:underline"
                  >
                    {String(e['locator'])}
                  </a>
                )}
                {e['signed'] === true && (
                  <StatusBadge token="ok" size="sm" label={t('coverage.req.signed')} />
                )}
              </li>
            );
          })}
        </Section>

        <Section title={t('coverage.req.findings')} empty={findings.length === 0}>
          {findings.map((f) => {
            const severity = String(f['severity']);
            const open = f['status'] === 'open';
            return (
              <li key={String(f['id'])} className="flex items-center gap-1.5">
                <StatusBadge
                  token={SEVERITY_TOKEN[severity as keyof typeof SEVERITY_TOKEN] ?? 'idle'}
                  mark={null}
                  size="sm"
                  label={t(`severity.${severity}` as 'severity.critical')}
                />
                {/* 처분된 발견은 리뷰 센터의 기본 거르기(열림)에 없다 — 전부 보기로 연다 */}
                <Link
                  to="/p/$proj/reviews"
                  params={{ proj: projectSlug }}
                  search={{ finding: String(f['id']), ...(open ? {} : { status: 'all' }) }}
                  data-testid="coverage-req-finding"
                  className={cn('min-w-0 truncate hover:underline', !open && 'text-text-mute')}
                >
                  {String(f['title'] ?? '')}
                </Link>
                <span className="shrink-0 text-text-faint">
                  {t(statusLabelKey('finding', String(f['status'])))}
                </span>
              </li>
            );
          })}
        </Section>

        <Section title={t('coverage.req.reviews')} empty={reviews.length === 0}>
          {reviews.map((r) => {
            const critical = Number(r['open_critical'] ?? 0);
            return (
              <li key={String(r['id'])} className="flex items-center gap-1.5">
                <Link
                  to="/p/$proj/reviews"
                  params={{ proj: projectSlug }}
                  search={{ branch: String(r['branch']), status: 'all' }}
                  data-testid="coverage-req-review"
                  className="min-w-0 truncate hover:underline"
                >
                  {t('coverage.req.review_line', {
                    branch: String(r['branch']),
                    round: Number(r['round_no'] ?? 1),
                    findings: Number(r['finding_count'] ?? 0),
                  })}
                </Link>
                {critical > 0 && (
                  <StatusBadge
                    token="danger"
                    mark={null}
                    size="sm"
                    label={t('coverage.req.open_critical', { count: critical })}
                  />
                )}
              </li>
            );
          })}
        </Section>
      </div>

      {/* **드릴다운의 끝은 행동이다**(FR-13 · ui-wireframes §4.4) — 검증 증적이 없는 줄에서 검증 작업을 만든다 */}
      {!verified && (
        <div
          data-testid="coverage-req-verification"
          className="flex flex-wrap items-center gap-2 rounded-nerv bg-bg-sunken px-2.5 py-2"
        >
          <span className="text-text-mute">{t('coverage.req.no_verification')}</span>
          {approved !== null && canCreate ? (
            <Link
              to="/p/$proj/tasks"
              params={{ proj: projectSlug }}
              search={{
                from_version: String(approved.id),
                from_spec: specKey,
                from_version_no: String(approved.version_no),
                requirement: String(data['id']),
              }}
              data-testid="make-verification"
              className={buttonClass('default', 'xs')}
            >
              {/* 생성 폼으로 가는 이동이다 — ▸ 로 이동임을 보인다(사람 결정 A3) */}
              {t('coverage.req.make_verification')} ▸
            </Link>
          ) : (
            <Button
              size="xs"
              disabled
              data-testid="make-verification-locked"
              disabledReason={
                approved === null ? t('coverage.req.no_approved') : rolesOnly(TASK_CREATE_ROLES)
              }
            >
              {t('coverage.req.make_verification')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** 칸 하나 — 비었으면 "없음" 이라고 적는다(0 을 빈칸으로 두면 받지 못한 것과 구별되지 않는다) */
function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = useT();
  return (
    <section className="flex flex-col gap-1">
      <h4 className="font-medium text-text-mute">{title}</h4>
      {empty ? (
        <p className="text-text-faint">{t('coverage.req.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">{children}</ul>
      )}
    </section>
  );
}
