// 스펙 관계 그래프 — 정본: docs/04-mvp/screens.md §2.4a
//
// **밀도가 이 화면의 유일한 설계 문제다.** clemvion 은 노드 141 · 간선 1,253 이고 최다
// 피참조 문서는 52개의 선을 받는다(실측). 힘기반 배치에 그대로 넣으면 털뭉치가 되고,
// 털뭉치는 "이 문서를 고치면 무엇이 흔들리나"에 답하지 못한다.
//
// 그래서 셋을 쓴다.
//   ① **영역으로 묶는다** — 트리의 부모(area)를 compound 노드로 만든다. 계층과 참조를 한
//      좌표계에 그리면 선이 영역 안/밖으로 갈리면서 구조가 드러난다(fcose 가 그것을 안다)
//   ② **중심 모드** — 한 문서에서 1~2 hop 만. 전역은 지도이고 중심은 답이다
//   ③ **차수 기반 크기** — 허브가 커서 눈에 먼저 들어오게. 색은 상태 토큰을 그대로 쓴다

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/primitives.js';

cytoscape.use(fcose);

export interface GraphNode {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  doc_status: string | null;
}
export interface GraphEdge {
  from_id: string;
  to_id: string;
  kind: string;
}

export interface SpecGraphProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** 중심 문서 — 주면 자기중심 모드로 시작한다 */
  focusKey?: string | undefined;
  onOpen: (key: string) => void;
}

/** 상태 토큰을 그대로 쓴다 — 그래프만 다른 색 체계를 갖지 않는다(screens.md §4.2) */
const TYPE_COLOR: Record<string, string> = {
  vision: '--color-status-action',
  area: '--color-status-agent',
  feature: '--color-status-progress',
  design: '--color-status-waiting',
  convention: '--color-status-done',
  adr: '--color-status-danger',
};

/**
 * 토큰 값을 실제 색으로 읽는다 — canvas 렌더러는 `var(--x)` 를 이해하지 못한다.
 *
 * **폴백 색을 두지 않는다**(REQ-WEB-032). 토큰이 비어 있다면 그것은 `tokens.css` 의 결함이지
 * 여기서 hex 로 메울 일이 아니다 — 메우면 그 결함이 영영 안 보인다. 브라우저 밖(테스트)에서는
 * 빈 문자열이 돌아오고 cytoscape 가 자기 기본값을 쓴다. 그 화면은 검사 대상이 아니다.
 */
function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 중심에서 hop 이내의 노드 id — **방향을 가리지 않는다**.
 *
 * "이 문서를 고치면 무엇이 흔들리나"의 답에는 내가 참조하는 것과 나를 참조하는 것이 **둘 다**
 * 들어간다. 나가는 선만 따라가면 역참조가 빠지고, 그건 영향 분석에서 가장 중요한 절반이다.
 *
 * 모르는 키면 전체를 돌려준다 — 빈 화면보다 낫다.
 */
export function neighborhoodForTesting(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  aroundKey: string,
  hops: number,
): Set<string> {
  const start = nodes.find((n) => n.key === aroundKey);
  if (start === undefined) return new Set(nodes.map((n) => n.id));
  const near = new Set([start.id]);
  for (let i = 0; i < hops; i += 1) {
    const next: string[] = [];
    for (const edge of edges) {
      if (near.has(edge.from_id) && !near.has(edge.to_id)) next.push(edge.to_id);
      if (near.has(edge.to_id) && !near.has(edge.from_id)) next.push(edge.from_id);
    }
    if (next.length === 0) break;
    for (const id of next) near.add(id);
  }
  return near;
}

