// 일괄 결정 — 확인 창과 보내는 길 한 벌 (EP-APR-06 · REQ-WEB-181~183 · 2026-10-04 REQ-WEB-292)
//
// 받은 요청에만 있던 것을 스펙 목록도 쓴다(사람 결정 A1 — "확인 창은 받은 요청의 것을 그대로 쓴다"). 두 자리가
// 각자 그리면 "무엇을 승인하는가" 를 나열하는 방식 · 빠지는 것의 이유 · 거절 사유의 필수 여부가 언젠가 갈린다.
// 판정은 서버의 것이다 — 이 파일은 서버가 준 `can_bulk_approve` · 사유를 읽기만 한다(REQ-API-163).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useT } from '../../lib/i18n.js';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { queryKeys } from '../../lib/query-keys.js';
import type { Row } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button, Textarea } from '../../components/ui/primitives.js';
import { ScopeBadge } from '../../components/scope-badge.js';
import { bulkBlockText } from './approval-card.js';
import type { CardFailure } from './approval-card.js';

export interface BulkResult {
  id: string;
  ok: boolean;
  kind?: string | null;
  message?: string;
}

export type BulkDecision = 'approve' | 'reject';

/** **저위험 판정은 서버의 것이다**(`can_bulk_approve` · REQ-API-163) — 화면은 읽기만 한다 */
export function bulkApprovable(card: Row): boolean {
  return card['can_bulk_approve'] === true;
}

/**
 * 일괄 결정을 보낸다. 멱등 키는 **확인 창을 연 시점에** 잡는다(`open`) — 같은 배치의 재전송은 한 번만
 * 실행되고(api.md §1.5), 다음 배치는 새 키를 받는다. 실패한 건은 서버가 준 이유와 함께 돌려준다.
 */
export function useBulkDecision(onDone: (failures: Map<string, CardFailure>) => void): {
  open: () => void;
  submit: (decision: BulkDecision, cards: readonly Row[], reason: string) => void;
  pending: boolean;
} {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const batchKey = useRef<string>('');

  const bulk = useMutation({
    mutationFn: (input: { decision: BulkDecision; cards: readonly Row[]; reason: string }) =>
      apiFetch<{ decided: number; failed: number; results: BulkResult[] }>('/approvals/decisions', {
        method: 'POST',
        body: {
          decision: input.decision,
          comment: input.reason,
          // **건마다 지문을 싣는다**(REQ-API-162). 일괄이 stale 검사를 건너뛰면 일괄
          // 승인이 그 방어의 구멍이 된다 — 본문이 바뀐 한 건만 막히고 나머지는 지나간다.
          items: input.cards.map((card) => ({
            id: String(card['id']),
            ...(typeof card['content_hash'] === 'string'
              ? { seen_content_hash: card['content_hash'] }
              : {}),
          })),
        },
        idempotencyKey: `bulk-${batchKey.current}`,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox() });
      // **실패한 것만 남긴다.** 목록이 통째로 비면 사람은 전부 처리됐다고 읽는데,
      // 남은 것이 있으면 그것이 거짓말이 된다.
      const failed = new Map<string, CardFailure>();
      for (const item of result.results)
        if (!item.ok)
          failed.set(item.id, {
            kind: item.kind ?? null,
            message: item.message ?? t('inbox.bulk.blocked.not_eligible'),
          });
      onDone(failed);
      pushToast(
        result.failed === 0
          ? // 결재 처리 트레일 — 한 건씩 결정할 때와 같은 3분이다(REQ-WEB-197)
            { tone: 'ok', kind: 'trail', message: t('inbox.bulk.done', { n: result.decided }) }
          : {
              tone: 'warn',
              kind: 'trail',
              message: t('inbox.bulk.partial', { n: result.decided, failed: result.failed }),
            },
      );
    },
    onError: onApiError,
  });

  return {
    open: () => {
      batchKey.current = crypto.randomUUID();
    },
    submit: (decision, cards, reason) => bulk.mutate({ decision, cards, reason }),
    pending: bulk.isPending,
  };
}

