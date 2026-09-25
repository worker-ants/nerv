// /inbox → S7 받은 요청 (ui-wireframes §2.7 · screens.md §2.7)
//
// **키보드로 완결한다**(j/k 이동 · a 승인 · r 거절 · c 코멘트). 받은 요청은 매일 여러 번 여는
// 화면이라 마우스 왕복이 그대로 지연이 된다 — 그 지연이 P4(승인 병목)의 실체다.
//
// **일괄은 그 연장이다**(2026-09-22 · REQ-WEB-181~183 · 사람 결정). 다만 일괄 승인은 본문을
// 열지 않고 누르는 조작이라, 이 화면이 지키는 것이 셋 있다: ① 선택할 수 있는 것은 서버가
// 저위험이라 판정한 것뿐이고(`can_bulk_approve`) ② 누르기 전에 **무엇을 승인하는지 나열**하며
// ③ 지나가지 못한 건은 목록에 남아 이유를 말한다.

import { useT } from '../lib/i18n.js';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApprovalCard, inView, subjectFallback } from '../features/inbox/approval-card.js';
import type { CardFailure } from '../features/inbox/approval-card.js';
import { apiFetch } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { useApiError } from '../lib/api-errors.js';
import { queryKeys } from '../lib/query-keys.js';
import { inboxCards, inboxTotal, useInbox } from '../lib/queries.js';
import type { Row } from '../lib/queries.js';
import { useRealtime } from '../lib/realtime.js';
import { cn } from '../lib/utils.js';
import {
  Button,
  EmptyState,
  PageBody,
  PageHeader,
  Skeleton,
  Textarea,
} from '../components/ui/primitives.js';
import { ScopeBadge } from '../components/scope-badge.js';
import { ErrorState, failedWithoutData } from '../components/query-state.js';

export const Route = createFileRoute('/inbox')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: 'pending' | 'decided'; focus?: string } => ({
    ...(search['state'] === 'decided' ? { state: 'decided' as const } : {}),
    // **그 카드로 착지한다**(2026-09-24 — UI/UX 검토 · REQ-WEB-204). 홈의 오늘 할 일 · 알림 ·
    // 에이전트가 건넨 `web_url` 이 모두 맨 `/inbox` 라, 사람은 방금 누른 요청을 목록에서 다시 찾았다
    ...(typeof search['focus'] === 'string' && search['focus'] !== ''
      ? { focus: search['focus'] }
      : {}),
  }),
  component: InboxScreen,
});

/** 서버가 준 항목별 결과 — **200 이 전부 성공을 뜻하지 않는다**(EP-APR-06) */
interface BulkResult {
  id: string;
  ok: boolean;
  kind?: string | null;
  message?: string;
}

/**
 * 일괄에 **넣을 수 있는가** — 질문이 아니고 아직 결정되지 않은 카드.
 *
 * 승인 가능 여부와는 다른 물음이다: 거절은 요청자도 할 수 있어(EP-APR-03 이 막는 것은
 * 승인뿐이다) 선택 가능 집합이 승인 가능 집합보다 넓다. 그 차이를 선택 바가 수로 보인다.
 */
function selectableCard(card: Row): boolean {
  return card['subject_type'] !== 'question' && (card['decision'] ?? null) === null;
}

/** **저위험 판정은 서버의 것이다**(`can_bulk_approve` · REQ-API-163) — 화면은 읽기만 한다 */
function bulkApprovable(card: Row): boolean {
  return card['can_bulk_approve'] === true;
}

