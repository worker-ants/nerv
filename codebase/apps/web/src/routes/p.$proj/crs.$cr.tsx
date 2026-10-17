// /p/:proj/crs/:cr — 변경 요청(CR) 상세 (screens.md §2.4f · REQ-WEB-320 · 2026-10-16 사람 결정 D1 · D2)
//
// CR 은 승인본 위의 초안을 감싼 제안이다. 이 화면이 한자리에 두는 것은 넷이다:
//   ① **바뀐 요구사항** — 승인본과 초안의 델타(EP-SPEC-06 를 다시 쓴다 · 기본은 바뀐 것만 · ui-wireframes §4.3)
//   ② **승인하면 움직이는 것** — 파생 작업의 몫 · 진행 중 클레임 · 참조 문서(EP-CR-02 의 영향 · spec-workflow §3.3)
//   ③ **승인하며 함께 할 일** — 영향의 제안(파생 · 재검증 작업 만들기 · 미착수 작업 보관) 가운데 사람이 고른 것
//   ④ **결정** — 결재는 그 버전이 받는다. 검토 중이면 그 버전의 결재로, 초안이면 바로 승인 · 거절 · 철회다
//
// 판정은 서버다(D-05) — 영향의 몫 · 고른 것의 적용 · 누가 거절 · 철회할 수 있는지. 화면은 단추를 그리고 서버의 거절을
// 그대로 보인다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CR_REJECT_ROLES, DIRECT_APPROVE_ROLES, statusLabelKey } from '@nerv/schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { usePressKey } from '../../lib/press-key.js';
import { rows, useChangeRequest, useMe, useSpecDiff } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useRolesOnly, useScope } from '../../lib/scope.js';
import { rolesInProject } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import { withCrOutcome } from '../../lib/cr-plan.js';
import {
  Button,
  Card,
  Mono,
  PageBody,
  PageHeader,
  SectionTitle,
  Skeleton,
  Textarea,
} from '../../components/ui/primitives.js';
import { EntityLink } from '../../components/entity-link.js';
import { ErrorState, failedWithoutData } from '../../components/query-state.js';
import { StatusBadge } from '../../components/status-badge.js';
import type { StatusToken } from '../../components/status-badge.js';
import { CR_TOKEN, SPEC_VERSION_TOKEN, TASK_TOKEN } from '../../components/status-token.js';
import { VersionDiff } from '../../features/spec-editor/version-diff.js';

export const Route = createFileRoute('/p/$proj/crs/$cr')({
  component: ChangeRequestPage,
});

/** 작업의 몫 — 서버가 정한 값의 이름(spec-workflow §3.3 표의 칸) */
const EFFECT_LABEL = {
  rebrief: 'cr.effect.rebrief',
  reverify: 'cr.effect.reverify',
  cancel: 'cr.effect.cancel',
  stop: 'cr.effect.stop',
  none: 'cr.effect.none',
} as const;

const EFFECT_TOKEN: Record<keyof typeof EFFECT_LABEL, StatusToken> = {
  rebrief: 'waiting',
  reverify: 'action',
  cancel: 'idle',
  stop: 'danger',
  none: 'idle',
};

const RISK_LABEL = {
  low: 'cr.risk.low',
  normal: 'cr.risk.normal',
  high: 'cr.risk.high',
} as const;

const ORIGIN_LABEL = {
  human: 'cr.origin.human',
  agent: 'cr.origin.agent',
  spec_drift: 'cr.origin.spec_drift',
} as const;

