// 스펙 트리 — 사이드바와 S3 좌측이 **같은 컴포넌트**를 쓴다 (screens.md §1.3 · §2.4)
//
// 트리는 대규모에서 먼저 무너진다(REQ-WEB-041): 노드 200개가 넘는 프로젝트에서 전체를 한 번에
// 그리면 최초 페인트가 늦어진다. 그래서 ① 기본은 depth=1 로 접어 두고 ② 필터로 좁힌다.
// 가상 스크롤은 그 다음 단계이고, 접힌 트리에서는 대개 필요해지지 않는다.

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
}

export interface SpecTreeProps {
  projectSlug: string;
  /** 쿼리 키를 이벤트 봉투와 같은 축(UUID)에 맞추기 위한 값 — 없으면 slug 로 떨어진다 */
  projectId?: string | undefined;
  compact?: boolean;
  activeKey?: string | undefined;
}

/**
 * 가상 스크롤 임계 — 이 수를 넘으면 보이는 만큼만 그린다(REQ-WEB-044).
 *
 * 트리는 대규모에서 먼저 무너진다. 다만 **접힌 트리에서는 대개 필요해지지 않는다** —
 * depth=1 로 접어두면 보이는 노드가 수십 개다. 그래서 가상 스크롤은 "펼친 상태에서
 * 여전히 많을 때"의 안전망이고, 기본 경로는 접기다.
 */
const VIRTUAL_THRESHOLD = 200;
const ROW_HEIGHT = 24;

/** 평면 목록 → 부모별 자식 맵. 서버는 정렬만 하고 계층 조립은 화면 몫이다. */
export function groupByParent(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const map = new Map<string | null, TreeNode[]>();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const siblings = map.get(node.parent_id) ?? [];
    siblings.push(node);
    map.set(node.parent_id, siblings);
  }
  return map;
}

/**
 * 펼침 상태를 브라우저에 남긴다 — 문서를 옮길 때마다 다시 펼치는 것은 반복 노동이다.
 * 프로젝트별로 나눈다: 트리 모양이 프로젝트마다 다르므로 id 를 섞으면 남의 상태를 읽는다.
 */
function storageKeyFor(projectSlug: string): string {
  return `nerv.tree.${projectSlug}`;
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
  compact,
  activeKey,
}: SpecTreeProps): React.JSX.Element {
  const t = useT();
  const tree = useSpecTree(projectSlug, projectId);
  const [filter, setFilter] = useState('');
  // null = 아직 정하지 않음. 첫 데이터가 와야 "뿌리만 펼친 상태"를 만들 수 있다.
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

  const storageKey = storageKeyFor(projectSlug);

  // 첫 펼침 상태 — 저장된 것이 있으면 그것, 없으면 **뿌리만**(REQ-WEB-041 의 depth=1 시작)
  useEffect(() => {
    if (expanded !== null || nodes.length === 0) return;
    setExpanded(
      readExpanded(storageKey) ??
        new Set(nodes.filter((n) => n.parent_id === null).map((n) => n.id)),
    );
  }, [expanded, nodes, storageKey]);

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

  // 보이는 노드만 평탄화한다 — 접힌 가지는 리스트에 아예 들어오지 않는다.
  const visible: { node: TreeNode; depth: number }[] = [];
  const collect = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      if (matches !== null && !matches.has(node.id) && !byParent.has(node.id)) continue;
      visible.push({ node, depth });
      // 필터 중에는 전부 펼친다 — 걸린 노드를 접힌 가지에 숨기면 필터가 무의미하다
      const isOpen = open.has(node.id) || matches !== null;
      if (isOpen) collect(node.id, depth + 1);
    }
  };
  collect(null, 0);

  // 200 노드를 넘으면 창 밖은 그리지 않는다 — 최초 페인트가 전체 트리를 요구하지 않게.
  const virtualized = visible.length > VIRTUAL_THRESHOLD;
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10) : 0;
  const endIndex = virtualized
    ? Math.min(visible.length, startIndex + Math.ceil(viewportHeight / ROW_HEIGHT) + 20)
    : visible.length;

  const renderLevel = (parentId: string | null, depth: number): React.JSX.Element[] =>
    (byParent.get(parentId) ?? [])
      .filter((node) => matches === null || matches.has(node.id) || byParent.has(node.id))
      .map((node) => {
        const children = byParent.get(node.id) ?? [];
        // depth=1 까지만 펼친 채로 시작한다 — 나머지는 눌러야 로드·렌더한다(REQ-WEB-041)
        const isOpen = open.has(node.id) || matches !== null;
        return (
          <li key={node.id} style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
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
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-nerv-sm py-1 pr-1 text-sm text-text-mute data-[active=true]:bg-bg-active data-[active=true]:font-medium data-[active=true]:text-text"
              >
                <span className="truncate">{node.title}</span>
                {!isOpen && children.length > 0 && (
                  <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                    {children.length}
                  </span>
                )}
                {/* **다 같으면 그건 신호가 아니다**(2026-08-23 재검토). 141편 중 128편이
                    `approved` 라 배지를 모든 줄에 달면 초록색이 줄마다 반복되고,
                    정작 눈에 띄어야 할 초안·폐기가 그 반복 속에 묻힌다.
                    좁은 사이드바에서는 **평소와 다른 것만** 말한다 — 승인됨은 침묵이다.
                    전체 화면 트리(`compact` 아님)는 폭이 있으니 배지를 그대로 단다. */}
                {node.doc_status !== null &&
                  (compact ? (
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
            {isOpen && children.length > 0 && <ul>{renderLevel(node.id, depth + 1)}</ul>}
          </li>
        );
      });

  return (
    <div data-testid="spec-tree" data-virtualized={virtualized}>
      {!(compact ?? false) && (
        <div className="mb-2 flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('specs.tree_filter')}
          />
          <button
            type="button"
            data-testid="tree-expand-all"
            onClick={() =>
              setOpen(new Set(nodes.filter((n) => byParent.has(n.id)).map((n) => n.id)))
            }
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
          <div style={{ height: visible.length * ROW_HEIGHT, position: 'relative' }}>
            <ul style={{ position: 'absolute', top: startIndex * ROW_HEIGHT, left: 0, right: 0 }}>
              {visible.slice(startIndex, endIndex).map(({ node, depth }) => (
                <li key={node.id} style={{ paddingLeft: depth * 12, height: ROW_HEIGHT }}>
                  <Link
                    to="/p/$proj/specs/$spec"
                    params={{ proj: projectSlug, spec: node.key }}
                    data-active={node.key === activeKey}
                    className="flex items-center gap-1.5 truncate rounded-nerv-sm px-1 text-sm text-text-mute hover:bg-bg-hover data-[active=true]:bg-bg-active data-[active=true]:font-medium data-[active=true]:text-text"
                  >
                    <span className="truncate">{node.title}</span>
                    {node.doc_status !== null && (
                      <StatusBadge
                        token={
                          (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                            'idle') as StatusToken
                        }
                        label={t(statusLabelKey('spec', node.doc_status))}
                      />
                    )}
                  </Link>
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
