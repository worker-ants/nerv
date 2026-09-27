// 관계 그래프의 배치 — 정본: docs/04-mvp/screens.md §2.4a
//
// **여기서 지키는 것은 셋이다.**
//   ① 형제는 겹치지 않는다(REQ-WEB-174) — 겹친 상자는 데이터에 없는 계층으로 읽힌다
//   ② 같은 입력 · 같은 번호면 같은 자리다(REQ-WEB-245) — 입력의 순서와도 무관하다
//   ③ **데이터가 조금 바뀌면 형태도 조금만 바뀐다**(REQ-WEB-247) — 문서 주위에 어떤 문서가 어느
//      방향에 있는가. 배치를 저장하지 않으므로 문서가 늘거나 줄면 다시 계산하는데, 예전(fcose)에는
//      문서 하나만 늘어도 이웃의 방향이 평균 86° 바뀌었다(2026-09-27 사람 보고 · 실측)

import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import {
  LABEL_ZOOM,
  PICKED_FONT_SIZE,
  TARGET_ASPECT,
  crowdedLabels,
  extent,
  hash01,
  labelReadable,
  labelZoomState,
  leafPositions,
  runLayout,
  separate,
  settle,
  spread,
  type LabelBox,
  type LayoutTree,
  type PackItem,
  type SpreadItem,
} from './layout.js';

/** 테스트 데이터용 난수(mulberry32) — 같은 번호면 같은 수열이다 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (id: string, cx: number, cy: number, w = 40): SpreadItem => ({
  id,
  cx,
  cy,
  w,
  h: w,
  round: true,
});
const rect = (id: string, cx: number, cy: number, w = 40, h = 40): SpreadItem => ({
  id,
  cx,
  cy,
  w,
  h,
  round: false,
});

/** 두 상자가 겹친 넓이 — 0 이면 떨어져 있다 */
function overlap(a: PackItem, b: PackItem): number {
  const ox = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx);
  const oy = (a.h + b.h) / 2 - Math.abs(a.cy - b.cy);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

const angleOf = (a: PackItem, b: PackItem): number => Math.atan2(b.cy - a.cy, b.cx - a.cx);

