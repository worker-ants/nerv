// 스펙 표 — 정본: docs/04-mvp/screens.md §2.4b
//
// **트리는 "어디 있나"에 답하고 표는 "어디가 비었나"에 답한다.** 130편을 계층으로 훑으면
// 요구사항 0건인 문서나 아무도 참조하지 않는 문서가 가지 속에 묻힌다 — 정렬 가능한 열이
// 그것을 한 번에 드러낸다. 같은 데이터의 다른 질문이라 탭으로 나란히 둔다.

import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { statusLabelKey } from '@nerv/schema';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { StatusBadge } from '../../components/status-badge.js';
import { SPEC_VERSION_TOKEN } from '../../components/status-token.js';
import { Mono, Table, Td, Th, Tr } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';
import type { GraphEdge, GraphNode } from './graph.js';

type SortKey = 'title' | 'type' | 'status' | 'backlinks';

export interface SpecTableProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  projectSlug: string;
}

/** 뿌리까지의 제목 경로 — 표에는 계층이 없으니 경로가 그 자리를 대신한다 */
function pathOf(node: GraphNode, byId: Map<string, GraphNode>): string {
  const parts: string[] = [];
  let parent = node.parent_id;
  while (parent !== null && parts.length < 6) {
    const found = byId.get(parent);
    if (found === undefined) break;
    parts.unshift(found.title);
    parent = found.parent_id;
  }
  return parts.join(' / ');
}

export function SpecTable({ nodes, edges, projectSlug }: SpecTableProps): React.JSX.Element {
  const t = useT();
  const [sort, setSort] = useState<SortKey>('title');
  const [descending, setDescending] = useState(false);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const backlinks = useMemo(() => {
    const count = new Map<string, number>();
    for (const edge of edges) count.set(edge.to_id, (count.get(edge.to_id) ?? 0) + 1);
    return count;
  }, [edges]);

  const rows = useMemo(() => {
    const list = [...nodes];
    const direction = descending ? -1 : 1;
    list.sort((a, b) => {
      if (sort === 'backlinks') {
        return direction * ((backlinks.get(a.id) ?? 0) - (backlinks.get(b.id) ?? 0));
      }
      const left = sort === 'type' ? a.type : sort === 'status' ? (a.doc_status ?? '') : a.title;
      const right = sort === 'type' ? b.type : sort === 'status' ? (b.doc_status ?? '') : b.title;
      return direction * left.localeCompare(right);
    });
    return list;
  }, [backlinks, descending, nodes, sort]);

  function header(key: SortKey, label: string): React.JSX.Element {
    const active = sort === key;
    return (
      <Th>
        <button
          type="button"
          onClick={() => {
            // 같은 열을 다시 누르면 방향만 뒤집는다 — 다른 열로 옮기면 오름차순부터
            if (active) setDescending((d) => !d);
            else {
              setSort(key);
              setDescending(false);
            }
          }}
          className={cn('inline-flex items-center gap-1', active ? 'text-text' : 'hover:text-text')}
        >
          {label}
          {/* 방향은 기호만으로 두지 않는다 — 화살표가 없으면 정렬 중인지도 모른다 */}
          {active && <span aria-hidden="true">{descending ? '▾' : '▴'}</span>}
        </button>
      </Th>
    );
  }

  return (
    <>
      {/* 트리와 **같은 표기**를 쓴다 — 두 탭의 수가 다르다는 것을 사람이 발견하는 자리가
          화면 안이어야 한다(REQ-WEB-102). 표는 계층을 접지 않으므로 늘 전수다 */}
      <div className="mb-2 flex justify-end">
        <span data-testid="table-count" className="text-xs text-text-faint tabular-nums">
          {t('specs.count.shown_total', { shown: rows.length, total: nodes.length })}
        </span>
      </div>
      <Table
        head={
          <>
            {header('title', t('specs.col.title'))}
            {header('type', t('specs.col.type'))}
            {header('status', t('specs.col.status'))}
            {header('backlinks', t('specs.col.backlinks'))}
            <Th>{t('specs.col.path')}</Th>
          </>
        }
      >
        {rows.map((node) => (
          <Tr key={node.id}>
            <Td>
              <Link
                to="/p/$proj/specs/$spec"
                params={{ proj: projectSlug, spec: node.key }}
                className={cn(
                  'font-medium hover:text-link',
                  node.archived_at != null ? 'text-text-faint' : undefined,
                )}
              >
                {node.title}
              </Link>{' '}
              <Mono>{node.key}</Mono>{' '}
              {node.archived_at != null && (
                <StatusBadge token="idle" label={t('specs.archived_badge')} />
              )}
            </Td>
            <Td className="text-xs text-text-mute">
              {t(`specs.type.${node.type}` as 'specs.type.feature')}
            </Td>
            <Td>
              {node.doc_status !== null && (
                <StatusBadge
                  token={
                    (SPEC_VERSION_TOKEN[node.doc_status as keyof typeof SPEC_VERSION_TOKEN] ??
                      'idle') as StatusToken
                  }
                  label={t(statusLabelKey('spec', node.doc_status))}
                />
              )}
            </Td>
            {/* 0 은 흐리게 — 아무도 참조하지 않는 문서를 눈이 먼저 찾게 */}
            <Td
              className={cn(
                'tabular-nums',
                (backlinks.get(node.id) ?? 0) === 0 ? 'text-text-faint' : undefined,
              )}
            >
              {backlinks.get(node.id) ?? 0}
            </Td>
            <Td className="text-xs text-text-faint">{pathOf(node, byId)}</Td>
          </Tr>
        ))}
      </Table>
    </>
  );
}