function InboxScreen(): React.JSX.Element {
  const t = useT();
  const { state = 'pending', focus } = Route.useSearch();
  const inbox = useInbox(state);
  const [cursor, setCursor] = useState(0);
  /** 착지한 카드 — 잠깐 강조한다 */
  const [landed, setLanded] = useState<string | null>(null);
  /** 찾던 카드가 목록에 끝내 없다 — 이미 처리됐거나 내 큐가 아니다 */
  const [missing, setMissing] = useState<string | null>(null);
  const handledFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cards = inboxCards(inbox.data);
  const total = inboxTotal(inbox.data);
  const queryClient = useQueryClient();
  const { pushToast } = useRealtime();
  const onApiError = useApiError();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [failures, setFailures] = useState<Map<string, CardFailure>>(new Map());
  // 멱등 키는 **확인 패널을 연 시점에** 잡는다 — 같은 배치의 재전송은 한 번만 실행되고
  // (api.md §1.5), 다음 배치는 새 키를 받는다.
  const batchKey = useRef<string>('');

  const selectable = state === 'pending' ? cards.filter(selectableCard) : [];
  const chosen = selectable.filter((card) => selected.has(String(card['id'])));
  const approvable = chosen.filter(bulkApprovable);
  // 승인은 저위험만, 거절은 고른 것 전부 — 확인 패널이 이 목록을 그대로 나열한다
  const targets = confirming === 'approve' ? approvable : chosen;

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = (): void => {
    setSelected(new Set());
    setConfirming(null);
    setReason('');
  };

  const openConfirm = (decision: 'approve' | 'reject'): void => {
    if (state !== 'pending') return;
    if (decision === 'approve' ? approvable.length === 0 : chosen.length === 0) return;
    batchKey.current = crypto.randomUUID();
    setConfirming(decision);
  };

  const bulk = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      apiFetch<{ decided: number; failed: number; results: BulkResult[] }>('/approvals/decisions', {
        method: 'POST',
        body: {
          decision,
          comment: reason,
          // **건마다 지문을 싣는다**(REQ-API-162). 일괄이 stale 검사를 건너뛰면 일괄
          // 승인이 그 방어의 구멍이 된다 — 본문이 바뀐 한 건만 막히고 나머지는 지나간다.
          items: (decision === 'approve' ? approvable : chosen).map((card) => ({
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
      // **실패한 것만 선택에 남긴다.** 목록이 통째로 비면 사람은 전부 처리됐다고 읽는데,
      // 남은 것이 있으면 그것이 거짓말이 된다.
      const failed = new Map<string, CardFailure>();
      for (const item of result.results)
        if (!item.ok)
          failed.set(item.id, {
            kind: item.kind ?? null,
            message: item.message ?? t('inbox.bulk.blocked.not_eligible'),
          });
      setFailures(failed);
      setSelected(new Set(failed.keys()));
      setConfirming(null);
      setReason('');
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

  // **카드가 줄면 커서를 끌어온다**(REQ-WEB-204). 마지막 카드를 처리하면 커서가 목록 밖에 남아
  // 활성 카드가 없는데도 범례는 떠 있었다
  useEffect(() => {
    if (cards.length > 0 && cursor > cards.length - 1) setCursor(cards.length - 1);
  }, [cards.length, cursor]);

  /**
   * `?focus=` 착지 — 받아 온 쪽에 있으면 그 카드로, 없으면 다음 쪽을 이어 받고, 끝내 없으면
   * 그렇다고 말한다(아래 `FocusMissing`). 한 번만 한다 — 목록이 갱신될 때마다 커서를 빼앗지 않게.
   */
  useEffect(() => {
    if (focus === undefined || handledFocus.current === focus || inbox.data === undefined) return;
    const index = cards.findIndex((card) => String(card['id']) === focus);
    if (index >= 0) {
      handledFocus.current = focus;
      setMissing(null);
      setCursor(index);
      setLanded(focus);
      window.setTimeout(() => setLanded(null), 2000);
      return;
    }
    if (inbox.hasNextPage === true) {
      if (!inbox.isFetchingNextPage) void inbox.fetchNextPage();
      return;
    }
    handledFocus.current = focus;
    setMissing(focus);
  }, [focus, cards, inbox]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 입력 중에는 단축키가 글자를 먹지 않는다
      const target = e.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, cards.length - 1));
      if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      if (state !== 'pending') return;
      // 대문자는 Shift 를 누른 것이다 — 소문자 a/r/c(단건)와 겹치지 않는다
      if (e.key === 'x') {
        const card = cards[cursor];
        // 보이지 않는 카드는 고르지 않는다 — 결정 키와 같은 규칙이다(REQ-WEB-204)
        const el = listRef.current?.children[cursor] ?? null;
        if (card !== undefined && selectableCard(card) && inView(el)) toggle(String(card['id']));
      }
      if (e.key === 'X') setSelected(new Set(selectable.map((card) => String(card['id']))));
      if (e.key === 'A') openConfirm('approve');
      if (e.key === 'R') openConfirm('reject');
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // 닫힌 값이 바뀌면 다시 건다 — 핸들러가 읽는 것(선택 가능 목록·승인 가능 목록)은
    // 전부 이 넷에서 파생한다. 빠뜨리면 ⇧A 가 **한 번 전의 선택**을 승인한다.
  }, [cards, cursor, state, selected]);

  useEffect(() => {
    const el = listRef.current?.children[cursor];
    // 레이아웃이 없는 환경(테스트)에는 이 함수가 없다 — 없으면 옮기지 않는다
    if (el instanceof HTMLElement) el.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  return (
    <PageBody>
      <PageHeader
        title={t('inbox.title')}
        // 모든 조직에서 모인다 — 줄마다 어느 조직·프로젝트의 일인지 적혀 있다(REQ-WEB-192·193)
        description={t('inbox.scope_all')}
        actions={
          // 탭은 두 개뿐이라 세그먼트로 붙여 둔다 — 떨어뜨리면 서로 다른 두 링크로 읽힌다
          // **앱 안에서 옮긴다**(REQ-WEB-204) — `<a href>` 라 누를 때마다 앱 전체가 다시 로드되고
          // 실시간 연결이 끊겼다 붙었다
          // 주소가 바뀌는 탭이라 **지금 어느 쪽인지는 `aria-current` 가 말한다**(SYS-12) — 배경색만으로는
          // 보조기기에 상태가 없다(REQ-WEB-033)
          <nav
            aria-label={t('inbox.title')}
            className="flex rounded-nerv-sm border border-border p-0.5 text-xs"
          >
            <Link
              to="/inbox"
              search={{}}
              // 링크는 스스로 `aria-current` 를 단다 — 기본 비교는 쿼리를 **부분**으로 봐서, 빈 쿼리의
              // [대기 중]이 `?state=decided` 에서도 "지금 여기" 라고 말했다. 쿼리까지 같아야 여기다
              activeOptions={{ exact: true }}
              aria-current={state === 'pending' ? 'page' : undefined}
              data-testid="inbox-tab-pending"
              className={cn(
                'rounded-nerv-sm px-2.5 py-1',
                state === 'pending' ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
              )}
            >
              {t('inbox.tab.pending')}
            </Link>
            <Link
              to="/inbox"
              search={{ state: 'decided' }}
              activeOptions={{ exact: true }}
              aria-current={state === 'decided' ? 'page' : undefined}
              data-testid="inbox-tab-decided"
              className={cn(
                'rounded-nerv-sm px-2.5 py-1',
                state === 'decided' ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
              )}
            >
              {t('inbox.tab.decided')}
            </Link>
          </nav>
        }
        meta={
          <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-text-mute">
            {state === 'pending'
              ? t('inbox.count_pending', { count: total })
              : t('inbox.count_decided', { count: total })}
          </span>
        }
      />

      <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-faint">
        {/* 키 이름은 번역하지 않는다 — 키보드에 새겨진 글자다. 그 옆의 말만 번역한다 */}
        <span>
          <Key>j</Key> <Key>k</Key> {t('inbox.key.move')}
        </span>
        <span>
          <Key>a</Key> {t('inbox.key.approve')}
        </span>
        <span>
          <Key>r</Key> {t('inbox.key.reject')}
        </span>
        <span>
          <Key>c</Key> {t('inbox.key.comment')}
        </span>
        <span>
          <Key>⌘↵</Key> {t('inbox.key.send')}
        </span>
        {state === 'pending' && (
          <>
            <span>
              <Key>x</Key> {t('inbox.key.select')}
            </span>
            <span>
              <Key>⇧A</Key> <Key>⇧R</Key> {t('inbox.key.bulk')}
            </span>
          </>
        )}
        {/* 키가 **어느 카드에** 꽂히는지 — 강조된(왼쪽 띠) 카드다. 누르거나 칸에 들어가면 그 카드가 된다 */}
        <span className="text-text-ghost">{t('inbox.key.applies')}</span>
      </p>

      {missing !== null && <FocusMissing id={missing} />}

      {/* **선택 바는 고른 것이 있을 때만 선다.** 늘 떠 있으면 일괄이 기본 조작으로 읽히고,
          받은 요청의 기본은 한 건씩 보는 것이다(그것이 이 화면의 존재 이유다) */}
      {chosen.length > 0 && (
        <div
          data-testid="bulk-bar"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-nerv border border-border-strong bg-bg-elev px-3 py-2 text-xs"
        >
          <span className="font-medium">{t('inbox.bulk.selected', { count: chosen.length })}</span>
          {/* **승인 가능 수를 따로 보인다** — 고른 것과 승인되는 것이 다를 수 있고,
              그 차이를 누른 뒤에 알게 하면 안 된다 */}
          <span data-testid="bulk-approvable" className="text-text-mute">
            {t('inbox.bulk.approvable', { count: approvable.length })}
          </span>
          <Button
            size="sm"
            variant="primary"
            data-testid="bulk-approve"
            disabled={approvable.length === 0 || bulk.isPending}
            onClick={() => openConfirm('approve')}
          >
            {t('inbox.bulk.approve')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            data-testid="bulk-reject"
            disabled={bulk.isPending}
            onClick={() => openConfirm('reject')}
          >
            {t('inbox.bulk.reject')}
          </Button>
          {/* **보이는 것 전체**다 — 목록은 100건에서 끊기고 커서가 없다(EP-APR-01).
              "조건에 맞는 전부" 를 만들지 않는 이유가 그것이다: 보지 않은 것을 고르게
              하는 손잡이가 된다 */}
          <button
            type="button"
            data-testid="bulk-select-all"
            onClick={() => setSelected(new Set(selectable.map((card) => String(card['id']))))}
            className="ml-auto text-text-mute hover:text-text"
          >
            {t('inbox.bulk.select_all')}
          </button>
          <button
            type="button"
            data-testid="bulk-clear"
            onClick={clearSelection}
            className="text-text-mute hover:text-text"
          >
            {t('inbox.bulk.clear')}
          </button>
        </div>
      )}

      {/* **무엇을 승인하는지 나열한다.** 본문을 열지 않고 결정하는 조작이라, 이 목록이
          남은 유일한 "무엇을 승인하는가" 다(spec-workflow §6.4 — 원문 우선의 최소치) */}
      {confirming !== null && (
        <form
          data-testid="bulk-confirm"
          className="mb-2 rounded-nerv border border-border bg-bg-elev p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirming === 'reject' && reason.trim() === '') return;
            bulk.mutate(confirming);
          }}
        >
          <p className="text-2xs font-semibold text-text">
            {confirming === 'approve'
              ? t('inbox.bulk.confirm_approve', { count: targets.length })
              : t('inbox.bulk.confirm_reject', { count: targets.length })}
          </p>
          <p className="mt-0.5 text-2xs text-text-faint">{t('inbox.bulk.confirm_hint')}</p>
          {confirming === 'approve' && chosen.length > approvable.length && (
            <p data-testid="bulk-skipped" className="mt-1 text-2xs text-status-waiting">
              {t('inbox.bulk.skipped', { count: chosen.length - approvable.length })}
            </p>
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
                <ScopeBadge
                  className="shrink-0"
                  orgSlug={card['org_slug']}
                  orgName={card['org_name']}
                  projectSlug={card['project_slug']}
                  projectName={card['project_name']}
                />
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
                onChange={(e) => setReason(e.target.value)}
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
                bulk.isPending ||
                targets.length === 0 ||
                (confirming === 'reject' && reason.trim() === '')
              }
            >
              {t('inbox.bulk.submit')}
            </Button>
            <Button type="button" size="sm" onClick={() => setConfirming(null)}>
              {t('inbox.bulk.cancel')}
            </Button>
          </div>
        </form>
      )}

      {inbox.isLoading && <Skeleton rows={3} className="[&>div]:h-24" />}
      {/* 실패는 빈 받은 요청이 아니다(REQ-WEB-198) — 그렇게 그리면 결재가 쌓인 채 "없다" 가 된다 */}
      {failedWithoutData(inbox) && (
        <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
      )}

      {/* **탭마다 제목이 다르다**(2026-09-24 · REQ-WEB-208). 처리됨 탭이 비어도 "지금 당신을 기다리는 항목이
          없습니다" 라고 적어 탭과 맞지 않았다. 대기가 비면 최근 처리 셋을 붙인다(ui-wireframes §3.4) —
          방금 한 일이 어디 갔는지가 빈 목록의 다음 질문이다 */}
      {inbox.data !== undefined && cards.length === 0 && (
        <EmptyState
          icon="✓"
          title={state === 'pending' ? t('home.nothing_waiting') : t('inbox.empty_decided')}
          hint={state === 'pending' ? t('inbox.empty_pending_hint') : t('inbox.empty_decided_hint')}
          action={
            state === 'pending' ? (
              <RecentDecided />
            ) : (
              <Link to="/inbox" className="text-sm text-link hover:underline">
                {t('inbox.see_pending')} ▸
              </Link>
            )
          }
        />
      )}

      <ul ref={listRef} className="flex flex-col gap-2">
        {cards.map((card, index) => (
          <li
            key={String(card['id'])}
            data-active={index === cursor}
            data-landed={landed === String(card['id']) || undefined}
            // **누르거나 들어간 카드가 커서다**(REQ-WEB-204). j/k 로만 옮겨지던 동안, 다른 카드의
            // [본문 보기]를 누르고 a 를 치면 커서가 남아 있던 카드가 승인됐다
            onPointerDownCapture={() => setCursor(index)}
            onFocusCapture={() => setCursor(index)}
            // 포커스는 **왼쪽 띠**다. 링을 두르면 카드가 떠 보이고, j/k 로 훑을 때
            // 카드가 하나씩 튀어오르는 것처럼 읽힌다
            className="rounded-nerv border-l-2 border-transparent pl-1 transition-colors data-[active=true]:border-status-action data-[landed=true]:bg-status-action-soft"
          >
            <ApprovalCard
              card={card}
              active={index === cursor}
              keysOff={confirming !== null}
              selectable={state === 'pending' && selectableCard(card)}
              selected={selected.has(String(card['id']))}
              onToggle={toggle}
              {...(failures.has(String(card['id']))
                ? { failure: failures.get(String(card['id'])) as CardFailure }
                : {})}
            />
          </li>
        ))}
      </ul>

      {/* **이게 전부가 아니면 그렇게 말한다**(REQ-API-166). 예전에는 100건에서 말없이
          잘렸고, 그 상한이 **오래 기다린 쪽**을 잘랐다 — 화면이 존재하는 이유를 뒤집는
          자리였다(실측 2026-09-24: 120건 중 가장 오래 기다린 20건이 통째로 빠졌다).
          일괄 선택은 **보이는 것 전체**를 뜻하므로(REQ-WEB-181) 더 받아 온 것까지
          자연히 포함된다 — 보지 않은 것을 고르게 하는 손잡이를 만들지 않는다. */}
      {inbox.hasNextPage === true && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="ghost"
            data-testid="inbox-more"
            disabled={inbox.isFetchingNextPage}
            onClick={() => void inbox.fetchNextPage()}
          >
            {inbox.isFetchingNextPage ? t('common.loading') : t('tasks.more')}
          </Button>
        </div>
      )}
    </PageBody>
  );
}

/**
 * 찾던 카드가 없다 — **왜 없는지** 말한다(REQ-WEB-204). 결재면 누가 무엇으로 처리했는지를 한 건
 * 받아 온다(EP-APR-02). 질문이거나 내 것이 아니면 "처리됐거나 받은 요청에 없다" 로 말한다.
 */
function FocusMissing({ id }: { id: string }): React.JSX.Element {
  const t = useT();
  const detail = useQuery({
    queryKey: ['approval', id],
    queryFn: () => apiFetch<Record<string, unknown>>(`/approvals/${id}`),
    retry: false,
  });
  const decision = detail.data?.['decision'];
  const text =
    typeof decision === 'string'
      ? t('inbox.focus.decided', {
          decision: t(
            decision === 'approve'
              ? 'inbox.decision.approve'
              : decision === 'reject'
                ? 'inbox.decision.reject'
                : 'inbox.decision.comment',
          ),
          who: String(detail.data?.['decided_by'] ?? '—'),
          when: relativeTime(t, String(detail.data?.['decided_at'] ?? '')),
        })
      : t('inbox.focus.gone');
  return (
    <p
      role="status"
      data-testid="focus-missing"
      className="mb-3 rounded-nerv-sm bg-bg-sunken px-3 py-2 text-sm text-text-mute"
    >
      {detail.isPending ? t('common.loading') : text}
    </p>
  );
}

/** 단축키 표기 — 본문 글자와 구분되게, 그러나 조용하게 */
function Key({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded-nerv-sm border border-border bg-bg-sunken px-1 font-mono text-text-mute">
      {children}
    </kbd>
  );
}

/** 대기가 비었을 때 — **최근 처리 셋**과 처리됨 탭으로 가는 길(ui-wireframes §3.4 · REQ-WEB-208) */
function RecentDecided(): React.JSX.Element {
  const t = useT();
  const decided = useInbox('decided');
  const recent = inboxCards(decided.data).slice(0, 3);
  return (
    <div data-testid="inbox-recent-decided" className="flex flex-col items-center gap-1.5">
      {recent.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-left text-xs text-text-mute">
          {recent.map((card) => (
            <li key={String(card['id'])} className="flex items-center gap-2">
              <span className="shrink-0 text-2xs text-text-faint">
                {t(`inbox.decision.${String(card['decision'] ?? 'approve')}` as never)}
              </span>
              <span className="min-w-0 truncate">
                {String(
                  card['title'] ??
                    card['spec_title'] ??
                    card['task_title'] ??
                    card['finding_title'] ??
                    subjectFallback(t, card['subject_type']),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/inbox" search={{ state: 'decided' }} className="text-sm text-link hover:underline">
        {t('home.see_decided')}
      </Link>
    </div>
  );
}