describe('밀어내기 — 두 중심을 잇는 선을 따라', () => {
  it('겹친 둘은 방향을 그대로 둔 채 물러난다', () => {
    const items = [round('a', 0, 0), round('b', 18, 24)];
    const before = angleOf(items[0] as PackItem, items[1] as PackItem);
    spread(items, 0, 100);
    const [a, b] = items as [SpreadItem, SpreadItem];
    expect(angleOf(a, b)).toBeCloseTo(before, 9);
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeCloseTo(40, 6);
  });

  it('간격만큼 더 벌린다 — 맞닿은 동그라미는 여전히 한 덩어리로 읽힌다', () => {
    const items = [round('a', 0, 0), round('b', 30, 0)];
    spread(items, 16, 100);
    expect(Math.abs((items[1]?.cx ?? 0) - (items[0]?.cx ?? 0))).toBeCloseTo(56, 6);
  });

  it('네모는 상자로 잰다 — 가로로 나란하면 폭만큼만 떨어진다', () => {
    const items = [rect('a', 0, 0, 80, 20), rect('b', 30, 0, 80, 20)];
    spread(items, 12, 100);
    expect(Math.abs((items[1]?.cx ?? 0) - (items[0]?.cx ?? 0))).toBeCloseTo(92, 6);
    expect(items[0]?.cy).toBeCloseTo(0, 9);
  });

  it('겹치지 않으면 0 을 돌려주고 자리를 건드리지 않는다', () => {
    const items = [round('a', 0, 0), round('b', 200, 0)];
    expect(spread(items, 12, 100)).toBe(0);
    expect(items[0]?.cx).toBe(0);
    expect(items[1]?.cx).toBe(200);
  });

  it('중심이 정확히 같아도 갈라진다 — 방향은 두 id 로 정한다(같은 입력이면 같은 답)', () => {
    const one = [round('a', 0, 0), round('b', 0, 0)];
    const two = [round('a', 0, 0), round('b', 0, 0)];
    spread(one, 8, 200);
    spread(two, 8, 200);
    const [a, b] = one as [SpreadItem, SpreadItem];
    expect(Math.hypot(b.cx - a.cx, b.cy - a.cy)).toBeCloseTo(48, 6);
    expect(one).toEqual(two);
  });

  it('0 을 돌려주면 정말로 겹친 쌍이 없다', () => {
    const next = random(7);
    const items = Array.from({ length: 120 }, (_, i) =>
      rect(`r${i}`, next() * 600, next() * 400, 20 + next() * 60, 20 + next() * 40),
    );
    expect(spread(items, 12, 2000)).toBe(0);
    for (const [i, a] of items.entries())
      for (const b of items.slice(i + 1)) {
        const ox = (a.w + b.w) / 2 + 12 - Math.abs(a.cx - b.cx);
        const oy = (a.h + b.h) / 2 + 12 - Math.abs(a.cy - b.cy);
        // 1e-6px 보다 얕은 겹침은 없는 것으로 본다(부동소수점 찌꺼기)
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });
});

describe('무리 정리 — 고른 비율로 넓힌 뒤 민다', () => {
  it('겹칠 일이 없으면 모든 쌍의 방향이 그대로다 — 후보를 골라 모양을 바꾸지 않는다', () => {
    const items = [
      round('a', 0, 0, 10),
      round('b', 300, 40, 10),
      round('c', -120, 260, 10),
      round('d', 90, -310, 10),
    ];
    const before = items.flatMap((a) => items.map((b) => (a === b ? 0 : angleOf(a, b))));
    settle(items, 16, 0.05);
    const after = items.flatMap((a) => items.map((b) => (a === b ? 0 : angleOf(a, b))));
    after.forEach((angle, i) => expect(angle).toBeCloseTo(before[i] ?? NaN, 9));
  });

  it('촘촘한 무리는 넓혀서 푼다 — 겹침이 남지 않는다', () => {
    const next = random(3);
    const items = Array.from({ length: 60 }, (_, i) =>
      round(`d${i}`, next() * 80, next() * 80, 18 + next() * 26),
    );
    settle(items, 16, 0.3);
    for (const [i, a] of items.entries())
      for (const b of items.slice(i + 1))
        expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan((a.w + b.w) / 2 + 16 - 1e-6);
  });

  it('모양을 겨냥하면 그쪽으로 기운다 — 좌우·위아래 순서는 그대로다', () => {
    const tall = (): SpreadItem[] =>
      Array.from({ length: 12 }, (_, i) => rect(`t${i}`, (i % 3) * 200, i * 150, 40, 40));
    const free = tall();
    settle(free, 12, 0.05);
    const wide = tall();
    settle(wide, 12, 0.05, TARGET_ASPECT);
    const ratio = (items: readonly PackItem[]): number => {
      const bb = extent(items);
      return bb.w / bb.h;
    };
    expect(ratio(wide)).toBeGreaterThan(ratio(free));
    for (const [i, a] of wide.entries())
      for (const [j, b] of wide.entries()) {
        const fa = free[i] as PackItem;
        const fb = free[j] as PackItem;
        expect(Math.sign(a.cx - b.cx)).toBe(Math.sign(fa.cx - fb.cx));
        expect(Math.sign(a.cy - b.cy)).toBe(Math.sign(fa.cy - fb.cy));
      }
  });

  it('하나뿐이면 아무것도 하지 않는다', () => {
    const items = [round('a', 17, 42)];
    settle(items, 10, 0.3, TARGET_ASPECT);
    expect(items[0]).toEqual(round('a', 17, 42));
  });
});

describe('감싸는 상자', () => {
  it('빈 목록은 0 짜리 상자다 — Infinity 를 밖으로 내보내지 않는다', () => {
    expect(extent([])).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0, cx: 0, cy: 0 });
  });
});

/**
 * 그래프 위에서의 검사 — **형제 영역이 서로의 자리를 침범하지 않는가**.
 *
 * compound 상자는 헤드리스에서 다시 계산되지 않으므로(렌더러가 없다) 상자 대신 **자식들의
 * 자리**로 잰다. 어차피 화면의 상자도 그 자리를 감싼 자국이라, 자식이 겹치지 않으면 상자도
 * 겹치지 않는다.
 */
function childrenExtent(parent: cytoscape.NodeSingular): PackItem {
  const kids = parent.children().map((kid) => {
    const at = kid.position();
    const bb = kid.boundingBox({ includeLabels: false });
    return { cx: at.x, cy: at.y, w: bb.w, h: bb.h };
  });
  const bb = extent(kids);
  return { cx: bb.cx, cy: bb.cy, w: bb.w, h: bb.h };
}

