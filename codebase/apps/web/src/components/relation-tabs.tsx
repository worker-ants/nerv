// 관계 방향 탭 — 전체 · 역참조 · 레퍼런스
//
// **두 화면이 같은 것을 쓴다**: 스펙 상세의 우측 레일(screens.md §2.4)과 관계 그래프의
// 선택 패널(§2.4a). 각자 그리면 라벨·건수 표기·활성 표시가 조금씩 갈라지고, 그때 사람은
// 그 둘이 같은 것인지부터 의심하게 된다.
//
// 건수는 **누르기 전에** 적는다 — 빈 탭을 열어 보게 하지 않는다.

import { useT } from '../lib/i18n.js';
import { Segmented } from './ui/primitives.js';

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
  // 공용 세그먼트다 — 고르지 않은 칸이 흐린 글자뿐이던 원시 단추 묶음이었다(REQ-WEB-271)
  return (
    <Segmented
      label={t('spec.rail.relations')}
      testIdPrefix="rel-tab"
      className={className}
      value={value}
      onChange={onChange}
      options={(
        [
          ['all', t('spec.rail.rel_all')],
          ['in', t('spec.rail.rel_in')],
          ['out', t('spec.rail.rel_out')],
        ] as const
      ).map(([key, label]) => ({
        value: key,
        label: (
          <>
            {label} <span className="text-text-faint tabular-nums">{counts[key]}</span>
          </>
        ),
      }))}
    />
  );
}
