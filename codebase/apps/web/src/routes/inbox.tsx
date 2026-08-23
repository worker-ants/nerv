// /inbox → S7 승인함 (ui-wireframes §2.7 · screens.md §2.7)
//
// **키보드로 완결한다**(j/k 이동 · a 승인 · r 거절 · c 코멘트). 승인함은 매일 여러 번 여는
// 화면이라 마우스 왕복이 그대로 지연이 된다 — 그 지연이 P4(승인 병목)의 실체다.

import { useT } from '../lib/i18n.js';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { rows, useInbox } from '../lib/queries.js';
import { cn } from '../lib/utils.js';
import { EmptyState, PageBody, PageHeader, Skeleton } from '../components/ui/primitives.js';

export const Route = createFileRoute('/inbox')({
  validateSearch: (search: Record<string, unknown>): { state?: 'pending' | 'decided' } => ({
    ...(search['state'] === 'decided' ? { state: 'decided' as const } : {}),
  }),
  component: InboxScreen,
});

function InboxScreen(): React.JSX.Element {
  const t = useT();
  const { state = 'pending' } = Route.useSearch();
  const inbox = useInbox(state);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const cards = rows(inbox.data);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 입력 중에는 단축키가 글자를 먹지 않는다
      const target = e.target as HTMLElement | null;
      if (target !== null && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, cards.length - 1));
      if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cards.length]);

  useEffect(() => {
    const el = listRef.current?.children[cursor];
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <PageBody>
      <PageHeader
        title={t('inbox.title')}
        description={t('inbox.lead')}
        actions={
          // 탭은 두 개뿐이라 세그먼트로 붙여 둔다 — 떨어뜨리면 서로 다른 두 링크로 읽힌다
          <nav className="flex rounded-nerv-sm border border-border p-0.5 text-xs">
            <a
              href="/inbox"
              className={cn(
                'rounded-nerv-sm px-2.5 py-1',
                state === 'pending' ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
              )}
            >
              {t('inbox.tab.pending')}
            </a>
            <a
              href="/inbox?state=decided"
              className={cn(
                'rounded-nerv-sm px-2.5 py-1',
                state === 'decided' ? 'bg-bg-active font-medium' : 'text-text-mute hover:text-text',
              )}
            >
              {t('inbox.tab.decided')}
            </a>
          </nav>
        }
        meta={
          <span className="rounded-full bg-bg-sunken px-2 py-0.5 text-xs text-text-mute">
            {state === 'pending'
              ? t('inbox.count_pending', { count: cards.length })
              : t('inbox.count_decided', { count: cards.length })}
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
      </p>

      {inbox.isLoading && <Skeleton rows={3} className="[&>div]:h-24" />}

      {!inbox.isLoading && cards.length === 0 && (
        <EmptyState
          icon="✓"
          title={t('home.nothing_waiting')}
          hint={state === 'pending' ? t('inbox.empty_pending_hint') : t('inbox.empty_decided_hint')}
        />
      )}

      <ul ref={listRef} className="flex flex-col gap-2">
        {cards.map((card, index) => (
          <li
            key={String(card['id'])}
            data-active={index === cursor}
            // 포커스는 **왼쪽 띠**다. 링을 두르면 카드가 떠 보이고, j/k 로 훑을 때
            // 카드가 하나씩 튀어오르는 것처럼 읽힌다
            className="rounded-nerv border-l-2 border-transparent pl-1 transition-colors data-[active=true]:border-status-action"
          >
            <ApprovalCard card={card} active={index === cursor} />
          </li>
        ))}
      </ul>
    </PageBody>
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