describe('영역 상자는 형제끼리 겹치지 않는다 (2026-09-22 · 사람 보고)', () => {
  /** 두 영역의 자식이 서로 엇갈려 앉은 배치 — 관계로 다듬은 그림이 실제로 내놓는 모양이다 */
  const interleaved = (): cytoscape.Core =>
    cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        { data: { id: 'p' } },
        { data: { id: 'q' } },
        { data: { id: 'a', parent: 'p' }, position: { x: 0, y: 0 } },
        { data: { id: 'b', parent: 'p' }, position: { x: 200, y: 0 } },
        { data: { id: 'c', parent: 'q' }, position: { x: 100, y: 20 } },
        { data: { id: 'd', parent: 'q' }, position: { x: 300, y: 20 } },
        { data: { id: 'loose' }, position: { x: 150, y: 10 } },
      ],
      style: [{ selector: 'node', style: { width: 20, height: 20 } }],
    });

  it('엇갈려 앉은 두 영역을 갈라놓는다', () => {
    const cy = interleaved();
    expect(overlap(childrenExtent(cy.$id('p')), childrenExtent(cy.$id('q')))).toBeGreaterThan(0);
    separate(cy);
    expect(overlap(childrenExtent(cy.$id('p')), childrenExtent(cy.$id('q')))).toBe(0);
    cy.destroy();
  });

  it('영역에 들지 않은 문서도 남의 상자 안에 앉지 않는다', () => {
    const cy = interleaved();
    separate(cy);
    const loose = cy.$id('loose');
    const at = loose.position();
    const bb = loose.boundingBox({ includeLabels: false });
    const alone = { cx: at.x, cy: at.y, w: bb.w, h: bb.h };
    expect(overlap(alone, childrenExtent(cy.$id('p')))).toBe(0);
    expect(overlap(alone, childrenExtent(cy.$id('q')))).toBe(0);
    cy.destroy();
  });

  it('영역 안의 문서끼리도 겹치지 않는다', () => {
    const cy = interleaved();
    separate(cy);
    const inside = cy.$id('p').children();
    const [a, b] = [inside[0], inside[1]] as [cytoscape.NodeSingular, cytoscape.NodeSingular];
    const gap = Math.hypot(a.position().x - b.position().x, a.position().y - b.position().y);
    expect(gap).toBeGreaterThanOrEqual(20);
    cy.destroy();
  });

  it('영역으로 묶지 않아도 겹치지 않는다 — 겹친 노드는 읽을 수 없다', () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        { data: { id: 'a' }, position: { x: 0, y: 0 } },
        { data: { id: 'b' }, position: { x: 4, y: 3 } },
        { data: { id: 'c' }, position: { x: 900, y: 900 } },
      ],
      style: [{ selector: 'node', style: { width: 20, height: 20 } }],
    });
    separate(cy);
    const at = cy.nodes().map((n) => n.position());
    for (const [i, p] of at.entries())
      for (const q of at.slice(i + 1)) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(20);
    cy.destroy();
  });
});

describe('겹치는 이름 (2026-09-22 · 사람 보고)', () => {
  // **가려서 못 읽는 것도 못 읽는 것이다.** 겹친 이름 중 하나는 지워야 하고, 남는 쪽은
  // 매번 같아야 한다 — 누를 때마다 다른 이름이 사라지면 그림을 읽는 일이 어지러워진다.
  const at = (id: string, rank: number, x: number, y: number, w = 90, h = 12): LabelBox => ({
    id,
    rank,
    x1: x - w / 2,
    x2: x + w / 2,
    y1: y - h / 2,
    y2: y + h / 2,
  });

  it('떨어져 있으면 아무것도 가리지 않는다', () => {
    expect(crowdedLabels([at('a', 1, 0, 0), at('b', 1, 200, 0)]).size).toBe(0);
  });

  it('겹치면 피참조가 많은 쪽이 남는다 — 허브의 이름이 먼저다', () => {
    const hidden = crowdedLabels([at('작다', 18, 0, 0), at('허브', 40, 40, 0)]);
    expect([...hidden]).toEqual(['작다']);
  });

  it('같은 무게면 id 로 가른다 — 같은 그림에서 같은 이름이 남는다', () => {
    const first = crowdedLabels([at('b', 20, 0, 0), at('a', 20, 40, 0)]);
    const again = crowdedLabels([at('a', 20, 40, 0), at('b', 20, 0, 0)]);
    expect([...first]).toEqual(['b']);
    expect([...again]).toEqual([...first]);
  });

  it('자리를 차지한 이름만 다음 것을 막는다 — 가려진 것 뒤에는 자리가 남는다', () => {
    // a 가 b 를 가린다. c 는 b 와만 겹치므로 — b 는 이미 없으므로 — 그려져야 한다.
    const hidden = crowdedLabels([at('a', 30, 0, 0), at('b', 20, 60, 0), at('c', 10, 120, 0)]);
    expect([...hidden]).toEqual(['b']);
  });

  it('세로로만 어긋나도 겹치면 가린다 — 이름은 노드 아래 한 줄이다', () => {
    expect(crowdedLabels([at('a', 2, 0, 0), at('b', 1, 0, 6)]).size).toBe(1);
  });
});

