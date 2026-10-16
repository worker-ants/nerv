// 유형 칸 — 받은 요청을 카드 유형으로 거른다 (2026-10-16 · 사람 결정 D3 · screens.md §2.7 · REQ-WEB-326)
//
// 와이어프레임(ui-wireframes §2.7 ①)의 유형 필터다. 오래 "에스컬레이션 — 준비 중" 으로 비활성이던 칸이 이제 동작한다. 판정은
// 서버의 것이다 — 카드마다 `kind` 가 오고 칸의 수는 서버가 같은 조건으로 센 값(`kind_counts`)이다. 사유가 있는 질문은 `question`
// 과 `escalation` 양쪽에 센다(카드 모양은 질문 그대로다).
//
// 칸은 주소를 바꾸는 링크다 — 좁힌 목록을 링크로 건넬 수 있어야 한다(범위 칸과 같은 규칙 · REQ-WEB-256).

import { INBOX_KINDS } from '@nerv/schema';
import type { InboxKind } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';

export function KindFilter({
  selected,
  counts,
  hrefFor,
  onSelect,
}: {
  selected: InboxKind | undefined;
  /** 대기 탭에서만 온다 — 다른 탭에서는 수 없이 칸만 보인다 */
  counts: Partial<Record<InboxKind, number>> | null;
  hrefFor: (kind: InboxKind | undefined) => string;
  onSelect: (kind: InboxKind | undefined) => void;
}): React.JSX.Element {
  const t = useT();
  const item = (kind: InboxKind | undefined): React.JSX.Element => {
    const active = selected === kind;
    const count = kind === undefined || counts === null ? null : (counts[kind] ?? 0);
    return (
      <a
        key={kind ?? 'all'}
        href={hrefFor(kind)}
        data-testid={`inbox-kind-${kind ?? 'all'}`}
        aria-current={active ? 'true' : undefined}
        onClick={(e) => {
          // 가운데 클릭 · 수정 키는 새 탭이다 — 앱 안의 이동은 그 밖일 때만
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onSelect(kind);
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-nerv-sm border px-2 py-0.5 text-xs',
          active
            ? 'border-border-strong bg-bg-active font-medium text-text'
            : 'border-border text-text-mute hover:bg-bg-hover hover:text-text',
        )}
      >
        <span>{kind === undefined ? t('inbox.kind.all') : t(`inbox.kind.${kind}`)}</span>
        {count !== null && (
          <span
            data-testid={`inbox-kind-count-${kind ?? 'all'}`}
            title={t('inbox.kind.count', { count })}
            className={cn('tabular-nums', count === 0 ? 'text-text-faint' : 'text-text')}
          >
            {count}
          </span>
        )}
      </a>
    );
  };
  return (
    <nav
      aria-label={t('inbox.kind.heading')}
      data-testid="inbox-kind-filter"
      className="mb-3 flex flex-wrap items-center gap-1.5"
    >
      <span className="mr-1 text-2xs text-text-faint">{t('inbox.kind.heading')}</span>
      {item(undefined)}
      {INBOX_KINDS.map((kind) => item(kind))}
    </nav>
  );
}
