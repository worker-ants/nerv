// /p/:proj/tasks/:task — 작업 상세 (screens.md §2.5)
//
// 여기서 done 전이를 한다. **게이트가 요구하는 것을 폼이 먼저 보여준다** — 스펙 영향 선언과
// 증적. 조건 5(스펙 영향)가 clemvion 에서 가장 잘 작동한 규칙의 이식이라, "없음"도 명시적으로
// 고르게 만든다. 빈 선언을 허용하면 규칙이 사라진다.

import {
  BLOCKED_REASONS,
  EVIDENCE_KINDS,
  blockedReasonLabelKey,
  isDelegationFilled,
  statusLabelKey,
} from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StatusBadge } from '../../components/status-badge.js';
import { TASK_TOKEN } from '../../components/status-token.js';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { evidenceTarget, needsRepoUrl } from '../../lib/evidence.js';
import { blockedReasonText } from '../../lib/format.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { rows, useMe, useProject, useTask } from '../../lib/queries.js';
import { rolesInProject } from '../../lib/session.js';
import { secondsUntil, useNow } from '../../lib/clock.js';
import { leaseRemaining } from '../../features/session-monitor/format.js';
import { useScope } from '../../lib/scope.js';
import { useApiError } from '../../lib/api-errors.js';
import {
  Button,
  Card,
  Input,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Select,
  Textarea,
} from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

export const Route = createFileRoute('/p/$proj/tasks/$task')({ component: TaskDetail });