/**
 * **무엇을 승인하는지 나열한다.** 본문을 열지 않고 결정하는 조작이라, 이 목록이 남은 유일한 "무엇을
 * 승인하는가" 다(spec-workflow §6.4 — 원문 우선의 최소치). 승인은 일괄 승인할 수 있는 것만, 거절은 고른 것
 * 전부를 나열하고, 빠지는 것은 이유와 함께 따로 적는다(REQ-WEB-182).
 */
export function BulkConfirm({
  confirming,
  chosen,
  reason,
  onReason,
  pending,
  onSubmit,
  onCancel,
  showScope = true,
}: {
  confirming: BulkDecision;
  chosen: readonly Row[];
  reason: string;
  onReason: (next: string) => void;
  pending: boolean;
  onSubmit: (decision: BulkDecision, targets: readonly Row[]) => void;
  onCancel: () => void;
  /** 받은 요청은 조직 · 프로젝트를 가로지르므로 줄마다 범위를 단다 — 한 프로젝트 안이면 뺀다 */
  showScope?: boolean;
}): React.JSX.Element {
  const t = useT();
  const approvable = chosen.filter(bulkApprovable);
  const targets = confirming === 'approve' ? approvable : chosen;
  return (
    <form
      data-testid="bulk-confirm"
      className="mb-2 rounded-nerv border border-border bg-bg-elev p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (confirming === 'reject' && reason.trim() === '') return;
        onSubmit(confirming, targets);
      }}
    >
      <p className="text-2xs font-semibold text-text">
        {confirming === 'approve'
          ? t('inbox.bulk.confirm_approve', { count: targets.length })
          : t('inbox.bulk.confirm_reject', { count: targets.length })}
      </p>
      <p className="mt-0.5 text-2xs text-text-faint">{t('inbox.bulk.confirm_hint')}</p>
      {/* **빠지는 것과 그 까닭**(REQ-WEB-182). 수만 적으면 사람은 어느 것이 왜 빠졌는지
          카드를 하나씩 열어 봐야 한다 — 서버가 카드마다 이유를 준다(REQ-API-163) */}
      {confirming === 'approve' && chosen.length > approvable.length && (
        <div data-testid="bulk-skipped" className="mt-1 text-2xs text-status-waiting">
          <p>{t('inbox.bulk.skipped', { count: chosen.length - approvable.length })}</p>
          <ul data-testid="bulk-skipped-list" className="mt-0.5 flex flex-col gap-0.5">
            {chosen
              .filter((card) => !bulkApprovable(card))
              .map((card) => (
                <li key={String(card['id'])} className="flex gap-2">
                  <span className="shrink-0 font-mono">
                    {String(card['spec_key'] ?? card['task_key'] ?? '')}
                  </span>
                  <span className="min-w-0 flex-1">{bulkBlockText(t, card)}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      <ul
        data-testid="bulk-list"
        className="mt-2 max-h-56 overflow-y-auto rounded-nerv-sm bg-bg-sunken px-2.5 py-2 text-xs"
      >
        {targets.map((card) => (
          <li key={String(card['id'])} className="flex gap-2 py-0.5">
            <span className="shrink-0 font-mono text-text-mute">
              {String(card['spec_key'] ?? card['task_key'] ?? '')}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {String(card['title'] ?? card['spec_title'] ?? '')}
            </span>
            {showScope && (
              <ScopeBadge
                className="shrink-0"
                orgSlug={card['org_slug']}
                orgName={card['org_name']}
                projectSlug={card['project_slug']}
                projectName={card['project_name']}
              />
            )}
          </li>
        ))}
      </ul>
      {/* **거절 사유는 일괄에도 필수다**(REQ-WEB-022) — 전 건에 같은 사유가 남는다 */}
      {confirming === 'reject' && (
        <label className="mt-2 block text-2xs text-text-mute">
          {t('inbox.bulk.reason')}
          <Textarea
            data-testid="bulk-reason"
            rows={2}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            className="mt-1"
          />
        </label>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant={confirming === 'approve' ? 'primary' : 'danger'}
          data-testid="bulk-submit"
          disabled={
            pending || targets.length === 0 || (confirming === 'reject' && reason.trim() === '')
          }
        >
          {t('inbox.bulk.submit')}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          {t('inbox.bulk.cancel')}
        </Button>
      </div>
    </form>
  );
}
