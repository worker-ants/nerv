// 스펙 트리 — 사이드바와 스펙 목록이 **같은 컴포넌트**를 쓴다 (screens.md §1.3 · §2.4)
//
// 두 자리는 역할이 다르다(`variant`).
//
// - `rail` — 좁은 사이드바. 늘 떠 있는 **동반자**라 부분이어도 되지만, 부분임을 수로 말한다.
// - `full` — 스펙 목록 화면(`/p/:proj/specs`). **전수 목록이다**: 이 화면에 있는 것이 그
//   프로젝트 문서의 전부다. 목록에 노출되어야 열람도 가능한 구조라(2026-08-29 — 사람 지시),
//   처음 열었을 때 접힌 가지에 문서가 숨어 있으면 그 문서는 없는 것과 같다. 실측이 그랬다:
//   clemvion 141편 중 화면에 있던 것은 106편, sudoku 는 6편 중 3편이었다.
//
// 접는 것은 **사람의 조작**이고 기본값이 아니다. 규모의 부담은 가상 스크롤이 진다(REQ-WEB-044).

import { statusLabelKey } from '@nerv/schema';
import { useT } from '../lib/i18n.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rows, useSpecTree } from '../lib/queries.js';
import { StatusBadge } from './status-badge.js';
import { cn } from '../lib/utils.js';
import { Input } from './ui/primitives.js';
import { SPEC_VERSION_TOKEN } from './status-token.js';
import type { StatusToken } from './status-badge.js';

export interface TreeNode {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  doc_status: string | null;
  version_no: number | null;
  /** 보관 시각 — 보관 보기를 켰을 때만 null 이 아닌 것이 섞인다 */
  archived_at?: string | null;
}

/** 트리가 서는 자리 — 화면 밀도가 아니라 **역할**이다(전수인가 동반자인가). */
export type SpecTreeVariant = 'rail' | 'full';

export interface SpecTreeProps {
  /** 구역 머리(예: "스펙 트리") — 시안은 개수를 함께 적는다 */
  heading?: string;
  projectSlug: string;
  /** 쿼리 키를 이벤트 봉투와 같은 축(UUID)에 맞추기 위한 값 — 없으면 slug 로 떨어진다 */
  projectId?: string | undefined;
  variant?: SpecTreeVariant;
  activeKey?: string | undefined;
  /** 보관한 문서까지 담는다 — 전수 목록 화면의 토글이 이것을 켠다(REQ-WEB-105) */
  includeArchived?: boolean;
}

/**
 * 가상 스크롤 임계 — 이 수를 넘으면 보이는 만큼만 그린다(REQ-WEB-044).
 *
 * 전수 목록은 기본이 전부 펼침이라 큰 프로젝트에서 이 분기가 곧바로 걸린다. 그래서
 * **가상 분기도 일반 렌더와 같은 줄을 그린다** — 삼각형과 자식 수가 사라지면 200편을
 * 넘긴 프로젝트만 접을 수단을 잃는다.
 */
const VIRTUAL_THRESHOLD = 200;
const ROW_HEIGHT = 24;

/**
 * 평면 목록 → 부모별 자식 맵. 서버는 정렬만 하고 계층 조립은 화면 몫이다.
 *
 * **부모를 못 찾은 노드는 뿌리로 올린다.** 렌더는 뿌리(`null`)에서 내려가므로, 부모가 이
 * 응답에 없는 노드를 그 부모 아래에 넣어 두면 그 문서는 **화면에서 사라진다** — 목록에
 * 없으면 열람도 없다는 것이 이 화면의 계약이라(REQ-WEB-101) 트리에 자리가 없다고 문서를
 * 지울 수는 없다. 실제로 만들 수 있는 상태였다(실측 2026-08-29 — 보관된 부모 아래 생성).
 * 서버가 그 경로를 막은 뒤에도 이 방어는 남긴다: 화면은 자기가 받은 목록을 다 그려야 한다.
 */
export function groupByParent(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const list = Array.isArray(nodes) ? nodes : [];
  const known = new Set(list.map((n) => n.id));
  const map = new Map<string | null, TreeNode[]>();
  for (const node of list) {
    const parent = node.parent_id !== null && known.has(node.parent_id) ? node.parent_id : null;
    const siblings = map.get(parent) ?? [];
    siblings.push(node);
    map.set(parent, siblings);
  }
  return map;
}

