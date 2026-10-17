// 에스컬레이션 카드 — 발견을 사람에게 넘긴 처분 한 건 (2026-10-16 · 사람 결정 D3 · screens.md §2.7 · REQ-WEB-325)
//
// 카드가 반드시 보이는 것은 셋이다(spec-workflow §6.4 — 원문 우선): **넘긴 발견의 원문**(제목 · 본문 · 위치 · 커밋) · **왜 넘겼나**
// (사유와 근거) · **누가 기다리나**(세션 신원과 기다림). 결정은 승인 · 거절이 아니라 그 발견의 처분이다 — 고칠 것 · 유예 · 기각
// 가운데 하나이고 근거가 필수다(근거는 넘긴 세션이 그대로 받는다). 사유가 `spec` 이면 넷째 길이 있다 — 변경 요청으로 보내기.
//
// 변경 요청으로 보낸 카드(유형 `cr`)는 모양이 다르다: "구현이 스펙을 바꿨다" 를 알리는 planner 의 카드이고, 결정은 그 CR 의 결말이다
// (초안을 고쳐 검토를 요청하거나 · 변경 요청을 거절한다). 초안이 아직 승인본과 같으면 검토를 요청할 수 없다는 것을 보인다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { MessageKey, Translator } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { useApiError } from '../../lib/api-errors.js';
import { apiFetch } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { usePressKey } from '../../lib/press-key.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { useScope } from '../../lib/scope.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SEVERITY_TOKEN } from '../../components/status-token.js';
import { Button, Mono, Textarea } from '../../components/ui/primitives.js';
import { ScopeBadge } from '../../components/scope-badge.js';
import {
  cannotApproveText,
  CardLink,
  DriftFindings,
  GraceStrip,
  waitedLabel,
} from './approval-card.js';
import { useGrace } from './decision-grace.js';

/** 카드에서 고르는 처분 — 어휘의 정본은 `ESCALATION_RESOLUTIONS` 다(서버가 판정한다) */
const DECISIONS = [
  { resolution: 'fix', decision: 'approve', tone: 'primary' },
  { resolution: 'wont_fix', decision: 'reject', tone: 'subtle' },
  { resolution: 'dismissed', decision: 'reject', tone: 'danger' },
] as const;

/** 누른 처분과 그 순간의 근거 — 5초 뒤에 이것을 보낸다(REQ-WEB-237) */
interface HeldDecision {
  pick: (typeof DECISIONS)[number];
  comment: string;
}

/** 처분의 이름 — 결정 이벤트가 든 값(`resolution`)을 화면 말로 */
const RESOLUTION_LABEL = {
  fix: 'inbox.esc.resolution.fix',
  wont_fix: 'inbox.esc.resolution.wont_fix',
  dismissed: 'inbox.esc.resolution.dismissed',
  fixed: 'inbox.esc.resolution.fixed',
  spec_change: 'inbox.esc.resolution.spec_change',
  change_request: 'inbox.esc.resolution.change_request',
  withdrawn: 'inbox.esc.resolution.withdrawn',
} as const satisfies Record<string, MessageKey>;

