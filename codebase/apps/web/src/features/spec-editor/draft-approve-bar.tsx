// 스펙 목록의 초안 바로 승인 막대 — 고른 초안을 검토 요청과 승인 한 번으로 확정한다 (2026-10-11 사람 결정 · REQ-WEB-304)
//
// "결재 대기"의 결정 막대(`decision-bar.tsx`)와 같은 모양이고 확인 창도 같은 것이다(`BulkConfirm`) — "무엇을
// 승인하는가" 를 나열하는 방식이 두 벌이면 언젠가 갈린다. 다른 것은 셋이다. 대상이 결재가 아니라 초안이라 거절이
// 없고(거절할 결재가 아직 없다), 보내는 곳이 EP-SPEC-28 이며, 결과가 셋(승인 · 다른 승인자를 기다림 · 처리하지
// 못함)이다. 판정(역할 · 사전 검토 · 등급 · 본 지문 · 50건)은 서버의 것이다(REQ-API-287 · 289).

import { BULK_DECISION_LIMIT } from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { queryKeys } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';
import type { Row } from '../../lib/queries.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button } from '../../components/ui/primitives.js';
import type { CardFailure } from '../inbox/approval-card.js';
import { BulkConfirm } from '../inbox/bulk-decision.js';

interface DraftResult {
  version_id: string;
  ok: boolean;
  status?: 'approved' | 'in_review';
  kind?: string | null;
  message?: string;
}

export function DraftApproveBar({
  projectSlug,
  projectId,
  drafts,
  selected,
  onSelect,
}: {
  projectSlug: string;
  projectId: ProjectId | undefined;
  /** 내가 바로 승인할 수 있는 초안 — 문서마다 한 줄(EP-SPEC-29) */
  drafts: readonly Row[];
  selected: ReadonlySet<string>;
  onSelect: (keys: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [confirming, setConfirming] = useState(false);
  const [failures, setFailures] = useState<Map<string, CardFailure>>(new Map());
  // 멱등 키는 **확인 창을 연 시점에** 잡는다 — 같은 배치의 재전송은 한 번만 실행된다(api.md §1.5)
  const batchKey = useRef('');

  // 확인 창의 줄 — `id` 가 버전 ID 여야 결과(항목별 `version_id`)와 맞춘다
  const cards: Row[] = drafts.map((row): Row => ({ ...row, id: String(row['version_id']) }));
  const chosen = cards.filter((card) => selected.has(String(card['spec_key'])));

  const approve = useMutation({
    mutationFn: (targets: readonly Row[]) =>
      apiFetch<{ approved: number; waiting: number; failed: number; results: DraftResult[] }>(
        `/projects/${projectSlug}/specs/approve-drafts`,
        {
          method: 'POST',
          body: {
            // **건마다 본 지문을 싣는다** — 그 사이 고쳐 쓴 초안만 막히고 나머지는 지나간다(REQ-API-289)
            items: targets.map((card) => ({
              version_id: String(card['id']),
              seen_content_hash: String(card['content_hash'] ?? ''),
            })),
          },
          idempotencyKey: `drafts-${batchKey.current}`,
        },
      ),
    onSuccess: (result) => {
      const failed = new Map<string, CardFailure>();
      for (const item of result.results)
        if (!item.ok)
          failed.set(item.version_id, {
            kind: item.kind ?? null,
            message: item.message ?? t('inbox.bulk.blocked.not_eligible'),
          });
      setFailures(failed);
      // **처리하지 못한 것만 고른 채로 남긴다** — 결재 대기와 같다(REQ-WEB-183)
      onSelect(
        new Set(
          cards.filter((card) => failed.has(String(card['id']))).map((c) => String(c['spec_key'])),
        ),
      );
      setConfirming(false);
      if (projectId !== undefined) {
        for (const key of [
          queryKeys.projectApprovableDrafts(projectId),
          queryKeys.projectPendingApprovals(projectId),
          queryKeys.projectSpecTree(projectId),
          queryKeys.projectSpecGraph(projectId),
        ])
          void queryClient.invalidateQueries({ queryKey: key });
      }
      pushToast(
        result.failed === 0 && result.waiting === 0
          ? { tone: 'ok', kind: 'trail', message: t('specs.drafts.done', { n: result.approved }) }
          : {
              tone: 'warn',
              kind: 'trail',
              message: t('specs.drafts.partial', {
                n: result.approved,
                waiting: result.waiting,
                failed: result.failed,
              }),
            },
      );
    },
    onError: onApiError,
  });

  return (
    <div className="mb-2">
      <div
        data-testid="draft-approve-bar"
        role="toolbar"
        aria-label={t('specs.drafts.bar')}
        className="flex flex-wrap items-center gap-2 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm"
      >
        <span data-testid="draft-approve-count" className="tabular-nums text-text-mute">
          {drafts.length === 0
            ? t('specs.drafts.none')
            : chosen.length === 0
              ? t('specs.drafts.hint', { count: drafts.length })
              : t('specs.decide.selected', { count: chosen.length, max: BULK_DECISION_LIMIT })}
        </span>
        <Button
          size="sm"
          variant="subtle"
          data-testid="draft-select-all"
          disabled={cards.length === 0}
          onClick={() =>
            onSelect(
              new Set(cards.slice(0, BULK_DECISION_LIMIT).map((card) => String(card['spec_key']))),
            )
          }
        >
          {t('specs.drafts.select_all')}
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          data-testid="draft-approve"
          disabled={chosen.length === 0 || approve.isPending}
          disabledReason={chosen.length === 0 ? t('specs.decide.pick_first') : undefined}
          onClick={() => {
            batchKey.current = crypto.randomUUID();
            setConfirming(true);
          }}
        >
          {t('specs.drafts.approve')}
        </Button>
        {chosen.length > 0 && (
          <Button
            size="sm"
            variant="subtle"
            data-testid="draft-clear"
            onClick={() => onSelect(new Set())}
          >
            {t('inbox.bulk.clear')}
          </Button>
        )}
      </div>
      {/* 처리하지 못한 것과 그 까닭 — 서버가 건마다 준다. 트리 줄에는 둘 자리가 없어 여기 모은다 */}
      {failures.size > 0 && (
        <ul
          data-testid="draft-approve-failures"
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
      {confirming && (
        <div className="mt-2">
          <BulkConfirm
            confirming="approve"
            chosen={chosen}
            reason=""
            onReason={() => undefined}
            pending={approve.isPending}
            onSubmit={(_decision, targets) => approve.mutate(targets)}
            onCancel={() => setConfirming(false)}
            showScope={false}
            hint={t('specs.drafts.confirm_hint')}
          />
        </div>
      )}
    </div>
  );
}