describe('이름이 그려지는 배율', () => {
  it('배율 0.5 다 — 스타일과 배치가 같은 값을 쓴다 (2026-09-27 · 사람 결정)', () => {
    // 이 수가 배치의 판정("이름의 자리를 잡아 둘까")과 화면의 판정("이름을 그릴까")을
    // 한 곳에서 잇는다. 두 벌로 적으면 한쪽만 바뀌는 날 둘이 어긋난다.
    expect(LABEL_ZOOM).toBe(0.5);
  });
});

describe('읽히는 크기 (2026-09-27 · REQ-WEB-095)', () => {
  // cytoscape 의 `min-zoomed-font-size` 는 픽셀 비율을 곱하고 2 의 거듭제곱으로 올려 판정해서,
  // Retina 에서는 배율 0.25 만 넘어도 이름을 그렸다. 판정은 화면 종류와 무관한 배율 하나로 한다.
  it('9px 이름은 배율 0.5 부터, 고른 문서(11px)는 그보다 낮은 배율부터 그린다', () => {
    expect(labelReadable(0.49)).toBe(false);
    expect(labelReadable(0.5)).toBe(true);
    expect(labelReadable(0.3)).toBe(false);
    expect(labelReadable(0.41, PICKED_FONT_SIZE)).toBe(true);
    expect(labelReadable(0.4, PICKED_FONT_SIZE)).toBe(false);
  });

  it('배율은 문턱을 넘나들 때만 답을 바꾼다 — 확대하는 동안 매 장면 다시 세지 않는다', () => {
    expect(labelZoomState(0.2)).toBe(labelZoomState(0.35));
    expect(labelZoomState(0.35)).not.toBe(labelZoomState(0.45));
    expect(labelZoomState(0.45)).not.toBe(labelZoomState(0.6));
    expect(labelZoomState(0.6)).toBe(labelZoomState(3));
  });
});

// ── 합성 그래프 — 243 문서 · 3,036 관계(사람이 보고한 프로젝트의 규모) ─────────────────

interface Doc {
  id: string;
  parent: string | null;
}
interface Link {
  from: string;
  to: string;
}
interface Graph {
  docs: Doc[];
  links: Link[];
}

/** 영역 12(하나는 안쪽 영역) · 문서 · 관계 — 35% 는 같은 영역 안, 나머지는 피참조가 많은 쪽으로 */
function synthetic(docCount: number, linkCount: number, seed: number): Graph {
  const next = random(seed);
  const areas: Doc[] = Array.from({ length: 12 }, (_, i) => ({
    id: `area-${String(i).padStart(2, '0')}`,
    parent: i === 11 ? 'area-00' : null,
  }));
  const docs: Doc[] = [];
  for (let i = 0; docs.length < docCount - areas.length; i += 1) {
    // 영역마다 크기가 다르다 — 앞의 영역일수록 크다
    const pick = Math.min(11, Math.floor(Math.pow(next(), 1.6) * 12));
    docs.push({
      id: `doc-${String(i).padStart(4, '0')}`,
      parent: `area-${String(pick).padStart(2, '0')}`,
    });
  }
  const all = [...areas, ...docs];
  return { docs: all, links: linksFor(all, docs, linkCount, next) };
}

