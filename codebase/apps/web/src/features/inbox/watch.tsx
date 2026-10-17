// 워치 — 정본: docs/04-mvp/screens.md §2.9 · REQ-WEB-328 (2026-10-16 · 사람 결정 D5 · Phase 2 E17-S02)
//
// 알림 카탈로그(spec-workflow §6.3)는 승인 · 거절 · 코멘트 · 준비된 작업을 「워처」에게도 보낸다고 적었는데 워치할 자리가 없었다.
// 스펙 상세 · 작업 상세에 단추를 두고(영역 문서면 영역 워치 — 그 아래 문서와 작업까지), 내 계정의 알림 탭에 내 워치 목록을 둔다.
// **자동 등록은 하지 않는다** — 워치는 사람이 누를 때만 생긴다. 판정(대상이 이 프로젝트에 있는가 · 영역 문서인가)은 서버가 한다.

import type { WatchTarget } from '@nerv/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api.js';
import { useApiError } from '../../lib/api-errors.js';
import { useT } from '../../lib/i18n.js';
import { useMyWatches } from '../../lib/queries.js';
import type { Row } from '../../lib/queries.js';
import { queryKeys } from '../../lib/query-keys.js';
import { useRealtime } from '../../lib/realtime.js';
import { Button } from '../../components/ui/primitives.js';
import { EntityLink } from '../../components/entity-link.js';

/** 목록에서 이 대상의 워치를 찾는다 — 키는 대소문자를 가리지 않는다 */
function findWatch(items: Row[], targetType: WatchTarget, target: string): Row | undefined {
  const key = target.toLowerCase();
  return items.find(
    (w) =>
      w['target_type'] === targetType &&
      (String(w['key'] ?? '').toLowerCase() === key || w['target_id'] === target),
  );
}

/**
 * **워치 단추**(REQ-WEB-328). 지금 상태를 눌린 단추(`aria-pressed`)와 이름(「워치 중」)으로 보인다. 누르면 걸고, 다시 누르면 푼다.
 * 영역 문서에서는 「영역 워치」다 — 그 아래 문서와 작업의 알림까지 받는다는 것을 이름과 말풍선이 적는다.
 */
export function WatchButton({
  proj,
  targetType,
  target,
}: {
  proj: string;
  targetType: WatchTarget;
  /** 키(또는 UUID) */
  target: string;
}): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const onError = useApiError();
  const { pushToast } = useRealtime();
  const watches = useMyWatches(proj);
  const current = findWatch(watches.data?.items ?? [], targetType, target);
  const watching = current !== undefined;
  const area = targetType === 'area';
  const toggle = useMutation({
    mutationFn: () =>
      current === undefined
        ? apiFetch<unknown>('/me/watches', {
            method: 'PUT',
            body: { project: proj, target_type: targetType, target },
          })
        : apiFetch<unknown>(`/me/watches/${encodeURIComponent(String(current['id']))}`, {
            method: 'DELETE',
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myWatches() });
      pushToast({
        tone: 'ok',
        message: t(watching ? 'watch.removed' : area ? 'watch.added_area' : 'watch.added', {
          target,
        }),
      });
    },
    onError,
  });
  return (
    <Button
      size="sm"
      variant="subtle"
      data-testid="watch-toggle"
      aria-pressed={watching}
      // 받아 오기 전에는 상태를 모른다 — 모르는 채로 누르면 이미 건 워치를 또 거는 것처럼 보인다
      disabled={watches.isPending || toggle.isPending}
      title={t(area ? 'watch.hint_area' : 'watch.hint')}
      onClick={() => toggle.mutate()}
    >
      <span aria-hidden="true">{watching ? '◉' : '○'}</span>{' '}
      {t(watching ? (area ? 'watch.on_area' : 'watch.on') : area ? 'watch.off_area' : 'watch.off')}
    </Button>
  );
}

/**
 * **내 워치 목록**(REQ-WEB-328) — 내 계정의 알림 탭. 모든 프로젝트의 워치를 새로 건 순서로 보이고 줄마다 [해제]를 둔다. 워치가 없으면
 * 무엇을 하면 생기는지 한 줄로 적는다(막다른 길을 만들지 않는다).
 */
export function WatchList(): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const onError = useApiError();
  const watches = useMyWatches(null);
  const items = watches.data?.items ?? [];
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>(`/me/watches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.myWatches() }),
    onError,
  });
  if (watches.isPending) return <p className="text-sm text-text-faint">…</p>;
  if (items.length === 0) {
    return (
      <p data-testid="watch-list-empty" className="text-sm text-text-faint">
        {t('watch.list_empty')}
      </p>
    );
  }
  return (
    <ul data-testid="watch-list" className="flex flex-col divide-y divide-border">
      {items.map((w) => {
        const type = String(w['target_type']);
        const slug = String(w['project_slug'] ?? '');
        const key = String(w['key'] ?? '');
        return (
          <li
            key={String(w['id'])}
            data-testid="watch-row"
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-2xs text-text-faint">
                {t(`watch.type.${type}` as 'watch.type.spec')}
              </span>
              <EntityLink
                projectSlug={slug}
                entity={type === 'task' ? { kind: 'task', key } : { kind: 'spec', key }}
                testId="watch-row-link"
              >
                {key}
              </EntityLink>
              <span className="min-w-0 truncate text-text-mute">{String(w['title'] ?? '')}</span>
              <span className="text-2xs text-text-faint">{String(w['project_name'] ?? slug)}</span>
            </span>
            <Button
              size="sm"
              data-testid="watch-row-remove"
              disabled={remove.isPending}
              onClick={() => remove.mutate(String(w['id']))}
            >
              {t('watch.remove')}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
