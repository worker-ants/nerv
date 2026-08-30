// 스펙 링크 고르기 — 정본: screens.md §3.1a
//
// **관계는 본문의 링크에서만 만들어진다**(api.md §2.2). 그런데 웹에서 링크를 넣는 길이
// URL 을 손으로 붙이는 것뿐이면, 사람이 쓴 문서는 계속 산문으로 남는다 — 에이전트에게만
// 규약을 지키게 하고 사람에게는 길을 주지 않는 꼴이다(2026-08-30 — 사람 결정).
//
// 목록은 **이미 받아 둔 트리**를 쓴다. 링크를 걸 만한 문서는 그 프로젝트의 전부이고
// (트리가 전수다 — REQ-WEB-101), 새 질의를 만들면 같은 것을 두 번 받게 된다.

import { useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { rows, useSpecTree } from '../../lib/queries.js';
import { Input, Mono, Popover } from '../../components/ui/primitives.js';

export interface SpecLinkPickerProps {
  projectSlug: string;
  projectId?: string | undefined;
  /** 지금 편집 중인 문서 — 자기 자신은 고를 수 없다(자기 참조는 관계가 아니다) */
  excludeKey?: string | undefined;
  onPick: (spec: { key: string; title: string }) => void;
  onClose: () => void;
}

interface Row {
  key: string;
  title: string;
}

/** 링크 대상 — `/p/<슬러그>/specs/<키>`. 웹에서 그대로 눌리고 서버는 끝의 키만 본다 */
export function specLinkHref(projectSlug: string, key: string): string {
  return `/p/${projectSlug}/specs/${key}`;
}

export function SpecLinkPicker({
  projectSlug,
  projectId,
  excludeKey,
  onPick,
  onClose,
}: SpecLinkPickerProps): React.JSX.Element {
  const t = useT();
  const tree = useSpecTree(projectSlug, projectId);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const all = (rows(tree.data) as unknown as Row[]).filter((n) => n.key !== excludeKey);
    const needle = query.trim().toLowerCase();
    const hits =
      needle === ''
        ? all
        : all.filter(
            (n) => n.title.toLowerCase().includes(needle) || n.key.toLowerCase().includes(needle),
          );
    // 스무 줄이면 고르기에 충분하다 — 그보다 길면 목록이 아니라 스크롤이 된다
    return hits.slice(0, 20);
  }, [excludeKey, query, tree.data]);

  return (
    <Popover className="w-80 p-2">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('spec.editor.link_search')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          // 아래로 내려가면 목록의 첫 줄로 — 손이 마우스로 가지 않게
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            listRef.current?.querySelector('button')?.focus();
          }
          if (e.key === 'Enter' && matches[0] !== undefined) {
            e.preventDefault();
            onPick(matches[0]);
          }
        }}
      />
      <ul ref={listRef} className="mt-1 max-h-64 overflow-y-auto">
        {matches.map((spec) => (
          <li key={spec.key}>
            <button
              type="button"
              data-testid="link-option"
              onClick={() => onPick(spec)}
              className="flex w-full items-center gap-2 rounded-nerv-sm px-2 py-1 text-left text-sm hover:bg-bg-hover focus:bg-bg-hover focus:outline-none"
            >
              <span className="min-w-0 flex-1 truncate">{spec.title}</span>
              <Mono className="shrink-0 text-2xs text-text-faint">{spec.key}</Mono>
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-2 py-1 text-xs text-text-faint">{t('spec.editor.link_empty')}</li>
        )}
      </ul>
    </Popover>
  );
}
