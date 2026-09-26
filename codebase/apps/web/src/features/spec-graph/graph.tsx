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
//   ④ **배치를 정리한다** — fcose 는 형제 영역이 겹치지 않는다고 보장하지 않는다. 겹친 상자는
//      없는 계층으로 읽히므로, 배치 뒤 한 벌 더 돌려 형제끼리 밀어내고 빈자리를 다진다
//      (`layout.ts` · 2026-09-22 사람 보고)
//   ⑤ **범례를 세운다** — 앞의 셋은 전부 *부호*다. 부호를 읽는 표가 없으면 색과 크기는
//      장식으로 보이고, 장식으로 보이는 것은 아무 질문에도 답하지 않는다
//      (2026-09-22 사람 보고 · REQ-WEB-176)
//
// **노드를 누르는 것은 "연다"가 아니라 "고른다"이다**(사람 지시 2026-08-24). 예전에는 탭
// 한 번이 곧 문서 이동이라, 그래프에서 무엇 하나를 자세히 보려면 화면을 떠나야 했고
// 돌아오면 배치가 다시 계산돼 방금 보던 그림이 사라졌다 — 탐색 도구가 탐색을 끊었다.
// 이제 고른 노드와 그 이웃·간선이 강조되고, 오른쪽 패널이 관계를 글자로 적는다.
// **이동은 패널에서 이름을 누를 때만** 일어난다.

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../lib/i18n.js';
import { cn } from '../../lib/utils.js';
import { RelationTabs } from '../../components/relation-tabs.js';
import type { RelationDirection } from '../../components/relation-tabs.js';
import { Button, GlyphChip } from '../../components/ui/primitives.js';
import { LABEL_FONT_SIZE, LABEL_MIN_ZOOMED, declutterLabels, runLayout } from './layout.js';

cytoscape.use(fcose);

export interface GraphNode {
  id: string;
  key: string;
  title: string;
  type: string;
  parent_id: string | null;
  doc_status: string | null;
  archived_at?: string | null;
}
export interface GraphEdge {
  from_id: string;
  to_id: string;
  kind: string;
}

export interface SpecGraphProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /**
   * 중심 문서 — 있으면 자기중심 모드다. **주소가 진실이다**(2026-09-24 · SPEC-07 · REQ-WEB-211):
   * 목록이 `?focus=` 로 들고 있고, 바꾸는 것은 `onFocusChange` 가 주소에 적는다. 컴포넌트 state 로
   * 두었더니 상세에 들어갔다 돌아오면 중심이 사라졌고, 상세에서 "이 문서 주변" 으로 올 길도 없었다.
   */
  focusKey?: string | undefined;
  /** 중심을 바꾼다 — 전역 보기로 돌아가면 `null` */
  onFocusChange: (key: string | null) => void;
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
 * 범례가 색을 늘어놓는 순서이자, **범례에 없는 색이 화면에 뜨지 않는다**는 보증이다.
 * `TYPE_COLOR` 의 키 순서를 그대로 쓴다 — 순서를 따로 적어 두면 종류를 하나 더할 때
 * 한쪽만 고쳐지고, 그날 화면에는 있는데 범례에는 없는 색이 생긴다.
 */
const TYPE_ORDER = Object.keys(TYPE_COLOR);

/** 종류 → 색 토큰. 캔버스와 범례가 **같은 한 곳**에서 읽는다(hex 를 베껴 적으면 조용히 갈라진다) */
function typeColorToken(type: string): string {
  return TYPE_COLOR[type] ?? '--color-text-mute';
}

/** 범례·패널의 색 점 — CSS 는 토큰을 그대로 읽는다(canvas 와 달리 `var()` 를 이해한다) */
function typeColorVar(type: string): string {
  return `var(${typeColorToken(type)})`;
}

/**
 * 노드 지름 — **지금 그려진 것 중** 이 문서를 가리키는 문서 수로 정한다(차수 기반 크기).
 *
 * **상한이 있다.** clemvion 최다 피참조는 52건이라(실측) 상한이 없으면 그 하나가 지름
 * 100px 을 넘고 옆의 문서들은 점이 된다. 16건부터는 전부 같은 크기다 — 그래서 범례가
 * "많을수록 큼" 까지만 말하고 안내가 "한 크기에서 멈춘다" 를 덧붙인다. 말하지 않으면
 * 같은 크기의 둘을 **같은 값**으로 읽는다.
 */