export function SpecGraph({ nodes, edges, focusKey, onOpen }: SpecGraphProps): React.JSX.Element {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<string | null>(focusKey ?? null);
  const [hops, setHops] = useState(1);
  const [grouped, setGrouped] = useState(true);

  /** 중심 모드면 hop 이내만 남긴다 — 전역은 지도, 중심은 답이다 */
  const visible = useMemo(
    () =>
      focus === null
        ? new Set(nodes.map((n) => n.id))
        : neighborhoodForTesting(nodes, edges, focus, hops),
    [edges, focus, hops, nodes],
  );

  useEffect(() => {
    const el = container.current;
    if (el === null) return;

    const shown = nodes.filter((n) => visible.has(n.id));
    const shownIds = new Set(shown.map((n) => n.id));
    const degree = new Map<string, number>();
    for (const edge of edges) {
      if (!shownIds.has(edge.from_id) || !shownIds.has(edge.to_id)) continue;
      degree.set(edge.to_id, (degree.get(edge.to_id) ?? 0) + 1);
    }

    const cy = cytoscape({
      container: el,
      // compound 부모는 **보이는 노드 중에서만** 잡는다 — 부모가 화면 밖이면 cytoscape 가 던진다
      elements: [
        ...shown.map((n) => ({
          data: {
            id: n.id,
            label: n.title,
            key: n.key,
            type: n.type,
            weight: 18 + Math.min(26, (degree.get(n.id) ?? 0) * 1.6),
            ...(grouped && n.parent_id !== null && shownIds.has(n.parent_id)
              ? { parent: n.parent_id }
              : {}),
          },
        })),
        ...edges
          .filter((e) => shownIds.has(e.from_id) && shownIds.has(e.to_id))
          .map((e, i) => ({ data: { id: `e${i}`, source: e.from_id, target: e.to_id } })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (n: cytoscape.NodeSingular) =>
              cssVar(TYPE_COLOR[String(n.data('type'))] ?? '--color-text-mute'),
            label: 'data(label)',
            'font-size': 9,
            color: cssVar('--color-text-mute'),
            'text-valign': 'bottom',
            'text-margin-y': 3,
            // 라벨이 겹치면 아무것도 못 읽는다 — 잘라서 보여주고 전문은 클릭으로
            'text-max-width': '90px',
            'text-wrap': 'ellipsis',
            width: 'data(weight)',
            height: 'data(weight)',
          },
        },
        {
          selector: ':parent',
          style: {
            'background-opacity': 0.06,
            'border-width': 1,
            'border-color': cssVar('--color-border-strong'),
            'text-valign': 'top',
            'font-size': 11,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': cssVar('--color-border-strong'),
            'target-arrow-color': cssVar('--color-border-strong'),
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.6,
            'curve-style': 'bezier',
            opacity: 0.55,
          },
        },
        {
          selector: '.focus',
          style: {
            'border-width': 3,
            'border-color': cssVar('--color-status-action'),
          },
        },
      ],
      layout: {
        name: 'fcose',
        // 밀도가 높을수록 밀어내는 힘을 키운다 — 기본값으로는 중앙에 뭉친다
        nodeRepulsion: 9000,
        idealEdgeLength: 90,
        nestingFactor: 0.2,
        animate: false,
        randomize: true,
      } as cytoscape.LayoutOptions,
      // 읽기 전용이다 — 그래프에서 문서를 옮기는 경로는 만들지 않는다(트리가 그 자리다)
      autoungrabify: true,
      wheelSensitivity: 0.2,
    });

    if (focus !== null) {
      const node = cy.nodes().filter((n) => n.data('key') === focus);
      node.addClass('focus');
    }
    cy.on('tap', 'node', (event) => {
      const key = String(event.target.data('key'));
      if (key !== '') onOpen(key);
    });

    return () => cy.destroy();
  }, [edges, focus, grouped, nodes, onOpen, visible]);

  const shownCount = visible.size;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          variant={focus === null ? 'primary' : 'default'}
          onClick={() => setFocus(null)}
        >
          {t('graph.mode.global')}
        </Button>
        {focusKey !== undefined && (
          <Button
            size="sm"
            variant={focus !== null ? 'primary' : 'default'}
            onClick={() => setFocus(focusKey)}
          >
            {t('graph.mode.ego')}
          </Button>
        )}
        {focus !== null && (
          <span className="flex items-center gap-1">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHops(n)}
                className={cn(
                  'rounded-nerv-sm px-2 py-0.5',
                  hops === n ? 'bg-bg-active font-medium' : 'text-text-mute hover:bg-bg-hover',
                )}
              >
                {t('graph.hops', { n })}
              </button>
            ))}
          </span>
        )}
        <label className="flex items-center gap-1.5 text-text-mute">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          {t('graph.group_by_area')}
        </label>
        <span className="ml-auto text-text-faint">
          {t('graph.counts', { nodes: shownCount, edges: edges.length })}
        </span>
      </div>
      {/* 높이를 고정한다 — 그래프는 스크롤이 아니라 확대/축소로 본다 */}
      <div
        ref={container}
        data-testid="spec-graph"
        className="h-[70vh] w-full rounded-nerv border border-border bg-bg-elev"
      />
      <p className="text-2xs text-text-faint">{t('graph.hint')}</p>
    </div>
  );
}
