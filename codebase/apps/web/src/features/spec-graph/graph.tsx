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
//
// **노드를 누르는 것은 "연다"가 아니라 "고른다"이다**(사람 지시 2026-08-24). 예전에는 탭
// 한 번이 곧 문서 이동이라, 그래프에서 무엇 하나를 자세히 보려면 화면을 떠나야 했고
// 돌아오면 배치가 다시 계산돼 방금 보던 그림이 사라졌다 — 탐색 도구가 탐색을 끊었다.
// 이제 고른 노드와 그 이웃·간선이 강조되고, 오른쪽 패널이 관계를 글자로 적는다.
// **이동은 패널에서 이름을 누를 때만** 일어난다.

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { RelationTabs } from '../../components/relation-tabs.js';
import type { RelationDirection } from '../../components/relation-tabs.js';
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
  /** 문서로 이동한다 — **패널에서 이름을 눌렀을 때만** 부른다 */
  onOpen: (key: string) => void;
}

/** 패널 한 줄 — 이웃 하나와 그 관계 */
export interface Connection {
  node: GraphNode;
  kind: string;
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

/**
 * 고른 노드·이웃·간선을 강조하고 나머지를 가라앉힌다.
 *
 * **영역 상자(`:parent`)는 덜 가라앉힌다** — 그것은 노드가 아니라 배경이다. 노드와 같이
 * 지우면 고른 문서가 어느 영역에 있는지를 잃고, 그대로 두면 전부 흐려진 화면에서 상자만
 * 남아 지도가 뒤집힌다(스타일의 `:parent.faded` 가 그 중간을 잡는다).
 */
/**
 * 고른 문서의 이웃을 방향으로 갈라 돌려준다 — **화면에 그린 것이 아니라 실제 관계 전부**다.
 *
 * 중심 모드(1 hop)에서 이웃의 이웃은 그려지지 않는데, 그때 패널까지 화면을 따라 줄이면
 * 패널이 "이 문서는 이것뿐"이라고 거짓을 말한다. 그림은 view 이고 패널은 data 다.
 */
export function connectionsOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  key: string | null,
): { out: Connection[]; in: Connection[] } {
  const start = key === null ? undefined : nodes.find((n) => n.key === key);
  if (start === undefined) return { out: [], in: [] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pick = (id: string, kind: string): Connection | null => {
    const node = byId.get(id);
    return node === undefined ? null : { node, kind };
  };
  const real = (c: Connection | null): c is Connection => c !== null;
  return {
    out: edges
      .filter((e) => e.from_id === start.id)
      .map((e) => pick(e.to_id, e.kind))
      .filter(real),
    in: edges
      .filter((e) => e.to_id === start.id)
      .map((e) => pick(e.from_id, e.kind))
      .filter(real),
  };
}

/**
 * 고른 노드가 시야 밖이면 그때만 시야를 옮긴다.
 *
 * 패널이 열리면 캔버스가 288px 좁아진다 — 방금 누른 노드가 그 자리에 있었으면 패널
 * 뒤로 숨는다(실측 2026-08-24). **줌은 건드리지 않는다**: 사람이 맞춰 둔 배율을 빼앗지
 * 않고 옮기기만 한다. 이미 잘 보이는 노드는 그대로 둔다 — 누를 때마다 화면이 튀면
 * 그래프를 훑는 일 자체가 어지러워진다.
 */
function ensureVisible(cy: cytoscape.Core, key: string | null): void {
  if (key === null) return;
  const node = cy.nodes().filter((n) => n.data('key') === key);
  if (node.empty()) return;
  const box = node.renderedBoundingBox();
  const pad = 48;
  const hidden =
    box.x1 < pad || box.y1 < pad || box.x2 > cy.width() - pad || box.y2 > cy.height() - pad;
  if (hidden) cy.animate({ center: { eles: node } }, { duration: 180 });
}

function applyHighlight(cy: cytoscape.Core, key: string | null): void {
  cy.batch(() => {
    cy.elements().removeClass('faded linked picked');
    if (key === null) return;
    const node = cy.nodes().filter((n) => n.data('key') === key);
    if (node.empty()) return;
    const near = node.closedNeighborhood();
    cy.elements().difference(near).addClass('faded');
    near.edges().addClass('linked');
    near.nodes().difference(node).addClass('linked');
    node.addClass('picked');
  });
}

export function SpecGraph({ nodes, edges, focusKey, onOpen }: SpecGraphProps): React.JSX.Element {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [focus, setFocus] = useState<string | null>(focusKey ?? null);
  const [hops, setHops] = useState(1);
  const [grouped, setGrouped] = useState(true);
  /** 고른 문서의 key — 이동이 아니라 **선택**이다 */
  const [selected, setSelected] = useState<string | null>(null);
  // 패널의 방향 탭 — 레일(§2.4)과 같은 컴포넌트·같은 어휘를 쓴다
  const [relTab, setRelTab] = useState<RelationDirection>('all');
  // 그래프를 다시 그린 뒤에도 강조를 되살려야 한다. 빌드 이펙트가 `selected` 를 의존하면
  // 노드를 누를 때마다 배치가 다시 계산돼 그림이 튄다 — ref 로 읽는다.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const selectedNode = useMemo(
    () => (selected === null ? undefined : nodes.find((n) => n.key === selected)),
    [nodes, selected],
  );

  /**
   * 고른 문서의 이웃 — **화면에 그린 것이 아니라 실제 관계 전부**다.
   *
   * 중심 모드(1 hop)에서 이웃의 이웃은 그려지지 않는데, 그때 패널까지 화면을 따라
   * 줄이면 패널이 "이 문서는 이것뿐"이라고 거짓을 말한다. 그림은 view 이고 패널은 data 다.
   */
  const links = useMemo(() => connectionsOf(nodes, edges, selected), [edges, nodes, selected]);
  const shownLinks =
    relTab === 'in' ? links.in : relTab === 'out' ? links.out : [...links.in, ...links.out];

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
        // 고른 것과 그 이웃만 남기고 나머지는 **가라앉힌다**. 지우지 않는 이유는 지도가
        // 지도로 남아야 하기 때문이다 — 주변이 사라지면 어디를 보고 있는지 알 수 없다.
        {
          selector: '.faded',
          style: { opacity: 0.12, 'text-opacity': 0 },
        },
        // 영역 상자는 **덜** 가라앉힌다. 노드와 같이 지우면 고른 문서가 어느 영역에
        // 있는지를 잃고, 그대로 두면 전부 흐려진 화면에서 상자만 남아 지도가 뒤집힌다.
        {
          selector: ':parent.faded',
          style: { opacity: 0.4, 'text-opacity': 0.4 },
        },
        {
          selector: 'node.linked',
          style: {
            'border-width': 2,
            'border-color': cssVar('--color-status-action'),
            'border-opacity': 0.65,
          },
        },
        {
          selector: 'edge.linked',
          style: {
            width: 2,
            opacity: 1,
            'line-color': cssVar('--color-status-action'),
            'target-arrow-color': cssVar('--color-status-action'),
          },
        },
        {
          selector: 'node.picked',
          style: {
            'border-width': 4,
            'border-color': cssVar('--color-status-action'),
            'border-opacity': 1,
            color: cssVar('--color-text'),
            'font-size': 11,
            'text-opacity': 1,
            'z-index': 10,
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
    // **누르는 것은 고르는 것이다.** 문서로 가는 길은 패널의 이름 하나뿐이다.
    cy.on('tap', 'node', (event) => {
      const key = String(event.target.data('key'));
      if (key !== '') setSelected(key);
    });
    // 바탕을 누르면 놓는다 — 패널을 닫으려고 X 를 찾아가게 하지 않는다
    cy.on('tap', (event) => {
      if (event.target === cy) setSelected(null);
    });

    cyRef.current = cy;
    applyHighlight(cy, selectedRef.current);
    return () => {
      cyRef.current = null;
      cy.destroy();
    };
  }, [edges, focus, grouped, nodes, visible]);

  // 고른 것이 바뀌면 **다시 그리지 않고** 클래스만 갈아 끼운다.
  // 이어서 캔버스 폭이 바뀐 것을 알리고(패널이 열리고 닫힌다), 고른 노드가 시야 밖으로
  // 밀려났으면 그때만 시야를 옮긴다.
  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null) return;
    applyHighlight(cy, selected);
    cy.resize();
    ensureVisible(cy, selected);
  }, [selected]);

  // 다른 문서를 고르면 방향 탭도 처음으로 돌린다 — 역참조가 없는 문서를 골랐는데
  // 역참조 탭이 남아 있으면 빈 패널이 열리고, 사람은 그것을 "관계가 없다"로 읽는다
  useEffect(() => setRelTab('all'), [selected]);

  const panelOpen = selectedNode !== undefined;

  // Esc 로 놓는다 — 마우스를 캔버스 밖으로 옮기지 않고 빠져나올 수 있어야 한다
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);

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
      <div className="flex gap-2">
        <div
          ref={container}
          data-testid="spec-graph"
          className="h-[70vh] min-w-0 flex-1 rounded-nerv border border-border bg-bg-elev"
        />
        {selectedNode !== undefined && (
          <aside
            data-testid="graph-panel"
            className="flex h-[70vh] w-[288px] shrink-0 flex-col overflow-y-auto rounded-nerv border border-border bg-bg-elev"
          >
            {/* 머리에 고른 문서의 이름. **이름 자체가 문 이다** — 이동은 여기서만 일어난다 */}
            <header className="sticky top-0 z-10 border-b border-border bg-bg-elev px-3 py-2.5">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  data-testid="graph-panel-open"
                  onClick={() => onOpen(selectedNode.key)}
                  className="min-w-0 flex-1 text-left text-base leading-[1.35] font-semibold tracking-[-0.01em] text-text hover:text-link hover:underline"
                >
                  {selectedNode.title}
                </button>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-nerv-sm px-1 text-text-faint hover:bg-bg-hover hover:text-text"
                >
                  ✕
                </button>
              </div>
              <p className="mt-0.5 truncate font-mono text-2xs text-text-faint">
                {selectedNode.key}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFocus(selectedNode.key);
                  setHops(1);
                }}
                className="mt-1.5 rounded-nerv-sm px-1.5 py-0.5 text-2xs text-text-mute hover:bg-bg-hover hover:text-text"
              >
                {t('graph.panel.center')}
              </button>
            </header>

            {/* 레일과 **같은 탭·같은 어휘**다(§2.4) — 두 화면이 관계를 다르게 부르면
                사람은 그 둘이 같은 것인지부터 의심하게 된다 */}
            <RelationTabs
              value={relTab}
              onChange={setRelTab}
              counts={{
                all: links.in.length + links.out.length,
                in: links.in.length,
                out: links.out.length,
              }}
              className="border-b border-border px-1.5 py-1.5"
            />

            <div className="flex flex-col gap-0.5 px-1.5 py-2">
              {shownLinks.length === 0 && (
                <p className="px-1.5 text-sm text-text-faint">{t('graph.panel.empty')}</p>
              )}
              {relTab !== 'out' &&
                links.in.map((c) => (
                  <ConnectionRow key={connectionKey(c)} connection={c} incoming onOpen={onOpen} />
                ))}
              {/* 전체 탭에서 방향이 바뀌는 자리에 선을 긋는다 — 레일과 같은 규약이다 */}
              {relTab === 'all' && links.in.length > 0 && links.out.length > 0 && (
                <hr data-testid="graph-panel-divider" className="my-1.5 border-t border-border" />
              )}
              {relTab !== 'in' &&
                links.out.map((c) => (
                  <ConnectionRow key={connectionKey(c)} connection={c} onOpen={onOpen} />
                ))}
            </div>

            {shownLinks.length > 0 && (
              <p className="mt-auto border-t border-border px-3 py-2 text-2xs text-text-ghost">
                {t('graph.panel.hint')}
              </p>
            )}
          </aside>
        )}
      </div>
      <p className="text-2xs text-text-faint">{t('graph.hint')}</p>
    </div>
  );
}