/** 고른 제안 — 서버 칸(`cr_actions`)과 같은 모양이다 */
interface Picked {
  derive: string[];
  reverify: string[];
  cancel: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function ChangeRequestPage(): React.JSX.Element {
  const { proj, cr } = Route.useParams();
  const query = useChangeRequest(proj, cr);
  const data = query.data;

  if (query.isPending) {
    return (
      <PageBody>
        <Skeleton rows={6} />
      </PageBody>
    );
  }
  if (failedWithoutData(query) || data === undefined) {
    return (
      <PageBody>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </PageBody>
    );
  }
  return <ChangeRequestBody proj={proj} data={data} />;
}

function ChangeRequestBody({ proj, data }: { proj: string; data: Row }): React.JSX.Element {
  const t = useT();
  const status = String(data['status'] ?? 'open');
  const key = String(data['key'] ?? '');
  const specKey = String(data['spec_key'] ?? '');
  const baseNo = Number(data['base_version_no']);
  const proposedNo = Number(data['proposed_version_no']);
  const impact = (data['impact'] ?? {}) as Row;
  const counts = (impact['counts'] ?? {}) as Record<string, number>;
  const risk = String(data['risk'] ?? 'normal') as keyof typeof RISK_LABEL;
  const origin = String(data['origin'] ?? 'human') as keyof typeof ORIGIN_LABEL;
  const gateTier = typeof data['gate_tier'] === 'string' ? data['gate_tier'] : null;
  const [full, setFull] = useState(false);
  const diff = useSpecDiff(proj, specKey, baseNo, proposedNo);
  const live = status === 'open' || status === 'in_review';

  return (
    <PageBody>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="text-text-mute">{t('cr.title')}</span>
            <span data-testid="cr-key" className="font-mono">
              {key}
            </span>
          </span>
        }
        meta={
          <StatusBadge
            data-testid="cr-status"
            token={(CR_TOKEN[status as keyof typeof CR_TOKEN] ?? 'idle') as StatusToken}
            label={t(statusLabelKey('cr', status))}
          />
        }
        description={String(data['title'] ?? '')}
      />

      {/* 곁줄 — 어느 문서의 몇 번에서 몇 번으로 · 누가 · 위험도 · 게이트 티어 */}
      <p
        data-testid="cr-byline"
        className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-mute"
      >
        <EntityLink projectSlug={proj} entity={{ kind: 'spec', key: specKey }} />
        <span>
          v{String(baseNo)} → v{String(proposedNo)}
        </span>
        <StatusBadge
          token={
            (SPEC_VERSION_TOKEN[
              String(data['proposed_status']) as keyof typeof SPEC_VERSION_TOKEN
            ] ?? 'idle') as StatusToken
          }
          label={t(statusLabelKey('spec', String(data['proposed_status'] ?? 'draft')))}
        />
        <span>{t('cr.opened_by', { name: String(data['created_by_name'] ?? '') })}</span>
        {typeof data['created_hostname'] === 'string' && (
          <span className="font-mono text-xs">
            {String(data['created_hostname'])}/{String(data['created_agent_type'] ?? '')}
          </span>
        )}
        <span>{t(ORIGIN_LABEL[origin] ?? 'cr.origin.human')}</span>
        <span data-testid="cr-risk">{t(RISK_LABEL[risk] ?? 'cr.risk.normal')}</span>
        <span data-testid="cr-gate">
          {gateTier === null ? t('cr.gate_pending') : t('cr.gate_tier', { tier: gateTier })}
        </span>
      </p>
      {typeof data['rationale_md'] === 'string' && data['rationale_md'] !== '' && (
        <p data-testid="cr-rationale" className="mb-4 text-sm whitespace-pre-wrap">
          {String(data['rationale_md'])}
        </p>
      )}

      <section className="mb-6">
        <SectionTitle>{t('cr.section.delta')}</SectionTitle>
        {/* **델타 뷰는 EP-SPEC-06 그대로다** — 양 끝은 이 CR 의 승인본과 초안으로 고정이다 */}
        <VersionDiff
          diff={diff.data}
          isPending={diff.isPending}
          isError={diff.isError}
          versions={[]}
          from={baseNo}
          to={proposedNo}
          onChange={() => undefined}
          full={full}
          onToggleFull={() => setFull((v) => !v)}
          fixed
        />
      </section>

      <ImpactSection proj={proj} impact={impact} counts={counts} />

      <ActionsAndDecision proj={proj} data={data} impact={impact} live={live} />
    </PageBody>
  );
}