function linksFor(all: Doc[], docs: Doc[], count: number, next: () => number): Link[] {
  const seen = new Set<string>();
  const links: Link[] = [];
  const indegree = new Map<string, number>();
  for (let guard = 0; links.length < count && guard < count * 20; guard += 1) {
    const from = docs[Math.floor(next() * docs.length)] as Doc;
    const sameArea = next() < 0.35;
    const pool = sameArea ? docs.filter((d) => d.parent === from.parent) : all;
    // 피참조가 많을수록 또 참조된다(허브가 생긴다)
    let to = pool[Math.floor(next() * pool.length)] as Doc;
    const other = pool[Math.floor(next() * pool.length)] as Doc;
    if ((indegree.get(other.id) ?? 0) > (indegree.get(to.id) ?? 0)) to = other;
    const key = `${from.id}>${to.id}`;
    if (from.id === to.id || seen.has(key)) continue;
    seen.add(key);
    indegree.set(to.id, (indegree.get(to.id) ?? 0) + 1);
    links.push({ from: from.id, to: to.id });
  }
  return links;
}

/** 문서 몇 개를 더한다 — 새 문서마다 관계 12개 */
function grow(graph: Graph, count: number, seed: number): Graph {
  const next = random(seed);
  const areas = graph.docs.filter((d) => d.id.startsWith('area-'));
  const added: Doc[] = Array.from({ length: count }, (_, i) => ({
    id: `new-${seed}-${i}`,
    parent: (areas[Math.floor(next() * areas.length)] as Doc).id,
  }));
  const docs = [...graph.docs, ...added];
  const links = [...graph.links];
  for (const doc of added) {
    for (const link of linksFor(docs, [doc], 12, next)) links.push(link);
  }
  return { docs, links };
}

/** 같은 입력 — 그리는 쪽처럼 크기를 피참조 수로 정하고, `grouped` 면 영역을 compound 로 만든다 */
function draw(graph: Graph, grouped = true, reverse = false): cytoscape.Core {
  const indegree = new Map<string, number>();
  for (const link of graph.links) indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
  let nodes = graph.docs.map((d) => ({
    data: {
      id: d.id,
      weight: 18 + Math.min(26, (indegree.get(d.id) ?? 0) * 1.6),
      ...(grouped && d.parent !== null ? { parent: d.parent } : {}),
    },
  }));
  let edges = graph.links.map((l, i) => ({ data: { id: `e${i}`, source: l.from, target: l.to } }));
  if (reverse) {
    nodes = [...nodes].reverse();
    edges = [...edges].reverse();
  }
  return cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [...nodes, ...edges],
    style: [{ selector: 'node', style: { width: 'data(weight)', height: 'data(weight)' } }],
  });
}

const treeOf = (graph: Graph): LayoutTree => new Map(graph.docs.map((d) => [d.id, d.parent]));

function layout(
  graph: Graph,
  seed = 1,
  grouped = true,
  reverse = false,
): Map<string, cytoscape.Position> {
  const cy = draw(graph, grouped, reverse);
  let done: Map<string, cytoscape.Position> | null = null;
  runLayout(
    cy,
    seed,
    (positions) => {
      done = positions;
    },
    treeOf(graph),
  );
  cy.destroy();
  // 배치는 **같은 턴에** 끝난다 — 그리는 쪽은 그 자리를 곧바로 적어 둔다
  expect(done).not.toBeNull();
  return done as unknown as Map<string, cytoscape.Position>;
}

/**
 * 형태 유지율 — 각 문서의 가까운 이웃 5개 가운데, 바뀐 그림에서도 가까운 이웃 10개 안에 있고
 * 방향이 ±45° 안인 것의 비율(둘 다에 있는 문서만 센다). 그림 전체의 이동·확대는 값을 바꾸지 않고,
 * 회전·뒤집힘·이웃의 교체가 값을 떨어뜨린다.
 */
