// /inbox → S7 승인함 (ui-wireframes §2.7 · screens.md §2.7)
//
// **키보드로 완결한다**(j/k 이동 · a 승인 · r 거절 · c 코멘트). 승인함은 매일 여러 번 여는
// 화면이라 마우스 왕복이 그대로 지연이 된다 — 그 지연이 P4(승인 병목)의 실체다.

import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ApprovalCard } from '../features/inbox/approval-card.js';
import { rows, useInbox } from '../lib/queries.js';

export const Route = createFileRoute('/inbox')({
  validateSearch: (search: Record<string, unknown>): { state?: 'pending' | 'decided' } => ({
    ...(search['state'] === 'decided' ? { state: 'decided' as const } : {}),
  }),
  component: InboxScreen,
});

function InboxScreen(): React.JSX.Element {
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
    <div className="mx-auto max-w-3xl">
      <header className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          승인함{' '}
          <span className="text-sm font-normal text-text-mute">
            {state === 'pending' ? '대기' : '처리됨'} {cards.length}건
          </span>
        </h1>
        <nav className="flex gap-2 text-sm">
          <a href="/inbox" className={state === 'pending' ? 'font-semibold' : 'text-text-mute'}>
            대기
          </a>
          <a
            href="/inbox?state=decided"
            className={state === 'decided' ? 'font-semibold' : 'text-text-mute'}
          >
            처리됨
          </a>
        </nav>
      </header>

      <p className="mb-2 text-xs text-text-faint">
        키보드: <kbd>j</kbd>/<kbd>k</kbd> 이동 · <kbd>a</kbd> 승인 · <kbd>r</kbd> 거절 ·{' '}
        <kbd>c</kbd> 코멘트
      </p>

      {inbox.isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded bg-bg-sunken" />
          ))}
        </div>
      )}

      {!inbox.isLoading && cards.length === 0 && (
        <div className="rounded-md border border-border bg-bg-elev p-6 text-center text-sm text-text-mute">
          지금 당신을 기다리는 항목이 없습니다.
        </div>
      )}

      <ul ref={listRef} className="flex flex-col gap-3">
        {cards.map((card, index) => (
          <li
            key={String(card['id'])}
            data-active={index === cursor}
            className="rounded-md data-[active=true]:ring-2 data-[active=true]:ring-status-action"
          >
            <ApprovalCard card={card} active={index === cursor} />
          </li>
        ))}
      </ul>
    </div>
  );
}
