// 관계 방향 탭 — 전체 · 역참조 · 레퍼런스
//
// **두 화면이 같은 것을 쓴다**: 스펙 상세의 우측 레일(screens.md §2.4)과 관계 그래프의
// 선택 패널(§2.4a). 각자 그리면 라벨·건수 표기·활성 표시가 조금씩 갈라지고, 그때 사람은
// 그 둘이 같은 것인지부터 의심하게 된다.
//
// 건수는 **누르기 전에** 적는다 — 빈 탭을 열어 보게 하지 않는다.

import { useT } from '../lib/i18n.js';
import { cn } from '../lib/utils.js';

/** 관계를 보는 방향. `in` = 역참조(들어오는 것), `out` = 레퍼런스(나가는 것) */
export type RelationDirection = 'all' | 'in' | 'out';

export interface RelationTabsProps {
  value: RelationDirection;
  onChange: (next: RelationDirection) => void;
  counts: Readonly<Record<RelationDirection, number>>;
  className?: string | undefined;
}

export function RelationTabs({
  value,
  onChange,
  counts,
  className,
}: RelationTabsProps): React.JSX.Element {
  const t = useT();
  return (
    <div className={cn('flex gap-1', className)}>
      {(
        [
          ['all', t('spec.rail.rel_all')],
          ['in', t('spec.rail.rel_in')],
          ['out', t('spec.rail.rel_out')],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          data-testid={`rel-tab-${key}`}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex items-center gap-1 rounded-nerv-sm px-2 py-[3px] text-2xs transition-colors',
            value === key
              ? 'bg-bg-active font-medium text-text'
              : 'text-text-faint hover:bg-bg-hover hover:text-text',
          )}
        >
          {label}
          <span className="text-text-ghost tabular-nums">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