function shapeKept(
  before: ReadonlyMap<string, cytoscape.Position>,
  after: ReadonlyMap<string, cytoscape.Position>,
): number {
  const ids = [...before.keys()].filter((id) => after.has(id)).sort();
  const nearest = (
    at: ReadonlyMap<string, cytoscape.Position>,
    id: string,
    k: number,
  ): string[] => {
    const p = at.get(id) as cytoscape.Position;
    return ids
      .filter((other) => other !== id)
      .map((other) => {
        const q = at.get(other) as cytoscape.Position;
        return [other, Math.hypot(p.x - q.x, p.y - q.y)] as const;
      })
      .sort((a, b) => a[1] - b[1])
      .slice(0, k)
      .map(([other]) => other);
  };
  const angle = (at: ReadonlyMap<string, cytoscape.Position>, a: string, b: string): number => {
    const p = at.get(a) as cytoscape.Position;
    const q = at.get(b) as cytoscape.Position;
    return Math.atan2(q.y - p.y, q.x - p.x);
  };
  let kept = 0;
  let total = 0;
  for (const id of ids) {
    const later = new Set(nearest(after, id, 10));
    for (const other of nearest(before, id, 5)) {
      total += 1;
      let turn = Math.abs(angle(before, id, other) - angle(after, id, other)) % (2 * Math.PI);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (later.has(other) && turn <= Math.PI / 4) kept += 1;
    }
  }
  return kept / total;
}

describe('같은 번호면 같은 그림 (2026-09-27 · REQ-WEB-245)', () => {
  const small = synthetic(60, 240, 5);

  it('같은 번호로 두 번 배치하면 모든 문서가 같은 자리다', () => {
    expect([...layout(small)]).toEqual([...layout(small)]);
  });

  it('입력의 순서와 무관하다 — 서버가 다른 순서로 줘도 같은 그림이다', () => {
    expect([...layout(small, 1, true, true)].sort()).toEqual([...layout(small)].sort());
  });

  it('번호가 다르면 다른 그림이다 — [다른 배치]의 쓸모', () => {
    expect(shapeKept(layout(small, 1), layout(small, 2))).toBeLessThan(0.5);
  });

  it('잎의 자리만 적는다 — 영역 상자는 자식을 감싼 자국이다', () => {
    const cy = draw(small);
    runLayout(cy, 1);
    const at = leafPositions(cy);
    expect(at.has('area-00')).toBe(false);
    expect(at.has('doc-0000')).toBe(true);
    cy.destroy();
  });

  it('기준 자리는 번호와 id 로만 정해진다 — 같은 글자면 같은 수다', () => {
    expect(hash01('1:a:doc-0001')).toBe(hash01('1:a:doc-0001'));
    expect(hash01('1:a:doc-0001')).not.toBe(hash01('1:a:doc-0002'));
    expect(hash01('x')).toBeGreaterThanOrEqual(0);
    expect(hash01('x')).toBeLessThan(1);
  });
});

describe('문서가 늘거나 줄어도 형태가 그대로다 (2026-09-27 · 사람 결정 · REQ-WEB-247)', () => {
  // 사람이 보고한 규모. 형태 유지율 0.9 가 문턱이다 — 예전(fcose)은 0.10–0.16 이었고,
  // 이 방법은 합성 실험에서 갱신마다 0.96–1.00 이었다.
  const base = synthetic(243, 3036, 42);
  const before = layout(base);

  it('문서 하나를 더해도 이웃과 그 방향이 남는다', () => {
    expect(shapeKept(before, layout(grow(base, 1, 7)))).toBeGreaterThanOrEqual(0.9);
  });

  it('문서 열 개를 더해도 남는다', () => {
    expect(shapeKept(before, layout(grow(base, 10, 8)))).toBeGreaterThanOrEqual(0.9);
  });

  it('문서를 지워도 남는다 — 남은 문서끼리의 형태다', () => {
    const gone = new Set(['doc-0003', 'doc-0050', 'doc-0120']);
    const fewer = {
      docs: base.docs.filter((d) => !gone.has(d.id)),
      links: base.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
    };
    expect(shapeKept(before, layout(fewer))).toBeGreaterThanOrEqual(0.9);
  });

  it('영역으로 묶기를 켜고 꺼도 문서들이 같은 방향에 남는다', () => {
    expect(shapeKept(before, layout(base, 1, false))).toBeGreaterThanOrEqual(0.9);
  });

  it('겹친 문서가 없다 — 묶지 않은 그림에서도', () => {
    for (const grouped of [true, false]) {
      const cy = draw(base, grouped);
      runLayout(cy, 1, undefined, treeOf(base));
      const at: { x: number; y: number; r: number }[] = [];
      cy.nodes().forEach((n) => {
        if (!n.isParent()) at.push({ ...n.position(), r: Number(n.data('weight')) / 2 });
      });
      for (const [i, p] of at.entries())
        for (const q of at.slice(i + 1))
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
      cy.destroy();
    }
  });
});
