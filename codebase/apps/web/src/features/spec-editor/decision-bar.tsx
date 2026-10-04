// 스펙 목록의 결정 막대 — 트리에서 고른 문서를 한꺼번에 결재한다 (2026-10-04 · 사람 결정 A1 · A3 · REQ-WEB-292)
//
// 한꺼번에 결정하는 기능은 받은 요청에만 있었다. 스펙을 트리로 훑던 사람이 같은 묶음을 결재하려면 받은 요청으로
// 건너가 카드를 다시 찾아야 했다. 확인 창과 보내는 길은 받은 요청과 한 벌이고(`bulk-decision.tsx`), 판정
// (자기 승인 · T3 · 게이트 면제 · 50건)은 서버의 것이다(EP-APR-06 · REQ-API-162~164).

import { BULK_DECISION_LIMIT } from '@nerv/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { queryKeys } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';
import type { Row } from '../../lib/queries.js';
import { Button } from '../../components/ui/primitives.js';
import type { CardFailure } from '../inbox/approval-card.js';
import { BulkConfirm, bulkApprovable, useBulkDecision } from '../inbox/bulk-decision.js';
import type { BulkDecision } from '../inbox/bulk-decision.js';

export function DecisionBar({
  projectId,
  pending,
  selected,
  onSelect,
}: {
  projectId: ProjectId | undefined;
  /** 이 프로젝트에서 내가 결정할 수 있는 스펙 결재 — 문서마다 한 줄(EP-SPEC-26) */
  pending: readonly Row[];
  selected: ReadonlySet<string>;
  onSelect: (keys: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<BulkDecision | null>(null);
  const [reason, setReason] = useState('');
  const [failures, setFailures] = useState<Map<string, CardFailure>>(new Map());

  // 확인 창의 줄은 결재 칸이다 — `id` 가 결재 ID 여야 일괄 결정이 그것을 받는다
  const cards: Row[] = pending.map((row): Row => ({ ...row, id: String(row['approval_id']) }));
  const chosen = cards.filter((card) => selected.has(String(card['spec_key'])));
  const approvable = chosen.filter(bulkApprovable);

  const bulk = useBulkDecision((failed) => {
    setFailures(failed);
    // **실패한 것만 고른 채로 남긴다** — 받은 요청과 같다(REQ-WEB-183)
    onSelect(
      new Set(
        cards.filter((card) => failed.has(String(card['id']))).map((c) => String(c['spec_key'])),
      ),
    );
    setConfirming(null);
    setReason('');
    if (projectId !== undefined) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectPendingApprovals(projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecGraph(projectId) });
    }
  });

  const open = (decision: BulkDecision): void => {
    if (decision === 'approve' ? approvable.length === 0 : chosen.length === 0) return;
    bulk.open();
    setConfirming(decision);
  };

  return (
    <div className="mb-2">
      <div
        data-testid="decision-bar"
        role="toolbar"
        aria-label={t('specs.decide.bar')}
        className="flex flex-wrap items-center gap-2 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm"
      >
        <span data-testid="decision-count" className="tabular-nums text-text-mute">
          {pending.length === 0
            ? t('specs.decide.none')
            : chosen.length === 0
              ? t('specs.decide.hint', { count: pending.length })
              : t('specs.decide.selected', { count: chosen.length, max: BULK_DECISION_LIMIT })}
        </span>
        <Button
          size="sm"
          variant="subtle"
          data-testid="decision-select-approvable"
          disabled={cards.filter(bulkApprovable).length === 0}
          onClick={() =>
            onSelect(
              new Set(
                cards
                  .filter(bulkApprovable)
                  .slice(0, BULK_DECISION_LIMIT)
                  .map((card) => String(card['spec_key'])),
              ),
            )
          }
        >
          {t('inbox.bulk.select_approvable')}
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          data-testid="decision-approve"
          disabled={approvable.length === 0 || bulk.pending}
          disabledReason={chosen.length === 0 ? t('specs.decide.pick_first') : undefined}
          onClick={() => open('approve')}
        >
          {t('inbox.bulk.approve')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          data-testid="decision-reject"
          disabled={chosen.length === 0 || bulk.pending}
          disabledReason={chosen.length === 0 ? t('specs.decide.pick_first') : undefined}
          onClick={() => open('reject')}
        >
          {t('inbox.bulk.reject')}
        </Button>
        {chosen.length > 0 && (
          <Button
            size="sm"
            variant="subtle"
            data-testid="decision-clear"
            onClick={() => onSelect(new Set())}
          >
            {t('inbox.bulk.clear')}
          </Button>
        )}
      </div>
      {/* 못 지나간 것과 그 까닭 — 서버가 건마다 준다(REQ-WEB-183). 트리 줄에는 둘 자리가 없어 여기 모은다 */}
      {failures.size > 0 && (
        <ul
          data-testid="decision-failures"
          className="mt-1 flex flex-col gap-0.5 text-2xs text-status-danger"
        >
          {cards
            .filter((card) => failures.has(String(card['id'])))
            .map((card) => (
              <li key={String(card['id'])} className="flex gap-2">
                <span className="shrink-0 font-mono">{String(card['spec_key'])}</span>
                <span className="min-w-0 flex-1">{failures.get(String(card['id']))?.message}</span>
              </li>
            ))}
        </ul>
      )}
      {confirming !== null && (
        <div className="mt-2">
          <BulkConfirm
            confirming={confirming}
            chosen={chosen}
            reason={reason}
            onReason={setReason}
            pending={bulk.pending}
            onSubmit={(decision, targets) => bulk.submit(decision, targets, reason)}
            onCancel={() => setConfirming(null)}
            showScope={false}
          />
        </div>
      )}
    </div>
  );
}