export function nodeSize(indegree: number): number {
  return 18 + Math.min(26, indegree * 1.6);
}

/**
 * 범례가 말해야 하는 것 — **그려진 것만**이다.
 *
 * 영역(`area`)은 자식이 함께 그려지면 동그라미가 아니라 **옅은 상자**로 선다(compound
 * 부모). 그때 범례가 "영역 = 보라" 라고 적으면 화면에 없는 색을 가리키는 것이고,
 * **틀린 범례는 없는 범례보다 나쁘다** — 틀린 것은 확신을 준다. 상자로 선 종류는 색
 * 목록에서 빼고 상자 표식을 따로 세운다.
 *
 * 중심 모드에서 범례가 저절로 짧아지는 것도 같은 규칙의 결과다.
 */
export function legendFor(
  nodes: readonly GraphNode[],
  visible: ReadonlySet<string>,
  grouped: boolean,
): { types: string[]; areaBox: boolean } {
  const shown = nodes.filter((n) => visible.has(n.id));
  const boxes = new Set(
    grouped
      ? shown.map((n) => n.parent_id).filter((id): id is string => id !== null && visible.has(id))
      : [],
  );
  const drawn = new Set(shown.filter((n) => !boxes.has(n.id)).map((n) => n.type));
  return { types: TYPE_ORDER.filter((type) => drawn.has(type)), areaBox: boxes.size > 0 };
}

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

/**
 * 영역 상자 위에서 시작한 드래그도 **화면을 옮긴다**(2026-08-27 — 사람 보고).
 *
 * cytoscape 는 노드 위의 드래그를 "그 노드를 잡는 일"로 본다. 이 그래프는 읽기 전용이라
 * 아무 노드도 잡히지 않으므로(`autoungrabify`) 영역 안에서 끌면 **아무 일도 일어나지 않고**
 * 손을 뗄 때 그 영역만 골라졌다. 그런데 영역으로 묶으면 상자가 화면의 대부분을 덮는다 —
 * 끌 수 있는 바탕이 상자 사이의 틈뿐이어서, 사람은 "이 그래프는 안 움직인다"고 읽는다.
 *
 * 영역 상자는 노드가 아니라 **배경**이다. `panify()` 가 그 위의 드래그를 패닝으로 넘긴다
 * (누르기는 그대로 — 클릭 한 번은 여전히 그 영역 문서를 고른다).
 */
export function letAreasPan(cy: cytoscape.Core): void {
  cy.nodes(':parent').panify();
}

