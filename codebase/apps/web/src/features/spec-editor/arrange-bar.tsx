// 정리 모드의 선택 막대 — 여러 문서를 옮기고 순서를 바꾼다 (2026-10-04 · 사람 결정 M1 · M2 · M4 · REQ-WEB-291)
//
// 이동은 문서마다 [문서 정보] 창을 여는 것뿐이었고, 순서는 정렬 키 글자를 직접 쳐야 했다(형제의 키는 보이지
// 않았다). 끌어서 놓기는 새 의존성이 필요하고 링크 줄 · 자체 가상 스크롤과 부딪혀서, 고르고 단추로 정리한다 —
// 키보드로도 끝까지 된다. 판정(사이클 · 보관 · 정렬 키)은 서버 한 곳이다(EP-SPEC-25 · D-05).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { apiFetch, NervApiError } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { queryKeys } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button } from '../../components/ui/primitives.js';
import { ConfirmAction } from '../../components/ui/confirm-action.js';
import { Modal } from '../../components/ui/modal.js';
import { ParentPicker } from './meta-dialog.js';

/** 정리에 필요한 노드의 모양 — 트리 · 그래프 응답이 서버의 정렬 순서(정렬 키 · 키)로 준다 */
export interface ArrangeNode {
  id: string;
  key: string;
  parent_id: string | null;
  archived_at?: string | null;
}

export type Direction = 'up' | 'down';

/**
 * 고른 문서들을 형제 안에서 한 칸 옮긴 새 순서. 고른 것끼리는 순서를 지키고, 이미 끝에 닿은 것은
 * 그 자리에 둔다. 바뀐 것이 없으면 `null` — 단추를 끈다.
 */