/**
 * 첫 펼침 상태 — 저장된 것이 없을 때의 초깃값이다.
 *
 * `full` 은 **전부**다. 전수 목록의 약속이 여기서 지켜진다.
 * `rail` 은 뿌리까지 — 141줄이 늘 떠 있으면 그 아래 아무것도 안 보인다.
 */
export function defaultExpanded(nodes: TreeNode[], variant: SpecTreeVariant): Set<string> {
  if (variant === 'rail') {
    return new Set(nodes.filter((n) => n.parent_id === null).map((n) => n.id));
  }
  const parents = new Set(nodes.map((n) => n.parent_id).filter((id): id is string => id !== null));
  return new Set(nodes.filter((n) => parents.has(n.id)).map((n) => n.id));
}

/**
 * 펼침 상태를 브라우저에 남긴다 — 문서를 옮길 때마다 다시 펼치는 것은 반복 노동이다.
 *
 * 프로젝트별로 나누고 **역할별로도 나눈다**: 두 트리가 한 열쇠를 함께 쓰면 사이드바에서
 * 가지 하나를 접은 것이 전수 목록의 첫 화면을 부분으로 만든다(같은 화면에 106과 141이
 * 동시에 뜨던 원인 — 실측 2026-08-29).
 */
function storageKeyFor(projectSlug: string, variant: SpecTreeVariant): string {
  return `nerv.tree.${projectSlug}.${variant}`;
}

function readExpanded(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : new Set(JSON.parse(raw) as string[]);
  } catch {
    // 저장이 막힌 환경(사생활 보호 모드)에서도 트리는 떠야 한다
    return null;
  }
}

function writeExpanded(key: string, value: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // 이번 세션 동안만 유지된다 — 되돌려 놓는 것이 더 나쁘다
  }
}

/** 어떤 노드에서 뿌리까지의 조상 id — 딥링크로 들어와도 그 자리를 펼쳐 보이기 위해 */
export function ancestorsOf(nodes: readonly TreeNode[], key: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = nodes.find((n) => n.key === key);
  const chain: string[] = [];
  let parent = start?.parent_id ?? null;
  while (parent !== null && !chain.includes(parent)) {
    chain.push(parent);
    parent = byId.get(parent)?.parent_id ?? null;
  }
  return chain;
}

