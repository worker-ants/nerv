// 스펙 트리 — 사이드바와 S3 좌측이 **같은 컴포넌트**를 쓴다 (screens.md §1.3 · §2.4)
//
// 트리는 대규모에서 먼저 무너진다(REQ-WEB-041): 노드 200개가 넘는 프로젝트에서 전체를 한 번에
// 그리면 최초 페인트가 늦어진다. 그래서 ① 기본은 depth=1 로 접어 두고 ② 필터로 좁힌다.
// 가상 스크롤은 그 다음 단계이고, 접힌 트리에서는 대개 필요해지지 않는다.

import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { rows, useSpecTree } from '../lib/queries.js';
import { StatusBadge } from './status-badge.js';
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

export function SpecTree({
  projectSlug,
  projectId,
  compact,
  activeKey,
}: SpecTreeProps): React.JSX.Element {
  const tree = useSpecTree(projectSlug, projectId);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
        아직 스펙이 없습니다.{' '}
        <Link to="/p/$proj/specs" params={{ proj: projectSlug }} className="text-link underline">
          첫 스펙 만들기
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
      const isOpen = expanded.has(node.id) || matches !== null || depth === 0;
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
        const isOpen = expanded.has(node.id) || matches !== null || depth === 0;
        return (
          <li key={node.id} style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
            <div className="flex items-center gap-1">
              {children.length > 0 && (
                <button
                  type="button"
                  aria-label={isOpen ? '접기' : '펼치기'}
                  className="w-4 text-xs text-text-faint"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              )}
              <Link
                to="/p/$proj/specs/$spec"
                params={{ proj: projectSlug, spec: node.key }}
                data-active={node.key === activeKey}
                className="flex min-w-0 flex-1 items-center gap-1 truncate py-0.5 text-sm data-[active=true]:font-semibold"
              >
                <span className="truncate">{node.title}</span>
                {node.doc_status !== null && (
                  <StatusBadge
                    token={
                      (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                        'idle') as StatusToken
                    }
                    label={node.doc_status}
                  />
                )}
              </Link>
            </div>
            {isOpen && children.length > 0 && <ul>{renderLevel(node.id, depth + 1)}</ul>}
          </li>
        );
      });

  return (
    <div data-testid="spec-tree" data-virtualized={virtualized}>
      {!(compact ?? false) && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="트리 필터"
          className="mb-2 w-full rounded border border-border bg-bg px-2 py-1 text-sm"
        />
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
                    className="flex items-center gap-1 truncate text-sm data-[active=true]:font-semibold"
                  >
                    <span className="truncate">{node.title}</span>
                    {node.doc_status !== null && (
                      <StatusBadge
                        token={
                          (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                            'idle') as StatusToken
                        }
                        label={node.doc_status}
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