export function shiftOrder(
  siblings: readonly string[],
  selected: ReadonlySet<string>,
  direction: Direction,
): string[] | null {
  const order = [...siblings];
  let moved = false;
  if (direction === 'up') {
    for (let i = 1; i < order.length; i += 1) {
      if (selected.has(order[i]!) && !selected.has(order[i - 1]!)) {
        [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
        moved = true;
      }
    }
  } else {
    for (let i = order.length - 2; i >= 0; i -= 1) {
      if (selected.has(order[i]!) && !selected.has(order[i + 1]!)) {
        [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
        moved = true;
      }
    }
  }
  return moved ? order : null;
}

export function ArrangeBar({
  projectSlug,
  projectId,
  nodes,
  selected,
  onClear,
  filtered,
}: {
  projectSlug: string;
  projectId: ProjectId | undefined;
  /** 보관하지 않은 노드 전부(서버의 정렬 순서) */
  nodes: readonly ArrangeNode[];
  selected: ReadonlySet<string>;
  onClear: () => void;
  /** 필터 · 기준선으로 일부만 보이는 중인가 — 그러면 순서를 바꾸지 않는다 */
  filtered: boolean;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  /** 보관하지 못한 문서와 그 까닭 — 트리 줄에는 둘 자리가 없어 막대 아래에 모은다 */
  const [refused, setRefused] = useState<{ key: string; reason: string }[]>([]);

  const live = nodes.filter((n) => n.archived_at == null);
  const keyOf = new Map(live.map((n) => [n.id, n.key]));
  // 고른 것을 **트리 순서대로** 보낸다 — 옮긴 뒤에도 서로의 순서가 그대로다
  const picked = live.filter((n) => selected.has(n.key));
  const parents = new Set(picked.map((n) => n.parent_id));
  const sameParent = parents.size === 1;
  const parentId = sameParent ? ([...parents][0] ?? null) : null;
  const siblings = sameParent ? live.filter((n) => n.parent_id === parentId).map((n) => n.key) : [];
  const upOrder = sameParent ? shiftOrder(siblings, selected, 'up') : null;
  const downOrder = sameParent ? shiftOrder(siblings, selected, 'down') : null;
  const orderLock =
    picked.length === 0
      ? undefined
      : filtered
        ? t('specs.arrange.order_locked')
        : !sameParent
          ? t('specs.arrange.order_same_parent')
          : undefined;

  const invalidate = (): void => {
    if (projectId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecTree(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectSpecGraph(projectId) });
  };

  const arrange = useMutation({
    mutationFn: (body: { parent_key: string | null; keys: string[]; kind: 'move' | 'order' }) =>
      apiFetch<{ changed?: string[] }>(`/projects/${projectSlug}/specs/arrange`, {
        method: 'POST',
        body: { parent_key: body.parent_key, keys: body.keys },
      }),
    onSuccess: (_result, body) => {
      invalidate();
      pushToast({
        tone: 'ok',
        message:
          body.kind === 'move'
            ? t('specs.arrange.moved', { count: body.keys.length })
            : t('specs.arrange.reordered'),
      });
      if (body.kind === 'move') {
        setMoving(false);
        setTarget(undefined);
        onClear();
      }
    },
    onError: (error: Error) => {
      // 그 사이 트리가 바뀌었다 — 다시 받아 지금 모양으로 고르게 한다
      if (error instanceof NervApiError) invalidate();
      onApiError(error);
    },
  });

  const parentKey = parentId === null ? null : (keyOf.get(parentId) ?? null);

  /**
   * **고른 것을 하위까지 보관한다**(2026-10-04 · 사람 결정 M1 · R2 · REQ-WEB-291). 고른 것 가운데 조상도 고른
   * 문서는 빼고 위쪽만 보낸다 — 조상의 가지째 보관이 그것을 함께 보관한다(REQ-API-263). 문서마다 따로 보내므로
   * 한 편이 막혀도 나머지는 보관된다.
   */
  const byId = new Map(live.map((n) => [n.id, n]));
  const pickedIds = new Set(picked.map((n) => n.id));
  const underPicked = (node: ArrangeNode): boolean => {
    let parent = node.parent_id;
    while (parent !== null) {
      if (pickedIds.has(parent)) return true;
      parent = byId.get(parent)?.parent_id ?? null;
    }
    return false;
  };
  const tops = picked.filter((n) => !underPicked(n));
  const branchSize = (() => {
    const children = new Map<string, ArrangeNode[]>();
    for (const n of live) {
      if (n.parent_id === null) continue;
      children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n]);
    }
    let total = 0;
    const walk = (id: string): void => {
      total += 1;
      for (const c of children.get(id) ?? []) walk(c.id);
    };
    for (const top of tops) walk(top.id);
    return total;
  })();
  const archiveAll = useMutation({
    mutationFn: async () => {
      const failed: { key: string; reason: string }[] = [];
      let archived = 0;
      for (const top of tops) {
        try {
          const out = await apiFetch<{ archived_keys?: string[] }>(
            `/projects/${projectSlug}/specs/${top.key}/archive`,
            { method: 'POST', body: { descendants: true } },
          );
          archived += out.archived_keys?.length ?? 1;
        } catch (error) {
          failed.push({
            key: top.key,
            reason:
              error instanceof NervApiError && error.body.details['kind'] === 'archive_blocked'
                ? t('specs.arrange.archive_blocked')
                : error instanceof Error
                  ? error.message
                  : String(error),
          });
        }
      }
      return { archived, failed };
    },
    onSuccess: ({ archived, failed }) => {
      invalidate();
      setRefused(failed);
      onClear();
      pushToast({
        tone: failed.length === 0 ? 'ok' : 'warn',
        message:
          failed.length === 0
            ? t('specs.arrange.archived', { count: archived })
            : t('specs.arrange.archived_partial', { count: archived, failed: failed.length }),
      });
    },
    onError: onApiError,
  });

  return (
    <div
      data-testid="arrange-bar"
      role="toolbar"
      aria-label={t('specs.arrange.bar')}
      className="mb-2 flex flex-wrap items-center gap-2 rounded-nerv border border-border bg-bg-sunken px-3 py-2 text-sm"
    >
      <span data-testid="arrange-count" className="tabular-nums text-text-mute">
        {picked.length === 0
          ? t('specs.arrange.hint')
          : t('specs.arrange.selected', { count: picked.length })}
      </span>
      <Button
        size="sm"
        data-testid="arrange-move"
        disabled={picked.length === 0 || arrange.isPending}
        onClick={() => setMoving(true)}
      >
        {t('specs.arrange.move')}
      </Button>
      <Button
        size="sm"
        data-testid="arrange-up"
        disabled={orderLock !== undefined || upOrder === null || arrange.isPending}
        disabledReason={orderLock}
        onClick={() =>
          upOrder !== null &&
          arrange.mutate({ parent_key: parentKey, keys: upOrder, kind: 'order' })
        }
      >
        {t('specs.arrange.up')}
      </Button>
      <Button
        size="sm"
        data-testid="arrange-down"
        disabled={orderLock !== undefined || downOrder === null || arrange.isPending}
        disabledReason={orderLock}
        onClick={() =>
          downOrder !== null &&
          arrange.mutate({ parent_key: parentKey, keys: downOrder, kind: 'order' })
        }
      >
        {t('specs.arrange.down')}
      </Button>
      <ConfirmAction
        label={t('specs.arrange.archive')}
        variant="danger"
        size="sm"
        testId="arrange-archive"
        disabled={picked.length === 0 || archiveAll.isPending}
        title={picked.length === 0 ? t('specs.arrange.pick_first') : undefined}
        tooltip={t('spec.meta.archive_title')}
        message={t('specs.arrange.archive_confirm', { count: tops.length, total: branchSize })}
        detail={t('spec.meta.archive_confirm_detail')}
        confirmLabel={t('specs.arrange.archive')}
        pending={archiveAll.isPending}
        onConfirm={() => archiveAll.mutate()}
      />
      <Button
        size="sm"
        variant="subtle"
        className="ml-auto"
        data-testid="arrange-clear"
        disabled={picked.length === 0}
        onClick={onClear}
      >
        {t('specs.arrange.clear')}
      </Button>

      {refused.length > 0 && (
        <ul
          data-testid="arrange-refused"
          className="w-full flex flex-col gap-0.5 text-2xs text-status-danger"
        >
          {refused.map((r) => (
            <li key={r.key} className="flex gap-2">
              <span className="shrink-0 font-mono">{r.key}</span>
              <span className="min-w-0 flex-1">{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {moving && (
        <Modal
          label={t('specs.arrange.move_title', { count: picked.length })}
          onClose={() => setMoving(false)}
          testId="arrange-move-dialog"
        >
          <h2 className="mb-2 text-lg font-semibold tracking-tight">
            {t('specs.arrange.move_title', { count: picked.length })}
          </h2>
          <ParentPicker
            projectSlug={projectSlug}
            projectId={projectId}
            specKeys={picked.map((n) => n.key)}
            current={undefined}
            // 아직 고르지 않았으면 아무것도 고른 것으로 보이지 않게 — "맨 위" 가 미리 골라진 것처럼 보이면 안 된다
            value={target === undefined ? '' : target}
            onChange={setTarget}
            disabled={arrange.isPending}
          />
          <p className="mt-1 text-xs text-text-faint">{t('specs.arrange.move_hint')}</p>
          <div className="mt-3 flex gap-2 border-t border-border pt-3">
            <Button
              variant="primary"
              data-testid="arrange-move-confirm"
              disabled={target === undefined || arrange.isPending}
              onClick={() =>
                arrange.mutate({
                  parent_key: target ?? null,
                  keys: picked.map((n) => n.key),
                  kind: 'move',
                })
              }
            >
              {t('specs.arrange.move_confirm')}
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setMoving(false)}>
              {t('common.close')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