/** ② 승인하면 움직이는 것 — 작업의 몫 · 진행 중 클레임 · 참조 문서 */
function ImpactSection({
  proj,
  impact,
  counts,
}: {
  proj: string;
  impact: Row;
  counts: Record<string, number>;
}): React.JSX.Element {
  const t = useT();
  const tasks = rows(impact['tasks']);
  const claims = rows(impact['claims']);
  const referencing = rows(impact['referencing']);
  return (
    <section data-testid="cr-impact" className="mb-6">
      <SectionTitle>{t('cr.section.impact')}</SectionTitle>
      <p data-testid="cr-impact-summary" className="mb-2 text-sm text-text-mute">
        {t('cr.impact.summary', {
          tasks: Number(counts['tasks'] ?? 0),
          claims: Number(counts['claims'] ?? 0),
          affected: Number(counts['affected_claims'] ?? 0),
          referencing: Number(counts['referencing'] ?? 0),
        })}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Card padded={false} className="px-3 py-2">
          {tasks.length === 0 ? (
            <p className="text-sm text-text-faint">{t('cr.tasks.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {tasks.map((task) => {
                const effect = String(task['effect'] ?? 'none') as keyof typeof EFFECT_LABEL;
                return (
                  <li
                    key={String(task['key'])}
                    data-testid="cr-task"
                    className="flex items-center gap-2"
                  >
                    <EntityLink
                      projectSlug={proj}
                      entity={{ kind: 'task', key: String(task['key']) }}
                    />
                    <StatusBadge
                      token={
                        (TASK_TOKEN[String(task['status']) as keyof typeof TASK_TOKEN] ??
                          'idle') as StatusToken
                      }
                      label={t(statusLabelKey('task', String(task['status'])))}
                    />
                    <span className="min-w-0 flex-1 truncate text-text-mute">
                      {String(task['title'] ?? '')}
                    </span>
                    {typeof task['requirement_ref'] === 'string' && (
                      <Mono className="text-2xs">{String(task['requirement_ref'])}</Mono>
                    )}
                    <StatusBadge
                      data-testid="cr-task-effect"
                      token={EFFECT_TOKEN[effect] ?? 'idle'}
                      mark={null}
                      label={t(EFFECT_LABEL[effect] ?? 'cr.effect.none')}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card padded={false} className="px-3 py-2">
          {claims.length > 0 && (
            <ul className="mb-2 flex flex-col gap-1 text-sm">
              {claims.map((claim) => (
                <li
                  key={`${String(claim['task_key'])}-${String(claim['user_id'])}`}
                  data-testid="cr-claim"
                  data-affected={claim['affected'] === true || undefined}
                  className="flex flex-wrap items-center gap-2"
                >
                  <EntityLink
                    projectSlug={proj}
                    entity={{ kind: 'task', key: String(claim['task_key']) }}
                  />
                  <span>{String(claim['user_name'] ?? '')}</span>
                  {typeof claim['hostname'] === 'string' && (
                    <span className="font-mono text-xs text-text-mute">
                      {String(claim['hostname'])}/{String(claim['agent_type'] ?? '')}
                    </span>
                  )}
                  {claim['affected'] === true && (
                    <StatusBadge token="danger" mark={null} label={t('cr.claim.affected')} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {referencing.length === 0 ? (
            <p className="text-sm text-text-faint">{t('cr.referencing.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {referencing.map((ref) => (
                <li key={String(ref['key'])} data-testid="cr-referencing" className="flex gap-2">
                  <EntityLink
                    projectSlug={proj}
                    entity={{ kind: 'spec', key: String(ref['key']) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-text-mute">
                    {String(ref['title'] ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

/** ③ 승인하며 함께 할 일 + ④ 결정 */
function ActionsAndDecision({
  proj,
  data,
  impact,
  live,
}: {
  proj: string;
  data: Row;
  impact: Row;
  live: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const onApiError = useApiError();
  const { pushToast } = useRealtime();
  const rolesOnly = useRolesOnly();
  const me = useMe();
  const { orgSlug } = useScope(proj);
  const roles = rolesInProject(me.data, orgSlug, proj);
  const status = String(data['status'] ?? 'open');
  const key = String(data['key'] ?? '');
  const suggestions = (impact['suggestions'] ?? {}) as Row;
  const derive = rows(suggestions['derive']);
  const reverify = rows(suggestions['reverify']);
  const cancel = rows(suggestions['cancel']);
  // **null 은 "고른 적 없음"이다**(2026-10-16 사람 결정 · api.md REQ-API-351) — 빈 선택(세 칸이 빈 배열)은 "아무것도 하지
  // 않기로" 고른 것이라 그대로 보인다
  const planned = (data['planned_actions'] ?? null) as Row | null;
  /**
   * **처음 고른 것** — 누가 이미 골라 두었으면(T3 의 첫 승인 등 — 빈 선택 포함) 그것, 아니면 만들기 둘(파생 · 재검증)을 켜 두고
   * 보관은 꺼 둔다. 보관은 작업을 목록에서 빼는 일이라 사람이 직접 켠다. 이 기본 체크는 서버가 고른 적 없는 CR 을 승인할 때
   * 적용하는 기본값과 같다
   */
  const initial = (): Picked =>
    planned === null
      ? {
          derive: derive.map((d) => String(d['ref'])),
          reverify: reverify.map((r) => String(r['ref'])),
          cancel: [],
        }
      : {
          derive: strings(planned['derive']),
          reverify: strings(planned['reverify']),
          cancel: strings(planned['cancel']),
        };
  const [picked, setPicked] = useState<Picked>(initial);
  // 다른 CR 로 옮겨 오거나 서버가 고른 것이 바뀌면 다시 맞춘다 — 키와 서버 값만 본다
  const plannedSignature = `${key}:${JSON.stringify(planned)}`;
  const [seenSignature, setSeenSignature] = useState(plannedSignature);
  if (seenSignature !== plannedSignature) {
    setSeenSignature(plannedSignature);
    setPicked(initial());
  }
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const press = usePressKey('cr');
  const isAuthor =
    me.data !== undefined &&
    (me.data['id'] === data['created_by_user_id'] || me.data['id'] === data['author_user_id']);
  const canReject = roles.some((r) => (CR_REJECT_ROLES as readonly string[]).includes(r));
  const canDirect = roles.some((r) => (DIRECT_APPROVE_ROLES as readonly string[]).includes(r));
  const approvalId = typeof data['approval_id'] === 'string' ? data['approval_id'] : null;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.changeRequest(key) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
    void queryClient.invalidateQueries({ queryKey: ['spec'] });
  };
  const toggle = (kind: keyof Picked, value: string): void =>
    setPicked((prev) => ({
      ...prev,
      [kind]: prev[kind].includes(value)
        ? prev[kind].filter((v) => v !== value)
        : [...prev[kind], value],
    }));

  const decide = useMutation({
    mutationFn: (kind: 'approve' | 'reject_review' | 'direct') => {
      if (kind === 'direct') {
        return apiFetch<Row>(
          `/projects/${proj}/spec-versions/${String(data['proposed_version_id'])}/approve`,
          {
            method: 'POST',
            body: { seen_content_hash: data['content_hash'], cr_actions: picked },
            idempotencyKey: press.take(),
          },
        );
      }
      return apiFetch<Row>(`/approvals/${approvalId ?? ''}/decision`, {
        method: 'POST',
        body:
          kind === 'approve'
            ? { decision: 'approve', seen_content_hash: data['content_hash'], cr_actions: picked }
            : { decision: 'reject', comment: reason, seen_content_hash: data['content_hash'] },
        idempotencyKey: press.take(),
      });
    },
    onSettled: press.release,
    onSuccess: (result, kind) => {
      refresh();
      const quorum = (
        result as { quorum?: { given: number; required: number; satisfied: boolean } }
      ).quorum;
      if (
        kind !== 'reject_review' &&
        (quorum?.satisfied === false || (result as Row)['status'] === 'in_review')
      ) {
        pushToast({ tone: 'warn', message: t('cr.toast.waiting') });
        return;
      }
      pushToast({
        tone: 'ok',
        message:
          kind === 'reject_review'
            ? t('cr.toast.returned')
            : withCrOutcome(t, t('cr.toast.approved'), [result]),
      });
    },
    onError: onApiError,
  });

  const close = useMutation({
    mutationFn: (kind: 'reject' | 'withdraw') =>
      apiFetch<Row>(`/projects/${proj}/crs/${encodeURIComponent(key)}/${kind}`, {
        method: 'POST',
        body: kind === 'reject' ? { reason } : reason.trim() === '' ? {} : { reason },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: (_result, kind) => {
      refresh();
      pushToast({
        tone: 'ok',
        message: kind === 'reject' ? t('cr.toast.rejected') : t('cr.toast.withdrawn'),
      });
    },
    onError: onApiError,
  });
  const busy = decide.isPending || close.isPending;
  const needReason = (then: () => void): void => {
    if (reason.trim() === '') {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    then();
  };

  const outcome = (data['outcome'] ?? null) as Row | null;
  const created = rows(outcome?.['created_tasks']);
  const archived = strings(outcome?.['archived_tasks']);
  const suggestionCount = derive.length + reverify.length + cancel.length;

  return (
    <>
      <section data-testid="cr-actions" className="mb-6">
        <SectionTitle>{t('cr.section.actions')}</SectionTitle>
        {status === 'approved' ? (
          <div data-testid="cr-outcome" className="text-sm">
            {/* **고른 것인가, 기본값인가**(2026-10-17 · REQ-WEB-339 · api.md REQ-API-359) — 아무도 고르지 않은 채 받은 요청
                카드에서 승인했으면 기본값이 한 일이다. 그것을 모르면 「왜 이 작업이 생겼나」에 답하지 못한다 */}
            {(outcome?.['actions_source'] === 'default' ||
              outcome?.['actions_source'] === 'chosen') && (
              <p data-testid="cr-outcome-source" className="mb-2 text-xs text-text-mute">
                {outcome['actions_source'] === 'default'
                  ? t('cr.result.source_default')
                  : t('cr.result.source_chosen')}
              </p>
            )}
            {created.length + archived.length === 0 ? (
              <p className="text-text-faint">{t('cr.outcome.none')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {created.map((task) => (
                  <li key={String(task['key'])} className="flex items-center gap-2">
                    <span className="text-text-mute">{t('cr.outcome.created')}</span>
                    <EntityLink
                      projectSlug={proj}
                      entity={{ kind: 'task', key: String(task['key']) }}
                    />
                    <Mono className="text-2xs">{String(task['ref'] ?? '')}</Mono>
                  </li>
                ))}
                {archived.map((taskKey) => (
                  <li key={taskKey} className="flex items-center gap-2">
                    <span className="text-text-mute">{t('cr.outcome.archived')}</span>
                    <EntityLink projectSlug={proj} entity={{ kind: 'task', key: taskKey }} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : !live ? (
          <p className="text-sm text-text-faint">{t('cr.actions.closed')}</p>
        ) : suggestionCount === 0 ? (
          <p className="text-sm text-text-faint">{t('cr.actions.none')}</p>
        ) : (
          <>
            <p className="mb-2 text-2xs text-text-faint">{t('cr.actions.hint')}</p>
            {planned === null && (
              <p data-testid="cr-actions-default" className="mb-2 text-2xs text-text-faint">
                {t('cr.actions.default_hint')}
              </p>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {derive.map((d) => (
                <Pick
                  key={`derive-${String(d['ref'])}`}
                  testId="cr-pick-derive"
                  checked={picked.derive.includes(String(d['ref']))}
                  onChange={() => toggle('derive', String(d['ref']))}
                  label={t('cr.action.derive', { ref: String(d['ref']) })}
                  detail={String(d['statement'] ?? '')}
                />
              ))}
              {reverify.map((r) => (
                <Pick
                  key={`reverify-${String(r['ref'])}`}
                  testId="cr-pick-reverify"
                  checked={picked.reverify.includes(String(r['ref']))}
                  onChange={() => toggle('reverify', String(r['ref']))}
                  label={t('cr.action.reverify', {
                    ref: String(r['ref']),
                    n: strings(r['done_tasks']).length,
                  })}
                  detail={strings(r['done_tasks']).join(', ')}
                />
              ))}
              {cancel.map((c) => (
                <Pick
                  key={`cancel-${String(c['task_key'])}`}
                  testId="cr-pick-cancel"
                  checked={picked.cancel.includes(String(c['task_key']))}
                  onChange={() => toggle('cancel', String(c['task_key']))}
                  label={t('cr.action.cancel', { task: String(c['task_key']) })}
                  detail={`${String(c['ref'] ?? '')} · ${String(c['title'] ?? '')}`}
                />
              ))}
            </ul>
          </>
        )}
      </section>

      <section data-testid="cr-decision" className="mb-6">
        <SectionTitle>{t('cr.section.decision')}</SectionTitle>
        {status === 'open' && (
          <p className="mb-2 text-sm text-text-mute">
            {t('cr.decision.open')}{' '}
            <Link
              to="/p/$proj/specs/$spec"
              params={{ proj, spec: String(data['spec_key']) }}
              search={{ v: Number(data['proposed_version_no']) }}
              data-testid="cr-open-doc"
              className="text-link hover:underline"
            >
              {t('cr.decision.open_doc')}
            </Link>
          </p>
        )}
        {status === 'in_review' && (
          <p className="mb-2 text-sm text-text-mute">
            {t('cr.decision.in_review')}{' '}
            {approvalId !== null && (
              <Link
                to="/inbox"
                search={{ focus: approvalId }}
                data-testid="cr-open-inbox"
                className="text-link hover:underline"
              >
                {t('cr.decision.open_inbox')}
              </Link>
            )}
          </p>
        )}
        {(status === 'rejected' || status === 'withdrawn') && (
          <p data-testid="cr-closed" className="text-sm text-text-mute">
            {t('cr.decision.closed', {
              status: t(statusLabelKey('cr', status)),
              n: Number(data['proposed_version_no']),
            })}
            {typeof outcome?.['reason'] === 'string' && (
              <span className="mt-1 block whitespace-pre-wrap text-text">
                {String(outcome['reason'])}
              </span>
            )}
          </p>
        )}
        {status === 'approved' && (
          <p className="text-sm text-text-mute">{t('cr.decision.approved')}</p>
        )}
        {live && (
          <>
            <Textarea
              data-testid="cr-reason"
              aria-label={t('cr.decision.reason')}
              placeholder={t('cr.decision.reason')}
              value={reason}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
              className={cn('mb-2', reasonMissing && 'border-status-danger')}
            />
            {reasonMissing && (
              <p role="alert" className="mb-2 text-2xs text-status-danger">
                {t('cr.decision.reason_required')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {status === 'in_review' && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="cr-approve"
                    disabled={busy || approvalId === null}
                    onClick={() => decide.mutate('approve')}
                  >
                    {t('inbox.key.approve')}
                  </Button>
                  <Button
                    size="sm"
                    data-testid="cr-reject-review"
                    disabled={busy || approvalId === null}
                    onClick={() => needReason(() => decide.mutate('reject_review'))}
                  >
                    {t('cr.decision.reject_review')}
                  </Button>
                </>
              )}
              {status === 'open' && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="cr-direct-approve"
                    disabled={busy || !canDirect}
                    disabledReason={canDirect ? undefined : rolesOnly(DIRECT_APPROVE_ROLES)}
                    onClick={() => decide.mutate('direct')}
                  >
                    {t('spec.direct_approve')}
                  </Button>
                  <Button
                    size="sm"
                    data-testid="cr-reject"
                    disabled={busy || !canReject}
                    disabledReason={canReject ? undefined : rolesOnly(CR_REJECT_ROLES)}
                    title={t('cr.decision.reject_hint')}
                    onClick={() => needReason(() => close.mutate('reject'))}
                  >
                    {t('cr.decision.reject')}
                  </Button>
                  {isAuthor && (
                    <Button
                      size="sm"
                      variant="subtle"
                      data-testid="cr-withdraw"
                      disabled={busy}
                      title={t('cr.decision.withdraw_hint')}
                      onClick={() => close.mutate('withdraw')}
                    >
                      {t('cr.decision.withdraw')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function Pick({
  checked,
  onChange,
  label,
  detail,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
  testId: string;
}): React.JSX.Element {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          data-testid={testId}
          checked={checked}
          onChange={onChange}
          className="mt-1 size-3.5 shrink-0 accent-status-action"
        />
        <span className="min-w-0">
          <span className="font-medium">{label}</span>
          {detail !== '' && (
            <span className="block truncate text-2xs text-text-faint">{detail}</span>
          )}
        </span>
      </label>
    </li>
  );
}