export function SpecTree({
  projectSlug,
  projectId,
  variant = 'full',
  activeKey,
  heading,
  includeArchived = false,
}: SpecTreeProps): React.JSX.Element {
  const t = useT();
  const tree = useSpecTree(projectSlug, projectId, includeArchived);
  const [filter, setFilter] = useState('');
  // null = 아직 정하지 않음. 첫 데이터가 와야 초깃값을 만들 수 있다.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // 목록 응답을 믿고 크래시하지 않는다 — 트리 하나 때문에 셸 전체가 흰 화면이 된다.
  const nodes = rows(tree.data) as unknown as TreeNode[];
  const byParent = useMemo(() => groupByParent(nodes), [nodes]);
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return null;
    return new Set(
      nodes
        .filter(
          (n) => n.title.toLowerCase().includes(needle) || n.key.toLowerCase().includes(needle),
        )
        .map((n) => n.id),
    );
  }, [filter, nodes]);

  const storageKey = storageKeyFor(projectSlug, variant);

  useEffect(() => {
    if (expanded !== null || nodes.length === 0) return;
    setExpanded(readExpanded(storageKey) ?? defaultExpanded(nodes, variant));
  }, [expanded, nodes, storageKey, variant]);

  // 보고 있는 문서까지의 길을 펼친다 — 딥링크로 들어오면 트리에서 내 위치를 알 수 없다
  useEffect(() => {
    if (activeKey === undefined || expanded === null || nodes.length === 0) return;
    const chain = ancestorsOf(nodes, activeKey);
    if (chain.every((id) => expanded.has(id))) return;
    setExpanded((prev) => new Set([...(prev ?? []), ...chain]));
  }, [activeKey, expanded, nodes]);

  // 펼쳐도 화면 밖이면 못 본 것과 같다
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, expanded]);

  const open = expanded ?? new Set<string>();
  const setOpen = (next: Set<string>): void => {
    setExpanded(next);
    writeExpanded(storageKey, next);
  };
  const toggle = (id: string): void => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  if (tree.isLoading) {
    return (
      <div data-testid="tree-skeleton" className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 rounded bg-bg-sunken" />
        ))}
      </div>
    );
  }

  if (nodes.length === 0) {
    // 막다른 길 금지 — 빈 상태에도 다음 행동이 있다(§1.5)
    return (
      <div className="text-sm text-text-mute">
        {t('specs.empty')}{' '}
        <Link to="/p/$proj/specs" params={{ proj: projectSlug }} className="text-link underline">
          {t('specs.create_first')}
        </Link>
      </div>
    );
  }

  // 필터 판정은 **한 곳에서만** 한다 — 평탄화(수 세기·가상 렌더)와 중첩 렌더가 서로 다른
  // 규칙을 쓰면 화면에 적힌 수와 화면에 그린 줄이 어긋난다.
  const childrenToShow = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).filter(
      (node) => matches === null || matches.has(node.id) || byParent.has(node.id),
    );
  // 필터 중에는 전부 펼친다 — 걸린 노드를 접힌 가지에 숨기면 필터가 무의미하다
  const isOpenOf = (node: TreeNode): boolean => open.has(node.id) || matches !== null;

  // 보이는 노드만 평탄화한다 — 접힌 가지는 리스트에 아예 들어오지 않는다.
  const visible: { node: TreeNode; depth: number }[] = [];
  const collect = (parentId: string | null, depth: number): void => {
    for (const node of childrenToShow(parentId)) {
      visible.push({ node, depth });
      if (isOpenOf(node)) collect(node.id, depth + 1);
    }
  };
  collect(null, 0);

  const shown = visible.length;
  const total = nodes.length;

  // 200 노드를 넘으면 창 밖은 그리지 않는다 — 최초 페인트가 전체 트리를 요구하지 않게.
  const virtualized = shown > VIRTUAL_THRESHOLD;
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10) : 0;
  const endIndex = virtualized
    ? Math.min(shown, startIndex + Math.ceil(viewportHeight / ROW_HEIGHT) + 20)
    : shown;

  /** 줄 하나 — 중첩 렌더와 가상 렌더가 **같은 줄**을 쓴다(둘이 갈라지면 조작이 사라진다) */
  const row = (node: TreeNode): React.JSX.Element => {
    const children = byParent.get(node.id) ?? [];
    const isOpen = isOpenOf(node);
    return (
      <div className="group flex items-center rounded-nerv-sm hover:bg-bg-hover">
        {/* 자식이 없어도 자리를 비운다 — 삼각형 유무로 들여쓰기가 어긋나면
            트리가 계단처럼 보인다 */}
        {children.length === 0 && <span aria-hidden="true" className="w-4 shrink-0" />}
        {children.length > 0 && (
          <button
            type="button"
            aria-label={isOpen ? t('specs.collapse') : t('specs.expand')}
            className="w-4 shrink-0 text-2xs text-text-faint hover:text-text"
            onClick={() => toggle(node.id)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        )}
        <Link
          to="/p/$proj/specs/$spec"
          params={{ proj: projectSlug, spec: node.key }}
          {...(node.key === activeKey ? { ref: activeRef } : {})}
          data-active={node.key === activeKey}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] pr-1 text-text-mute data-[active=true]:bg-bg-active data-[active=true]:font-medium data-[active=true]:text-text',
            // 시안: 사이드바 트리는 26px 줄에 13px 글자 — nav(29px)보다 반 단 조밀하다
            variant === 'rail' ? 'h-[26px] text-[13px]' : 'py-1 text-sm',
            // 보관한 것은 목록에 있어도 **같은 무게가 아니다** — 켜서 찾아온 사람에게만 보인다
            node.archived_at != null ? 'text-text-faint' : undefined,
          )}
        >
          <span className="truncate">{node.title}</span>
          {node.archived_at != null && (
            <StatusBadge token="idle" label={t('specs.archived_badge')} />
          )}
          {!isOpen && children.length > 0 && (
            <span className="shrink-0 text-2xs text-text-faint tabular-nums">
              {children.length}
            </span>
          )}
          {/* **다 같으면 그건 신호가 아니다**(2026-08-23 재검토). 141편 중 128편이
              `approved` 라 배지를 모든 줄에 달면 초록색이 줄마다 반복되고,
              정작 눈에 띄어야 할 초안·폐기가 그 반복 속에 묻힌다.
              좁은 사이드바에서는 **평소와 다른 것만** 말한다 — 승인됨은 침묵이다.
              전수 목록은 폭이 있으니 배지를 그대로 단다. */}
          {node.doc_status !== null &&
            (variant === 'rail' ? (
              node.doc_status !== 'approved' && (
                <span
                  aria-label={t(statusLabelKey('spec', node.doc_status))}
                  title={t(statusLabelKey('spec', node.doc_status))}
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    node.doc_status === 'draft'
                      ? 'bg-status-waiting'
                      : node.doc_status === 'in_review'
                        ? 'bg-status-progress'
                        : 'bg-status-idle-text',
                  )}
                />
              )
            ) : (
              <StatusBadge
                token={
                  (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                    'idle') as StatusToken
                }
                label={t(statusLabelKey('spec', node.doc_status))}
              />
            ))}
        </Link>
      </div>
    );
  };

  const renderLevel = (parentId: string | null, depth: number): React.JSX.Element[] =>
    childrenToShow(parentId).map((node) => {
      const children = byParent.get(node.id) ?? [];
      return (
        <li key={node.id} style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
          {row(node)}
          {isOpenOf(node) && children.length > 0 && <ul>{renderLevel(node.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <div data-testid="spec-tree" data-virtualized={virtualized}>
      {heading !== undefined && (
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-2xs font-semibold tracking-[0.07em] text-text-ghost uppercase">
            {heading}
          </span>
          {/* **수는 둘이다.** 총계만 적으면 트리는 141 을 약속하고 106 만 지킨다 —
              사이드바는 부분이므로 부분임을 스스로 말해야 한다(REQ-WEB-102) */}
          <span
            data-testid="tree-count"
            aria-label={t('specs.count.shown_total', { shown, total })}
            title={t('specs.count.shown_total', { shown, total })}
            className="text-2xs text-text-ghost tabular-nums"
          >
            {t('specs.count.short', { shown, total })}
          </span>
        </div>
      )}
      {variant === 'full' && (
        <div className="mb-2 flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('specs.tree_filter')}
          />
          <button
            type="button"
            data-testid="tree-expand-all"
            onClick={() => setOpen(defaultExpanded(nodes, 'full'))}
            className="shrink-0 rounded-nerv-sm border border-border px-2 py-1 text-xs text-text-mute hover:bg-bg-hover"
          >
            {t('specs.expand_all')}
          </button>
          <button
            type="button"
            data-testid="tree-collapse-all"
            onClick={() => setOpen(new Set())}
            className="shrink-0 rounded-nerv-sm border border-border px-2 py-1 text-xs text-text-mute hover:bg-bg-hover"
          >
            {t('specs.collapse_all')}
          </button>
          {/* 수는 그것을 바꾸는 조작 **옆에** 둔다 — 접기를 누르면 그 자리에서 줄어든다.
              시안(§2.4)은 목록 발치에 두었지만, 141줄 아래는 화면 밖이다 */}
          <span data-testid="tree-count" className="shrink-0 text-xs text-text-faint tabular-nums">
            {t('specs.count.shown_total', { shown, total })}
          </span>
        </div>
      )}
      {virtualized ? (
        <div
          data-testid="tree-viewport"
          className="max-h-[70vh] overflow-y-auto"
          ref={(el) => {
            if (el !== null && el.clientHeight !== viewportHeight)
              setViewportHeight(el.clientHeight);
          }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {/* 스크롤 높이는 전체 노드 수로 잡고 내용만 창 크기로 그린다 */}
          <div style={{ height: shown * ROW_HEIGHT, position: 'relative' }}>
            <ul style={{ position: 'absolute', top: startIndex * ROW_HEIGHT, left: 0, right: 0 }}>
              {visible.slice(startIndex, endIndex).map(({ node, depth }) => (
                <li key={node.id} style={{ paddingLeft: depth * 12, height: ROW_HEIGHT }}>
                  {row(node)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <ul>{renderLevel(null, 0)}</ul>
      )}
    </div>
  );
}