function TaskDetail(): React.JSX.Element {
  const t = useT();
  const { proj, task } = Route.useParams();
  const detail = useTask(proj, task);
  const project = useProject(proj);
  const me = useMe();
  const { orgSlug } = useScope(proj);
  const now = useNow();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();

  const [specImpactNone, setSpecImpactNone] = useState(true);
  const [specImpactNote, setSpecImpactNote] = useState('');
  const [evidenceKind, setEvidenceKind] = useState('pr');
  const [evidenceLocator, setEvidenceLocator] = useState('');
  const [blockedReason, setBlockedReason] = useState('');
  /** 서버가 거부한 사유 — 카드 옆에 남긴다. 토스트는 사라지고 사람은 이유를 잊는다 */
  const [rejection, setRejection] = useState<{ message: string; missing: string[] } | null>(null);

  const data = detail.data ?? {};
  const status = String(data['status'] ?? '');
  const projectId = project.data?.['id'];
  const meId = me.data?.id;
  const evidence = rows(data['evidence']);
  // 증적이 데려갈 곳을 만드는 데 드는 둘 — 저장소 주소와 기준 갈래(REQ-WEB-159).
  // 프로젝트 응답(EP-PRJ-03)이 처음부터 싣고 있었고 이 화면이 읽은 적이 없었다.
  const repoUrl = typeof project.data?.['repo_url'] === 'string' ? project.data['repo_url'] : null;
  const defaultBranch =
    typeof project.data?.['default_branch'] === 'string' ? project.data['default_branch'] : null;
  /** 주소의 모양(REQ-WEB-162) — 어휘 밖이면 `evidenceTarget` 이 기본으로 읽는다 */
  const repoHost =
    typeof project.data?.['repo_host'] === 'string' ? project.data['repo_host'] : null;
  /** 무엇이 되면 풀리는가 — 서버가 파생해 보낸다(REQ-API-118). 막히지 않았으면 null */
  const blocked =
    typeof data['blocked_resolution'] === 'object' && data['blocked_resolution'] !== null
      ? (data['blocked_resolution'] as Record<string, unknown>)
      : null;

  /**
   * 지금 살아 있는 내 클레임 — 있으면 [클레임 해제], 없으면 [클레임] 이다.
   *
   * 상세가 싣는 클레임 이력은 최근 10건이라 **상태를 봐야 한다**: 지나간 `released` 를
   * 살아 있는 것으로 읽으면 잡을 수 있는 작업에 해제 버튼이 붙는다.
   */
  const myClaim = rows(data['claims']).find(
    (c) => c['status'] === 'active' && c['user_id'] === meId,
  );
  const heldByOther = rows(data['claims']).some(
    (c) => c['status'] === 'active' && c['user_id'] !== meId,
  );

  /**
   * **완료로 옮길 수 있는 사람은 넷이다**(REQ-API-130 · REQ-WEB-141). 서버가 그렇게 판정하므로
   * 화면은 미리 잠근다 — 숨기지 않고 비활성으로, 사유를 툴팁에 적어서(REQ-WEB-003).
   * 누를 수 없는 단추가 왜 그런지 말하지 않으면 사람은 화면이 고장 났다고 읽는다.
   */
  const privileged = rolesInProject(me.data, orgSlug, proj).some(
    (r) => r === 'planner' || r === 'admin',
  );
  const isAssignee = data['assignee_user_id'] === meId && meId !== undefined;
  const canFinish = myClaim !== undefined || isAssignee || privileged;

  /**
   * **아무도 쥐지 않은 진행 중** — 임포트가 만든 24건이 그 모양이었다(2026-09-06 실측).
   * `next()` 에도 안 보이고(ready 가 아니라) 잡을 수도 없어서 아무에게도 닿지 않는다.
   * 되돌리는 문이 웹에 없었다. 서버가 받을 것만 보인다(§1.8): 위임 명세 4요소가 차 있으면
   * `ready`, 임포트 자리표시자처럼 비어 있으면 `backlog` 다 — 전자를 눌러 봐야 서버가
   * 4요소로 거절한다.
   */
  const orphan =
    (status === 'claimed' || status === 'in_progress') && !heldByOther && myClaim === undefined;
  const delegationFilled = (
    ['goal_md', 'output_format_md', 'tools_sources_md', 'boundaries_md'] as const
  ).every((field) => isDelegationFilled(typeof data[field] === 'string' ? data[field] : null));
  const revertTarget: 'ready' | 'backlog' = delegationFilled ? 'ready' : 'backlog';

  const claim = useMutation({
    // **웹에서도 잡을 수 있어야 한다**(screens.md:903 화면 요소 "사람 클레임").
    // 이 문이 없는 동안 MCP·CLI 를 쓰지 않는 역할에게 보드는 읽기 전용이었다 — 서버는
    // 처음부터 세션 쿠키로도 `task:claim` 을 내주고 있었다(project-access.guard).
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${String(data['id'])}/claim`, {
        method: 'POST',
        // 사람 클레임에는 세션이 없다 — 범위는 이 작업의 출처 스펙 하나다.
        // 파일 글롭은 **비운다**: 사람이 무엇을 만질지 서버가 추정하면 안 된다.
        body: {
          scope: {
            spec_ids: typeof data['source_spec_id'] === 'string' ? [data['source_spec_id']] : [],
            file_globs: [],
          },
        },
        idempotencyKey: `claim-${String(data['id'])}`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.claim_ok') });
    },
    onError: onApiError,
  });

  const rebrief = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(`/projects/${proj}/tasks/${String(data['id'])}`, {
        method: 'PATCH',
        body: { rebrief: true },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.basis.rebrief_ok') });
    },
    onError: onApiError,
  });

  const release = useMutation({
    mutationFn: (reason: 'handoff' | 'abandon') =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/claims/${String(myClaim?.['id'])}/release`,
        {
          method: 'POST',
          body: { reason },
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      pushToast({ tone: 'ok', message: t('task.release_ok') });
    },
    onError: onApiError,
  });

  const transition = useMutation({
    mutationFn: (next: 'done' | 'blocked' | 'ready' | 'backlog') =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/tasks/${String(data['id'])}/transition`,
        {
          method: 'POST',
          body: {
            status: next,
            ...(next === 'done'
              ? {
                  spec_impact: specImpactNone ? { none: true } : { note: specImpactNote },
                  evidence:
                    evidenceLocator.trim() === ''
                      ? []
                      : [{ kind: evidenceKind, locator: evidenceLocator }],
                }
              : {}),
            ...(next === 'blocked' ? { blocked_reason: blockedReason } : {}),
          },
        },
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(task) });
      if (typeof projectId === 'string') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
      }
      pushToast({
        tone: 'ok',
        message: t('task.status_changed', { status: String(result['status']) }),
      });
      setRejection(null);
    },
    onError: (error: Error) => {
      // 거부는 **화면에 남는다**(REQ-WEB-018). 상태는 그대로이고(낙관적 갱신을 하지 않으므로
      // 되돌릴 것도 없다) 무엇이 빠졌는지가 버튼 옆에 붙는다.
      // `missing` 은 위임 명세 4요소, `pending` 은 끝나지 않은 선행 작업이다(REQ-API-131).
      // 둘 다 "무엇을 하면 되는가" 라서 같은 자리에 남긴다 — 이름만 다르다.
      const details = error instanceof NervApiError ? error.body.details : {};
      const missing = Array.isArray(details['missing'])
        ? (details['missing'] as (string | { label?: string; field?: string })[]).map((m) =>
            typeof m === 'string' ? m : (m.label ?? m.field ?? ''),
          )
        : Array.isArray(details['pending'])
          ? (details['pending'] as string[])
          : [];
      setRejection({ message: error.message, missing });
      pushToast({ tone: 'warn', message: error.message });
    },
  });

  return (
    <PageBody>
      <Link
        to="/p/$proj/tasks"
        params={{ proj }}
        className="mb-2 inline-block text-xs text-text-mute hover:text-text"
      >
        {t('task.back_to_board')}
      </Link>
      <PageHeader
        title={String(data['title'] ?? task)}
        meta={
          <>
            <Mono>{task}</Mono>
            <StatusBadge
              token={(TASK_TOKEN[status as keyof typeof TASK_TOKEN] ?? 'idle') as StatusToken}
              label={t(statusLabelKey('task', status))}
            />
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {/* **"왜 이 작업인가" 가 화면에 있어야 한다**(FR-05 · D-03 · screens.md:900,912,931,934).
            서버는 출처 스펙·기준 버전·의존·재브리핑을 처음부터 실어 보냈고 화면이 그리지
            않았다 — 그 사이 이 화면은 "무엇을 하라" 만 말하고 "무엇에 근거해" 는 말하지
            않았다. 근거 없는 지시가 P1(맥락 유실)의 다른 이름이다. */}
        <Card>
          <SectionTitle>{t('task.basis')}</SectionTitle>
          <div className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            <Element label={t('task.basis.spec')}>
              {typeof data['spec_key'] === 'string' ? (
                <Link
                  to="/p/$proj/specs/$spec"
                  params={{ proj, spec: String(data['source_spec_id'] ?? data['spec_key']) }}
                  className="text-link hover:underline"
                >
                  <Mono>{String(data['spec_key'])}</Mono>
                  {data['basis_version_no'] != null && ` v${String(data['basis_version_no'])}`}
                </Link>
              ) : (
                '—'
              )}
              {/* 기준 버전이 밀려났다는 사실은 **링크 옆에** 붙는다 — 별도 카드로 두면
                  근거를 보는 사람과 경고를 보는 사람이 갈린다 */}
              {data['basis_superseded'] === true && (
                <span data-testid="basis-superseded" className="ml-2 text-xs text-status-danger">
                  {t('task.basis.superseded')}
                </span>
              )}
            </Element>
            {/* **UUID 는 사람이 아는 이름이 아니다**(2026-09-07 · REQ-WEB-148). 서버가
                고정 ID(REQ-…)와 문장을 함께 실어 준다 — 원문을 그리면 사람은 그것이 무엇을
                가리키는지 알 수 없고, 그래서 근거 칸이 있어도 근거가 되지 않았다. */}
            <Element label={t('task.basis.requirement')}>
              {typeof data['source_requirement_ref'] === 'string' ? (
                <span data-testid="requirement-ref" className="flex flex-col gap-0.5">
                  <Mono>{String(data['source_requirement_ref'])}</Mono>
                  {typeof data['source_requirement_statement'] === 'string' && (
                    <span className="line-clamp-2 text-xs text-text-mute">
                      {String(data['source_requirement_statement'])}
                    </span>
                  )}
                </span>
              ) : typeof data['source_requirement_id'] === 'string' ? (
                <Mono>{data['source_requirement_id']}</Mono>
              ) : (
                '—'
              )}
            </Element>
            <Element label={t('task.basis.dependencies')}>
              {rows(data['dependencies']).length === 0
                ? t('common.none')
                : rows(data['dependencies']).map((dep) => (
                    <Link
                      key={String(dep['key'])}
                      to="/p/$proj/tasks/$task"
                      params={{ proj, task: String(dep['key']) }}
                      className="mr-2 text-link hover:underline"
                    >
                      <Mono>{String(dep['key'])}</Mono>
                      <span className="ml-1 text-xs text-text-mute">{String(dep['status'])}</span>
                    </Link>
                  ))}
            </Element>
            <Element label={t('task.basis.rebrief')}>
              {data['rebrief_required_at'] == null ? (
                t('common.none')
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <span data-testid="rebrief-required" className="text-status-waiting">
                    {t('task.basis.rebrief_required')}
                  </span>
                  {/* **배지를 해소하는 문**(2026-09-06 · REQ-API-121). 오래 배지만 있고
                      그것을 끄는 길이 없었다 — 기준을 최신 승인본으로 옮기고 플래그를
                      지운다. "봤다" 표시가 아니라 **기준을 옮기는 것**이 재브리핑의 뜻이다. */}
                  <Button
                    size="sm"
                    data-testid="rebrief"
                    disabled={rebrief.isPending}
                    onClick={() => rebrief.mutate()}
                    title={t('task.basis.rebrief_title')}
                  >
                    {t('task.basis.rebrief_action')}
                  </Button>
                </span>
              )}
            </Element>
          </div>
        </Card>

        {/* **막힘은 사유만으로 끝나지 않는다.** 정본(3.5 §2)이 "사유 코드와 **해소 조건**을
            필수로 받는다" 고 적는데 해소 조건을 담을 열이 없었다 — 서버가 그것을 **파생**해
            보낸다(REQ-API-118). 화면이 할 일은 "무엇이 되면 풀리는가" 를 그대로 보이는 것과,
            **이미 풀렸다는 사실을 말해 주는 것**이다: `blocked_reason` 은 아무도 자동으로
            지우지 않아서, 의존이 끝나도 사람이 다시 눌러야 풀린다. */}
        {blocked !== null && (
          <Card>
            <SectionTitle>{t('task.blocked.title')}</SectionTitle>
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {/* **어휘 밖이면 원문 그대로**(2026-09-07 · REQ-WEB-143). 무조건 문구 키를
                    만들어 붙였더니, 어휘가 생기기 전에 저장된 자유 텍스트 사유에서
                    카탈로그에 없는 키가 만들어져 화면에 `blocked.…` 가 그대로 떴다 —
                    사람이 적어 둔 사유가 있는데 그것을 못 보게 하는 모양이다 */}
                <span data-testid="blocked-reason" className="font-medium">
                  {blockedReasonText(t, blocked['reason'])}
                </span>
                {blocked['satisfied'] === true && (
                  <span
                    data-testid="blocked-satisfied"
                    className="ml-2 rounded-nerv-sm bg-status-ok-soft px-1.5 py-0.5 text-xs text-status-ok"
                  >
                    {t('task.blocked.satisfied')}
                  </span>
                )}
              </p>
              {/* **`null` 은 "아니다" 가 아니라 "서버가 모른다" 다.** 그 둘을 같은 회색으로
                  그리면 사람은 판정이 있었다고 읽는다 */}
              {blocked['satisfied'] === null ? (
                <p className="text-xs text-text-mute">{t('task.blocked.human_only')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {rows(blocked['pending']).map((item, i) => (
                    <li key={`${String(item['kind'])}-${i}`} className="flex items-center gap-1.5">
                      {item['kind'] === 'task' ? (
                        <Link
                          to="/p/$proj/tasks/$task"
                          params={{ proj, task: String(item['key']) }}
                          className="text-link hover:underline"
                        >
                          <Mono>{String(item['key'])}</Mono>
                        </Link>
                      ) : (
                        <Mono>{String(item['key'] ?? item['id'] ?? '')}</Mono>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs text-text-mute">
                        {String(item['title'] ?? '')}
                      </span>
                      <span className="text-2xs text-text-ghost">
                        {String(item['status'] ?? '')}
                      </span>
                    </li>
                  ))}
                  {rows(blocked['pending']).length === 0 && (
                    <li className="text-xs text-text-faint">{t('task.blocked.nothing_pending')}</li>
                  )}
                </ul>
              )}
            </div>
          </Card>
        )}

        <Card>
          <SectionTitle>{t('task.brief')}</SectionTitle>
          <div className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
            <Element label={t('task.brief.goal')}>{String(data['goal_md'] ?? '—')}</Element>
            <Element label={t('task.brief.output')}>
              {String(data['output_format_md'] ?? '—')}
            </Element>
            <Element label={t('task.brief.tools')}>
              {String(data['tools_sources_md'] ?? '—')}
            </Element>
            <Element label={t('task.brief.boundaries')}>
              {String(data['boundaries_md'] ?? '—')}
            </Element>
          </div>
        </Card>

        <Card>
          <SectionTitle>{t('task.claims')}</SectionTitle>
          {/* **웹에서도 잡고 놓을 수 있다**(screens.md:903·926). 이 두 버튼이 없는 동안
              MCP·CLI 를 쓰지 않는 역할에게 보드는 읽기 전용이었다 — 서버는 세션 쿠키로도
              `task:claim` 을 내주고 있었으므로 빠져 있던 것은 문뿐이다. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {myClaim === undefined ? (
              <>
                <Button
                  data-testid="claim-task"
                  variant="primary"
                  disabled={claim.isPending || heldByOther || status === 'done'}
                  onClick={() => claim.mutate()}
                >
                  {t('task.claim')}
                </Button>
                {heldByOther && (
                  <span className="text-xs text-text-faint">{t('task.claim_held')}</span>
                )}
              </>
            ) : (
              <>
                {/* 인계와 포기는 **저장에서도 다른 값**이다(마이그레이션 0019) —
                    화면이 하나로 뭉치면 "왜 내려놨나" 가 다시 사라진다 */}
                <Button
                  data-testid="release-handoff"
                  disabled={release.isPending}
                  onClick={() => release.mutate('handoff')}
                >
                  {t('task.release_handoff')}
                </Button>
                <Button
                  data-testid="release-abandon"
                  variant="danger"
                  disabled={release.isPending}
                  onClick={() => release.mutate('abandon')}
                >
                  {t('task.release_abandon')}
                </Button>
              </>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {rows(data['claims']).map((claim) => {
              const remaining =
                claim['status'] === 'active' ? secondsUntil(claim['lease_expires_at'], now) : null;
              const scope = [
                ...(Array.isArray(claim['scope_spec_ids'])
                  ? (claim['scope_spec_ids'] as string[])
                  : []),
                ...(Array.isArray(claim['scope_file_globs'])
                  ? (claim['scope_file_globs'] as string[])
                  : []),
              ];
              return (
                <li key={String(claim['id'])} className="flex flex-col gap-0.5 text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{String(claim['status'])}</span>
                    <span className="font-mono">
                      {String(claim['hostname'] ?? t('task.claim_human'))}
                    </span>
                    <span className="text-text-mute">{String(claim['agent_type'] ?? '')}</span>
                    <Mono>{String(claim['external_session_id'] ?? '')}</Mono>
                    {/* **리스는 흐른다**(SCR-06) — 만료 시각에서 매초 다시 센다 */}
                    {remaining !== null && (
                      <span data-testid="claim-lease" className="text-text-faint">
                        {t('task.claim_lease', { remaining: leaseRemaining(t, remaining) })}
                      </span>
                    )}
                  </span>
                  {/* 선언한 범위 — 겹침 판정이 보는 것이 무엇인지 사람도 봐야 한다 */}
                  {scope.length > 0 && (
                    <span data-testid="claim-scope" className="text-2xs text-text-ghost">
                      {t('task.claim_scope')}: {scope.join(' · ')}
                    </span>
                  )}
                </li>
              );
            })}
            {rows(data['claims']).length === 0 && (
              <li className="text-sm text-text-faint">{t('common.none')}</li>
            )}
          </ul>
        </Card>

        <Card>
          <SectionTitle>{t('task.done_gate')}</SectionTitle>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={specImpactNone}
                onChange={(e) => setSpecImpactNone(e.target.checked)}
              />
              {t('task.spec_impact_none')}
              <span className="text-xs text-text-faint">— {t('task.spec_impact_note')}</span>
            </label>
            {!specImpactNone && (
              <Textarea
                value={specImpactNote}
                onChange={(e) => setSpecImpactNote(e.target.value)}
                placeholder={t('task.spec_impact_placeholder')}
                rows={2}
              />
            )}
            <div className="flex gap-2">
              {/* **어휘는 `@nerv/schema` 가 정본이다**(2026-09-10 · REQ-WEB-160 · REQ-CB-006).
                  여섯 중 넷을 여기 손으로 적어 두어 `review`·`user_guide` 증적은 웹에서
                  붙일 길이 없었다 — 서버는 처음부터 여섯을 받는데. 손으로 적은 목록은
                  어휘가 늘어도 함께 늘지 않는다. */}
              <Select value={evidenceKind} onChange={(e) => setEvidenceKind(e.target.value)}>
                {EVIDENCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
              <Input
                value={evidenceLocator}
                onChange={(e) => setEvidenceLocator(e.target.value)}
                placeholder={t('task.evidence_placeholder')}
                className="min-w-0 flex-1"
              />
            </div>
            {rejection !== null && (
              <p
                role="alert"
                data-testid="transition-rejected"
                className="rounded-nerv-sm bg-status-danger-soft px-2 py-1.5 text-sm text-status-danger"
              >
                {t('task.transition_rejected', { message: rejection.message })}
                {rejection.missing.length > 0 &&
                  t('task.transition_missing', { missing: rejection.missing.join(', ') })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button
                variant="primary"
                disabled={status === 'done' || transition.isPending || !canFinish}
                onClick={() => transition.mutate('done')}
                title={
                  !canFinish
                    ? t('task.done_needs_claim')
                    : rejection === null
                      ? undefined
                      : t('task.last_rejection', { message: rejection.message })
                }
              >
                {t('task.to_done')}
              </Button>
              {orphan && (
                <Button
                  variant="ghost"
                  data-testid="revert-task"
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(revertTarget)}
                >
                  {t(revertTarget === 'ready' ? 'task.to_ready' : 'task.to_backlog')}
                </Button>
              )}
              <span aria-hidden="true" className="h-5 w-px bg-border" />
              {/* **자유 텍스트가 아니라 어휘 4종이다**(2026-09-06 · REQ-API-117). 예전에는
                  아무 문장이나 받아 서버에 그대로 실었고, 그러면 막힘 필터가 그 순간부터
                  사실을 못 센다 — 같은 뜻을 사람마다 다른 문자열로 적기 때문이다.
                  고르는 것으로 바꾸면 화면이 서버가 받을 것만 보인다(§1.8). */}
              <Select
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                aria-label={t('task.blocked_reason')}
                className="w-56"
              >
                <option value="">{t('task.blocked_reason')}</option>
                {BLOCKED_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {t(blockedReasonLabelKey(reason))}
                  </option>
                ))}
              </Select>
              <Button
                variant="danger"
                disabled={blockedReason.trim() === '' || transition.isPending}
                onClick={() => transition.mutate('blocked')}
                title={t('task.blocked_reason_title')}
              >
                {t('task.to_blocked')}
              </Button>
            </div>
          </div>
        </Card>

        {/* **증적은 보러 갈 수 있어야 한다**(2026-09-10 — 사람 지시 · REQ-WEB-159). 명세
            §2.5 (6) 은 처음부터 "PR·커밋 링크" 라고 적었는데 화면은 종류와 위치를 글자로만
            그렸다 — 증적은 "보일 것을 붙였다" 는 약속이고, 그것을 확인하는 길이 없으면
            약속이 절반만 지켜진다. **새 탭으로 연다**: 여기서 done 전이를 하는 중이라
            같은 탭에서 나가면 채워 둔 폼(스펙 영향·증적)이 사라진다. */}
        <Card>
          <SectionTitle>{t('task.evidence')}</SectionTitle>
          <ul className="flex flex-col">
            {evidence.map((e) => {
              const target = evidenceTarget({
                kind: String(e['kind']),
                locator: String(e['locator']),
                repoUrl,
                defaultBranch,
                repoHost,
                // 이 증적이 선 저장소가 따로 있으면 그것이 이긴다(REQ-API-157)
                repo: typeof e['repo'] === 'string' ? e['repo'] : null,
                projectSlug: proj,
              });
              return (
                <li
                  key={String(e['id'])}
                  data-testid="task-evidence"
                  className="flex gap-2 border-b border-border py-1.5 text-xs last:border-0"
                >
                  <span className="w-20 shrink-0 font-mono text-text-faint">
                    {String(e['kind'])}
                  </span>
                  {target === null ? (
                    <span className="truncate">{String(e['locator'])}</span>
                  ) : (
                    <a
                      href={target.href}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="evidence-link"
                      title={t('task.evidence_open')}
                      className="truncate text-link hover:underline"
                    >
                      {String(e['locator'])}
                    </a>
                  )}
                </li>
              );
            })}
            {evidence.length === 0 && (
              <li className="text-sm text-text-faint">{t('common.not_yet')}</li>
            )}
          </ul>
          {/* 링크가 아닌 이유 중 사람이 고칠 수 있는 것 하나는 화면이 말한다 — 빈칸은
              "링크 없는 증적" 으로 읽히지 "설정이 비었다" 로 읽히지 않는다(§1.5) */}
          {needsRepoUrl(
            evidence.map((e) => ({ kind: String(e['kind']) })),
            repoUrl,
          ) && (
            <p data-testid="evidence-no-repo" className="mt-2 text-2xs text-text-faint">
              {t('task.evidence_no_repo')}
            </p>
          )}
        </Card>

        {/* **리뷰는 Task 에서도 보인다**(2026-09-07 · REQ-WEB-148 · FR-13 양방향 드릴다운).
            리뷰 → Task 방향만 있어서, 작업 상세에서 "이 작업이 리뷰를 지났는가" 를 알 길이
            없었다 — done 게이트가 그것을 조건으로 삼는데도 그랬다. */}
        <Card>
          <SectionTitle>{t('task.reviews')}</SectionTitle>
          <ul className="flex flex-col">
            {rows(data['reviews']).map((r) => (
              <li
                key={String(r['id'])}
                data-testid="task-review"
                className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 text-xs last:border-0"
              >
                <Mono>{String(r['branch'])}</Mono>
                <span className="text-text-faint">
                  {String(r['kind'])} · R{String(r['round_no'])} · {String(r['state'])}
                </span>
                {Number(r['open_critical'] ?? 0) > 0 && (
                  <span data-testid="review-open-critical" className="text-status-danger">
                    {t('task.reviews.open_critical', { n: Number(r['open_critical']) })}
                  </span>
                )}
              </li>
            ))}
            {rows(data['reviews']).length === 0 && (
              <li className="text-sm text-text-faint">{t('task.reviews.none')}</li>
            )}
          </ul>
        </Card>
      </div>
    </PageBody>
  );
}

/** 위임 명세 한 요소 — 라벨은 작게, 본문은 그대로. 4요소가 나란히 보여야 빈 칸이 눈에 띈다 */
function Element({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-0.5 text-2xs font-medium tracking-wide text-text-faint uppercase">
        {label}
      </div>
      <div className="whitespace-pre-wrap">{children}</div>
    </div>
  );
}