export function SpecGraph({
  nodes,
  edges,
  focusKey,
  onFocusChange,
  onOpen,
}: SpecGraphProps): React.JSX.Element {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const focus = focusKey ?? null;
  // [중심] 단추가 돌아갈 곳 — 전역으로 나갔다가 방금 보던 중심으로 되돌아오게 기억한다
  const [lastFocus, setLastFocus] = useState<string | null>(focusKey ?? null);
  const setFocus = (key: string | null): void => {
    if (key !== null) setLastFocus(key);
    onFocusChange(key);
  };
  // 주소가 중심을 바꿨으면(뒤로가기 · 상세의 [그래프에서 보기]) 되돌아올 곳도 그것이다
  useEffect(() => {
    if (focusKey !== undefined) setLastFocus(focusKey);
  }, [focusKey]);
  const [hops, setHops] = useState(1);
  const [grouped, setGrouped] = useState(true);
  /** 고른 문서의 key — 이동이 아니라 **선택**이다 */
  const [selected, setSelected] = useState<string | null>(null);
  // 패널의 방향 탭 — 레일(§2.4)과 같은 컴포넌트·같은 어휘를 쓴다
  const [relTab, setRelTab] = useState<RelationDirection>('all');
  // 조작 안내 — 캔버스 위 물음표 뒤에 접어 둔다(늘 켜 두면 한 번 읽고 끝인 것이 매번 자리를 먹는다)
  const [helpOpen, setHelpOpen] = useState(false);
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

  /** 범례는 **그림에서 나온다** — 손으로 적은 목록이면 화면과 갈라지는 날이 온다 */
  const legend = useMemo(() => legendFor(nodes, visible, grouped), [grouped, nodes, visible]);

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
            weight: nodeSize(degree.get(n.id) ?? 0),
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
              cssVar(typeColorToken(String(n.data('type')))),
            label: 'data(label)',
            // 글자 크기와 그리기 시작하는 배율의 정본은 `layout.ts` 다 — 배치가 "이름이
            // 그려진다" 를 판정할 때 같은 값을 봐야 한다(두 벌이면 한쪽만 바뀐다)
            'font-size': LABEL_FONT_SIZE,
            color: cssVar('--color-text-mute'),
            'text-valign': 'bottom',
            'text-margin-y': 3,
            // 라벨이 겹치면 아무것도 못 읽는다 — 잘라서 보여주고 전문은 클릭으로
            'text-max-width': '90px',
            'text-wrap': 'ellipsis',
            // **읽을 수 없는 크기면 그리지 않는다.** 전체 보기의 기본 배율은 0.42 라
            // 9px 라벨이 화면에는 3.8px 로 찍힌다(실측 2026-08-27 · 노드 125개). 그건
            // 글자가 아니라 얼룩이고, 얼룩 125개가 그림을 덮으면 구조가 안 보인다.
            // 가까이 가면(배율 0.89 이상) 이름이 돌아온다.
            'min-zoomed-font-size': LABEL_MIN_ZOOMED,
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
            // 영역 이름은 **지도의 지명**이다 — 문서 라벨을 감춘 배율에서도 남는다.
            // 열여섯 개뿐이라 얼룩이 되지 않고, 이것까지 지우면 어디를 보는지 알 수 없다.
            'min-zoomed-font-size': 0,
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
        // **가려서 못 읽는 것도 못 읽는 것이다**(2026-09-22 · REQ-WEB-095 개정). 겹친 이름
        // 중 자리를 잃은 쪽을 지운다 — 판정은 화면 좌표로 `declutterLabels` 가 한다.
        // 고른 문서는 언제나 이기므로 `.picked` 와 다툴 일이 없다.
        {
          selector: 'node.crowded',
          style: { 'text-opacity': 0 },
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
      // **끄는 것은 배치이지 재배치가 아니다**(2026-08-27 — 사람 지시). 노드를 끌면 그림 위의
      // 자리만 바뀐다: 부모도 정렬 키도 서버로 가지 않는다. 문서를 옮기는 경로는 여전히
      // 트리 하나뿐이고, 그래프는 데이터를 쓰지 않는다는 뜻에서 읽기 전용이다.
      // (`autoungrabify` 를 걷었다 — 영역 상자는 `panify()` 가 잡기를 끄므로 그대로 패닝이다.)
      wheelSensitivity: 0.2,
    });

    letAreasPan(cy);
    // 다시 세야 하는 때는 둘이다 — **노드를 끌었을 때**(자리가 바뀐다)와 **배율이 이름이
    // 나타나는 문턱을 넘나들 때**. 배율 자체는 답을 바꾸지 않는다: 이름도 그림과 함께
    // 커지므로 누가 누구를 가리는지는 그대로다(패닝도 같은 이유로 그대로다).
    // 끌기는 프레임마다 이벤트를 내므로 한 프레임에 한 번으로 접는다.
    let frame = 0;
    const relabel = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (cyRef.current !== null) declutterLabels(cy);
      });
    };
    cy.on('zoom', relabel);
    cy.on('position', 'node', relabel);
    // 배치는 여기서 시작한다 — 생성자에 맡기지 않는 이유는 fcose 가 낸 답을 **정리해서**
    // 써야 하기 때문이다(형제 영역 겹침 제거·다지기 · layout.ts)
    runLayout(cy);

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
      if (frame !== 0) cancelAnimationFrame(frame);
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
    // 가라앉은 것은 자리를 다투지 않는다 — 하나를 고르면 그 이웃의 이름이 되살아난다
    declutterLabels(cy);
    cy.resize();
    ensureVisible(cy, selected);
  }, [selected]);

  // 다른 문서를 고르면 방향 탭도 처음으로 돌린다 — 역참조가 없는 문서를 골랐는데
  // 역참조 탭이 남아 있으면 빈 패널이 열리고, 사람은 그것을 "관계가 없다"로 읽는다
  useEffect(() => setRelTab('all'), [selected]);

  /**
   * 배치를 다시 계산한다 — **그림만 다시 그린다.**
   *
   * 컴포넌트를 다시 그리지 않는 이유는 고른 문서·중심 모드·패널이 그대로 남아야 하기
   * 때문이다. 강조 클래스는 노드에 붙어 있으므로 자리가 바뀌어도 따라간다.
   */
  const relayout = (): void => {
    const cy = cyRef.current;
    if (cy !== null) runLayout(cy);
  };

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
    /* 스크롤이 아니라 확대/축소로 보는 그림이다 — 그래서 높이는 **화면이 정한다**.
       70vh 로 못 박으면 머리 아래 남는 세로가 그림에 쓰이지 않는다(실측 2026-08-27
       1440×900: 캔버스 611px → 650px). 남는 만큼 캔버스가 가져가고, 좁은 창에서는
       최소 높이가 그림을 지킨다. 패널은 캔버스와 같은 높이로 늘어난다(stretch).

       **조종기·건수·안내는 캔버스 위에 얹는다**(2026-08-27 — 사람 지시). 셋 다 캔버스에만
       작용하는데 페이지 행으로 두면 영구히 세로를 먹고(실측: 조종기 35px + 안내 23px),
       트리·표 탭에서는 아무 일도 안 하면서 자리만 지켰다. 지도 도구는 지도 위에 있다. */
    <div className="flex min-h-0 flex-1 gap-2">
      <div className="relative min-h-95 min-w-0 flex-1">
        <div
          ref={container}
          data-testid="spec-graph"
          className="h-full w-full rounded-nerv border border-border bg-bg-elev"
        />
        {/* 겹쳐 둔 것이 캔버스의 제스처를 삼키지 않게 — 칩에만 포인터를 준다 */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-start">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-nerv border border-border bg-bg-elev/90 px-2 py-1.5 text-xs shadow-popover backdrop-blur-sm">
            <Button
              size="sm"
              variant={focus === null ? 'primary' : 'default'}
              onClick={() => setFocus(null)}
            >
              {t('graph.mode.global')}
            </Button>
            {lastFocus !== null && (
              <Button
                size="sm"
                variant={focus !== null ? 'primary' : 'default'}
                onClick={() => setFocus(lastFocus)}
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
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)}
              />
              {t('graph.group_by_area')}
            </label>
            {/* 손으로 끌어 놓은 자리를 되돌리는 길이자, 밀집한 자리를 한 번 더 굴려 보는 길 */}
            <Button size="sm" data-testid="graph-relayout" onClick={relayout}>
              {t('graph.relayout')}
            </Button>
            <span aria-hidden="true" className="h-4 w-px bg-border" />
            {/* 안내는 **한 번 읽으면 끝인 것**이라 늘 켜 두지 않는다 — 물음표 뒤로 접고,
                더 알고 싶은 사람은 매뉴얼로 간다 */}
            <button
              type="button"
              data-testid="graph-help"
              aria-expanded={helpOpen}
              aria-label={t('graph.help')}
              onClick={() => setHelpOpen((open) => !open)}
              className={cn(
                'flex size-5 items-center justify-center rounded-full border border-border text-2xs text-text-mute',
                helpOpen ? 'bg-bg-active text-text' : 'hover:bg-bg-hover hover:text-text',
              )}
            >
              ?
            </button>
          </div>
        </div>
        {helpOpen && (
          <div
            data-testid="graph-help-panel"
            className="absolute top-14 left-2 z-10 max-w-105 rounded-nerv border border-border bg-bg-elev px-3 py-2.5 text-xs leading-[1.6] text-text-mute shadow-popover"
          >
            {/* **읽는 법이 먼저다.** 조작은 만져 보면 알게 되지만 색과 크기는 그림에서
                읽어 낼 수 없다 — 범례가 한 줄로 말하는 것을 여기서 끝까지 적는다(크기에
                상한이 있다는 것 · 중심 모드는 그려진 것만 센다는 것). 범례에 넣기에는
                긴 단서이고, 넣으면 범례가 안내가 된다. */}
            <p className="mb-0.5 font-semibold text-text">{t('graph.hint.read_label')}</p>
            <p>{t('graph.hint.read')}</p>
            <p className="mt-2 mb-0.5 font-semibold text-text">{t('graph.hint.act_label')}</p>
            <p>{t('graph.hint')}</p>
            <Link
              to="/help/$chapter"
              params={{ chapter: 'specs' }}
              className="mt-1.5 block text-link hover:underline"
            >
              {t('graph.help_more')}
            </Link>
          </div>
        )}
        <GraphLegend types={legend.types} areaBox={legend.areaBox} />
        {/* 건수는 지도의 축척 표기처럼 **아래 모서리**에 — 조종기와 눈이 부딪히지 않는다 */}
        <span className="pointer-events-none absolute right-2 bottom-2 rounded-nerv-sm bg-bg-elev/80 px-1.5 py-0.5 text-2xs text-text-faint">
          {t('graph.counts', { nodes: shownCount, edges: edges.length })}
        </span>
      </div>
      {selectedNode !== undefined && (
        <aside
          data-testid="graph-panel"
          className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-nerv border border-border bg-bg-elev"
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
            {/* 캔버스에서 본 그 색이다. 범례가 표라면 이 줄은 **대조**다 — 색 하나를
                범례에서 되짚는 대신 고른 것에 이름이 붙는다(REQ-WEB-033: 색만으로
                구분하지 않는다) */}
            <p className="mt-0.5 flex items-center gap-1.5 text-2xs text-text-faint">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: typeColorVar(selectedNode.type) }}
              />
              <span className="shrink-0">
                {t(`specs.type.${selectedNode.type}` as 'specs.type.feature')}
              </span>
              <span className="truncate font-mono">{selectedNode.key}</span>
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
            <p className="mt-auto border-t border-border px-3 py-2 text-xs text-text-faint">
              {t('graph.panel.hint')}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * 범례 — 지도의 **열쇠**다.
 *
 * **조작 안내와 달리 접지 않는다.** 물음표 뒤로 접은 것은 "한 번 읽으면 끝" 인 제스처이고,
 * 색과 크기는 그림을 읽는 **내내 대조하는 것**이다. 접어 두면 화면을 훑는 동안 물음표를
 * 여닫게 되고, 그건 안내가 아니라 방해다.
 *
 * 자리값은 공짜다 — 캔버스 **위에** 얹으므로 페이지 세로를 한 줄도 먹지 않고(REQ-WEB-097),
 * 건수 표기와 마주 보는 왼쪽 아래 모서리는 배치가 거의 쓰지 않는 자리다. 폭도 스스로
 * 줄어든다: 그려진 종류만 적으므로 중심 모드에서는 저절로 짧아진다.
 *
 * 포인터를 받지 않는다 — 캔버스의 끌기·확대 제스처를 삼키면 지도 위의 표가 지도를 막는다.
 */
function GraphLegend({
  types,
  areaBox,
}: {
  types: readonly string[];
  areaBox: boolean;
}): React.JSX.Element | null {
  const t = useT();
  // 그릴 것이 없으면 범례도 없다 — 빈 상자는 "여기 뭔가 있었다" 로 읽힌다
  if (types.length === 0 && !areaBox) return null;
  return (
    <div
      data-testid="graph-legend"
      className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-9rem)] flex-wrap items-center gap-x-2.5 gap-y-1 rounded-nerv border border-border bg-bg-elev/80 px-2 py-1 text-2xs text-text-mute backdrop-blur-sm"
    >
      {types.map((type) => (
        <span key={type} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: typeColorVar(type) }}
          />
          {t(`specs.type.${type}` as 'specs.type.feature')}
        </span>
      ))}
      {areaBox && (
        <span className="flex items-center gap-1">
          {/* 영역은 동그라미가 아니라 상자로 선다 — 표식도 상자여야 한다 */}
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-xs border border-border-strong bg-bg-sunken"
          />
          {t('specs.type.area')}
        </span>
      )}
      {/* 좁은 폭에서는 범례가 줄바꿈되고, 그때 이 선은 줄 끝에 홀로 남아 뜻을 잃는다 */}
      <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />
      <span className="flex items-center gap-1">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-text-mute" />
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-text-mute" />
        {t('graph.legend.size')}
      </span>
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
      className="flex w-full items-start gap-2 rounded-nerv px-1.5 py-1.5 text-left transition-colors hover:bg-bg-hover"
    >
      {/* 방향 표식은 레일과 같다 — 들어오는 것은 조용히, 나가는 것은 물들여서 */}
      <GlyphChip
        className={cn(
          'mt-px',
          incoming === true
            ? 'bg-bg-sunken text-text-mute'
            : 'bg-status-action-soft text-status-action',
        )}
      >
        {incoming === true ? '↓' : '↑'}
      </GlyphChip>
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