/** 이웃 한 줄의 키 — 같은 문서가 kind 를 달리해 두 번 나올 수 있다 */
function connectionKey(c: Connection): string {
  return `${c.node.id}-${c.kind}`;
}

/**
 * 패널의 이웃 한 줄. **레일의 관계 줄과 같은 생김새**다(§2.4) — 두 무리가 같은
 * 컴포넌트를 쓰듯, 두 화면도 같은 모양이어야 방향만 다른 같은 것으로 읽힌다.
 */
function ConnectionRow({
  connection,
  incoming,
  onOpen,
}: {
  connection: Connection;
  incoming?: boolean;
  onOpen: (key: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(connection.node.key)}
      className="flex w-full items-start gap-[9px] rounded-nerv px-1.5 py-1.5 text-left transition-colors hover:bg-bg-hover"
    >
      {/* 방향 표식은 레일과 같다 — 들어오는 것은 조용히, 나가는 것은 물들여서 */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-px inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-[9.5px] font-semibold',
          incoming === true
            ? 'bg-bg-sunken text-text-mute'
            : 'bg-status-action-soft text-status-action',
        )}
      >
        {incoming === true ? '↓' : '↑'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-[1.45] text-text">
          {connection.node.title}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-text-faint">
          {connection.kind} · {connection.node.key}
        </span>
      </span>
    </button>
  );
}