export function escalationResolutionLabel(t: Translator, value: unknown): string {
  const key = RESOLUTION_LABEL[String(value) as keyof typeof RESOLUTION_LABEL];
  return key === undefined ? String(value ?? '') : t(key);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function EscalationCard({
  card,
  active,
}: {
  card: Record<string, unknown>;
  active?: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const { orgSlug: currentOrg } = useScope();
  const [comment, setComment] = useState('');
  const [missing, setMissing] = useState(false);
  const press = usePressKey('escalation');
  const id = String(card['id']);
  const proj = String(card['project_slug'] ?? '');
  const decided = str(card['decision']);
  const isCr = card['kind'] === 'cr' || str(card['escalation_cr_key']) !== null;
  const reason = str(card['escalate_reason']);
  const findingId = str(card['finding_id']);
  const title = String(card['finding_title'] ?? '');
  const tags = Array.isArray(card['finding_tags']) ? (card['finding_tags'] as unknown[]) : [];
  const drift = tags.includes('spec_drift');
  const canDecide = card['can_approve'] !== false;
  // 왜 못 누르는가 — 서버가 준 이유를 문장으로(받은 요청의 다른 카드와 같은 함수 · REQ-WEB-145)
  const lockReason = canDecide ? null : cannotApproveText(t, card);
  const done = (): void => {
    setComment('');
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
  };

  const decide = useMutation({
    mutationFn: (held: HeldDecision) =>
      apiFetch(`/approvals/${id}/decision`, {
        method: 'POST',
        body: {
          decision: held.pick.decision,
          resolution: held.pick.resolution,
          comment: held.comment,
        },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: (_result, held) => {
      done();
      pushToast({
        tone: 'ok',
        kind: 'trail',
        message: t('inbox.esc.done', {
          title,
          resolution: escalationResolutionLabel(t, held.pick.resolution),
        }),
      });
    },
    onError: onApiError,
  });

  /**
   * **보내기 전 5초**(REQ-WEB-237) — 받은 요청의 다른 카드와 같다. 처분은 누른 순간의 근거와 함께 카드가 들고 있다가 보내고,
   * 그 사이 [취소] · `z` 로 무른다. 변경 요청으로 보내기 · 변경 요청 거절은 결정이 아니라 다른 화면의 행위라 바로 보낸다.
   */
  const grace = useGrace<HeldDecision>((held) => decide.mutate(held));
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelHeld = grace.cancel;
  useEffect(() => {
    if (active !== true || grace.pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'z' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        cancelHeld();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, grace.pending, cancelHeld]);

  /** 사유가 `spec` 인 카드의 넷째 길 — 발견을 변경 요청으로 보낸다(EP-REV-09) */
  const toCr = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(
        `/projects/${proj}/findings/${String(findingId)}/change-request`,
        {
          method: 'POST',
          body: comment.trim() === '' ? {} : { rationale: comment.trim() },
          idempotencyKey: press.take(),
        },
      ),
    onSettled: press.release,
    onSuccess: (result) => {
      done();
      const key = String((result['change_request'] as Record<string, unknown>)?.['key'] ?? '');
      pushToast({
        tone: 'ok',
        message: t('inbox.esc.to_cr_done', { key }),
        href: `/p/${proj}/crs/${key}`,
        hrefLabel: t('shell.toast.open'),
      });
    },
    onError: onApiError,
  });

  /** 변경 요청 거절(EP-CR-03) — 그 CR 로 보낸 발견을 기각하고 되돌림 작업을 만든다 */
  const crKey = str(card['escalation_cr_key']);
  const rejectCr = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${proj}/crs/${String(crKey)}/reject`, {
        method: 'POST',
        body: { reason: comment.trim() },
        idempotencyKey: press.take(),
      }),
    onSettled: press.release,
    onSuccess: () => {
      done();
      pushToast({ tone: 'ok', message: t('inbox.esc.cr_rejected', { key: String(crKey) }) });
    },
    onError: onApiError,
  });
  const busy = grace.pending !== null || decide.isPending || toCr.isPending || rejectCr.isPending;

  const requireComment = (run: () => void): void => {
    if (comment.trim() === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    run();
  };

  const findingPath = findingId === null ? null : `/p/${proj}/reviews?finding=${findingId}`;
  const cardTitle = isCr ? t('inbox.esc.cr_title') : title;
  const severity = str(card['finding_severity']);
  const commit = str(card['escalation_commit']);
  const location = str(card['finding_file_path']);
  const line = card['finding_line_start'];

  return (
    <article
      tabIndex={-1}
      data-testid="escalation-card"
      data-kind={isCr ? 'cr' : 'escalation'}
      className={cn(
        'rounded-nerv border bg-bg-elev px-3 py-2.5 outline-none',
        active === true ? 'border-border-strong' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge
          token="waiting"
          label={isCr ? t('inbox.kind.cr') : t('inbox.kind.escalation')}
        />
        {isCr && crKey !== null ? (
          <CardLink
            orgSlug={card['org_slug']}
            currentOrg={currentOrg}
            path={`/p/${proj}/crs/${crKey}`}
            to="/p/$proj/crs/$cr"
            params={{ proj, cr: crKey }}
            testId="escalation-cr-link"
          >
            <Mono className="text-link">{crKey}</Mono>
          </CardLink>
        ) : (
          findingPath !== null && (
            <CardLink
              orgSlug={card['org_slug']}
              currentOrg={currentOrg}
              path={findingPath}
              to="/p/$proj/reviews"
              params={{ proj }}
              search={{ finding: String(findingId) }}
              testId="escalation-finding-link"
            >
              <Mono className="text-link">{String(findingId).slice(-8)}</Mono>
            </CardLink>
          )
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{cardTitle}</span>
        {reason !== null && !isCr && (
          <span data-testid="escalation-reason" className="shrink-0 text-xs text-text-mute">
            {t('inbox.esc.reason', {
              reason: t(`question.escalate.${reason}` as 'question.escalate.spec'),
            })}
          </span>
        )}
        <ScopeBadge
          className="shrink-0"
          orgSlug={card['org_slug']}
          orgName={card['org_name']}
          projectSlug={card['project_slug']}
          projectName={card['project_name']}
        />
        {decided === null ? (
          <span className="shrink-0 text-xs text-text-faint">
            {waitedLabel(t, Number(card['waiting_seconds'] ?? 0))}
          </span>
        ) : (
          <span data-testid="escalation-decided" className="shrink-0 text-xs text-text-faint">
            {t('inbox.esc.resolved', {
              resolution: escalationResolutionLabel(t, card['escalation_resolution'] ?? decided),
              when: relativeTime(t, String(card['decided_at'] ?? '')),
            })}
          </span>
        )}
      </header>

      {/* **누가 · 어느 세션이 기다리나** — 기다리는 처분이면 이 결정이 그 세션을 바로 푼다(REQ-API-335) */}
      <p
        data-testid="escalation-request-line"
        className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-mute"
      >
        <span>{t('inbox.card.requested_by', { who: String(card['requested_by'] ?? '—') })}</span>
        {typeof card['requested_hostname'] === 'string' && (
          <span className="font-mono text-text-faint">
            · {card['requested_hostname']} · {String(card['requested_agent_type'] ?? '')}
          </span>
        )}
        {!isCr &&
          (card['session_waiting'] === true ? (
            <StatusBadge
              data-testid="escalation-waiting"
              token="waiting"
              mark={null}
              label={t('inbox.esc.waiting')}
            />
          ) : (
            card['escalation_blocking'] === false && (
              <span className="text-text-faint">· {t('inbox.esc.not_waiting')}</span>
            )
          ))}
      </p>

      {isCr ? (
        <CrDriftBody card={card} proj={proj} currentOrg={currentOrg} />
      ) : (
        <div data-testid="escalation-original" className="mt-2 flex flex-col gap-1.5 text-xs">
          <p className="flex flex-wrap items-center gap-x-2 text-text-mute">
            {severity !== null && (
              <StatusBadge
                token={SEVERITY_TOKEN[severity as 'info'] ?? 'idle'}
                label={t(`severity.${severity}` as 'severity.info')}
              />
            )}
            {location !== null && (
              <span className="font-mono">
                {t('inbox.esc.location', {
                  location: `${location}${typeof line === 'number' ? `:${line}` : ''}`,
                })}
              </span>
            )}
            {commit !== null && (
              <span data-testid="escalation-commit" className="font-mono">
                {t('inbox.esc.commit', {
                  sha: commit.slice(0, 12),
                  branch: String(card['escalation_branch'] ?? ''),
                })}
              </span>
            )}
            {str(card['finding_task_key']) !== null && (
              <span>
                {str(card['finding_task_assignee']) === null
                  ? t('inbox.esc.task_unassigned', { key: String(card['finding_task_key']) })
                  : t('inbox.esc.task', {
                      key: String(card['finding_task_key']),
                      name: String(card['finding_task_assignee']),
                    })}
              </span>
            )}
          </p>
          {str(card['finding_detail_md']) !== null && (
            <div>
              <span className="block text-2xs text-text-faint">{t('inbox.esc.detail')}</span>
              <p className="mt-0.5 max-h-40 overflow-y-auto rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm whitespace-pre-wrap text-text-mute">
                {String(card['finding_detail_md'])}
              </p>
            </div>
          )}
          {str(card['escalation_rationale']) !== null && (
            <div data-testid="escalation-rationale">
              <span className="block text-2xs text-text-faint">{t('inbox.esc.rationale')}</span>
              <p className="mt-0.5 text-sm whitespace-pre-wrap text-text-mute">
                {String(card['escalation_rationale'])}
              </p>
            </div>
          )}
        </div>
      )}

      {decided !== null && str(card['comment_md']) !== null && (
        <div
          data-testid="decision-note"
          className="mt-2 rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-sm"
        >
          <span className="block text-2xs text-text-faint">{t('inbox.card.decision_note')}</span>
          <span className="mt-0.5 block whitespace-pre-wrap text-text-mute">
            {String(card['comment_md'])}
          </span>
        </div>
      )}

      {decided === null && (
        <>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            readOnly={busy}
            placeholder={
              isCr ? t('inbox.esc.cr_reason_placeholder') : t('inbox.esc.rationale_placeholder')
            }
            data-testid="escalation-comment"
            className="mt-2"
            rows={2}
          />
          {missing && (
            <p
              role="alert"
              data-testid="escalation-missing"
              className="mt-1 text-xs text-status-danger"
            >
              {t('inbox.esc.rationale_required')}
            </p>
          )}
          <footer className="mt-2.5 flex flex-wrap items-center gap-2">
            {grace.pending !== null || decide.isPending ? (
              <GraceStrip
                label={
                  grace.pending === null
                    ? null
                    : t(
                        `inbox.esc.decide.${grace.pending.pick.resolution}` as 'inbox.esc.decide.fix',
                      )
                }
                active={active === true}
                cancelRef={cancelRef}
                onCancel={grace.cancel}
              />
            ) : isCr ? (
              <Button
                size="sm"
                variant="danger"
                data-testid="escalation-cr-reject"
                disabled={busy || crKey === null || !canDecide}
                disabledReason={canDecide ? undefined : (lockReason ?? undefined)}
                title={t('inbox.esc.cr_reject_hint')}
                onClick={() => requireComment(() => rejectCr.mutate())}
                requiresOnline
              >
                {t('inbox.esc.cr_reject')}
              </Button>
            ) : (
              <>
                {DECISIONS.map((pick) => (
                  <Button
                    key={pick.resolution}
                    size="sm"
                    variant={pick.tone}
                    data-testid={`escalation-${pick.resolution}`}
                    disabled={busy || !canDecide}
                    disabledReason={canDecide ? undefined : (lockReason ?? undefined)}
                    title={t(
                      `inbox.esc.decide.${pick.resolution}_hint` as 'inbox.esc.decide.fix_hint',
                    )}
                    onClick={() =>
                      requireComment(() => {
                        grace.hold({ pick, comment: comment.trim() });
                        window.setTimeout(() => cancelRef.current?.focus(), 0);
                      })
                    }
                    requiresOnline
                  >
                    {t(`inbox.esc.decide.${pick.resolution}` as 'inbox.esc.decide.fix')}
                  </Button>
                ))}
                {/* **사유가 spec 이면 변경 요청으로 보낸다**(REQ-WEB-325) — spec_drift 발견만 받는다. 근거는 선택이다 */}
                {reason === 'spec' && findingId !== null && (
                  <Button
                    size="sm"
                    data-testid="escalation-to-cr"
                    disabled={busy || !drift || !canDecide}
                    disabledReason={
                      !drift
                        ? t('inbox.esc.to_cr_no_tag')
                        : canDecide
                          ? undefined
                          : (lockReason ?? undefined)
                    }
                    title={t('inbox.esc.to_cr_hint')}
                    onClick={() => toCr.mutate()}
                    requiresOnline
                  >
                    {t('inbox.esc.to_cr')}
                  </Button>
                )}
              </>
            )}
          </footer>
        </>
      )}
    </article>
  );
}

/**
 * **변경 요청으로 보낸 카드의 몸**(REQ-WEB-324) — CR 키 · 버전 · 초안 상태와 그 CR 로 보낸 발견(제목 · 커밋). 초안이 승인본과 같으면
 * 검토를 요청할 수 없다는 것을 먼저 말한다 — 누르고 나서 409 를 받게 하지 않는다.
 */
function CrDriftBody({
  card,
  proj,
  currentOrg,
}: {
  card: Record<string, unknown>;
  proj: string;
  currentOrg: string | null;
}): React.JSX.Element {
  const t = useT();
  const crKey = str(card['escalation_cr_key']);
  const specKey = str(card['escalation_cr_spec_key']);
  const draftNo = card['escalation_cr_version_no'];
  const unchanged = card['escalation_cr_unchanged'] === true;
  const findings = Array.isArray(card['cr_findings'])
    ? (card['cr_findings'] as Record<string, unknown>[])
    : [];
  return (
    <div data-testid="escalation-cr-body" className="mt-2 flex flex-col gap-1.5 text-xs">
      <p className="flex flex-wrap items-center gap-x-2 text-text-mute">
        {typeof card['escalation_cr_base_version_no'] === 'number' &&
          typeof draftNo === 'number' && (
            <span className="font-mono">
              {specKey ?? ''} v{String(card['escalation_cr_base_version_no'])} → v{String(draftNo)}
            </span>
          )}
        {crKey !== null && (
          <CardLink
            orgSlug={card['org_slug']}
            currentOrg={currentOrg}
            path={`/p/${proj}/crs/${crKey}`}
            to="/p/$proj/crs/$cr"
            params={{ proj, cr: crKey }}
            testId="escalation-cr-open"
          >
            {t('inbox.esc.cr_open')} ▸
          </CardLink>
        )}
        {specKey !== null && typeof draftNo === 'number' && (
          <CardLink
            orgSlug={card['org_slug']}
            currentOrg={currentOrg}
            path={`/p/${proj}/specs/${specKey}?v=${String(draftNo)}`}
            to="/p/$proj/specs/$spec"
            params={{ proj, spec: specKey }}
            search={{ v: draftNo }}
            testId="escalation-cr-edit"
          >
            {t('inbox.esc.cr_edit')} ▸
          </CardLink>
        )}
      </p>
      <p
        data-testid="escalation-cr-state"
        data-unchanged={unchanged || undefined}
        className={cn(
          'rounded-nerv-sm px-2 py-1',
          unchanged ? 'bg-status-waiting-soft text-status-waiting' : 'bg-bg-sunken text-text-mute',
        )}
      >
        {unchanged ? t('inbox.esc.cr_unchanged') : t('inbox.esc.cr_changed')}
      </p>
      <DriftFindings card={card} proj={proj} currentOrg={currentOrg} findings={findings} />
    </div>
  );
}
