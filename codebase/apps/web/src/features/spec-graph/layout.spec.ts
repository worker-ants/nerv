// 배치 정리 패스 — 정본: docs/04-mvp/screens.md §2.4a
//
// **여기서 지키는 것은 "형제는 겹치지 않는다" 하나다.** 겹친 상자는 화면에서 부모·자식으로
// 읽히고, 그것은 데이터에 없는 계층이다. 눈으로는 "좀 지저분하네"로 보여서 넘어가고,
// 넘어가면 그래프가 거짓 구조를 말하는 채로 산다.
//
// 배치 자체(어느 영역이 어느 영역 옆에 놓이는가)는 fcose 의 일이라 모양은 검사하지 않는다.
// 대신 **같은 번호면 같은 자리**인지는 본다(2026-09-27 · REQ-WEB-245) — 열 때마다 그림이
// 달라 자리를 익힐 수 없던 결함이고, 배치가 비동기로 바뀌는 날 가장 먼저 여기서 깨진다.

import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { describe, expect, it } from 'vitest';
import {
  LABEL_ZOOM,
  PICKED_FONT_SIZE,
  compactAreas,
  crowdedLabels,
  extent,
  gravitate,
  labelReadable,
  labelZoomState,
  leafPositions,
  pack,
  relax,
  runLayout,
  seededRandom,
  withSeed,
  type LabelBox,
  type PackItem,
} from './layout.js';

cytoscape.use(fcose);

const box = (cx: number, cy: number, w = 40, h = 40): PackItem => ({ cx, cy, w, h });

/** 두 상자가 겹친 넓이 — 0 이면 떨어져 있다 */
function overlap(a: PackItem, b: PackItem): number {
  const ox = (a.w + b.w) / 2 - Math.abs(a.cx - b.cx);
  const oy = (a.h + b.h) / 2 - Math.abs(a.cy - b.cy);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function worstOverlap(items: readonly PackItem[]): number {
  let worst = 0;
  for (const [i, a] of items.entries())
    for (const b of items.slice(i + 1)) worst = Math.max(worst, overlap(a, b));
  return worst;
}

describe('밀어내기', () => {
  it('짧은 쪽으로 민다 — 옆으로 비키면 될 것을 위아래로 밀지 않는다', () => {
    // 가로로 10 겹치고 세로로 40 겹친다 — 가로가 짧다
    const items = [box(0, 0), box(30, 0)];
    relax(items, 0, 100);
    expect(items[0]?.cy).toBe(0);
    expect(items[1]?.cy).toBe(0);
    expect(Math.abs((items[1]?.cx ?? 0) - (items[0]?.cx ?? 0))).toBeCloseTo(40, 5);
  });

  it('간격만큼 더 벌린다 — 맞닿은 상자는 여전히 한 덩어리로 읽힌다', () => {
    const items = [box(0, 0), box(30, 0)];
    relax(items, 12, 100);
    expect(Math.abs((items[1]?.cx ?? 0) - (items[0]?.cx ?? 0))).toBeCloseTo(52, 5);
  });

  it('겹치지 않으면 0 을 돌려주고 자리를 건드리지 않는다', () => {
    const items = [box(0, 0), box(200, 0)];
    expect(relax(items, 12, 100)).toBe(0);
    expect(items[0]?.cx).toBe(0);
    expect(items[1]?.cx).toBe(200);
  });

  it('중심이 정확히 같아도 갈라진다 — 방향이 없으면 목록 순서로 가른다', () => {
    const items = [box(0, 0), box(0, 0)];
    relax(items, 8, 200);
    expect(worstOverlap(items)).toBe(0);
    expect(Number.isFinite(items[0]?.cx ?? NaN)).toBe(true);
  });

  it('세 개가 한 자리에 있어도 모두 풀린다', () => {
    const items = [box(0, 0), box(4, 2), box(-3, 1)];
    relax(items, 6, 400);
    expect(worstOverlap(items)).toBe(0);
  });
});

describe('다지기', () => {
  it('겹침을 없애면서 상자를 줄인다 — 빈자리는 공짜가 아니다', () => {
    const items = [box(0, 0), box(20, 10), box(600, 400), box(-500, 300), box(300, -450)];
    const before = extent(items);
    pack(items, { gap: 10 });
    const after = extent(items);
    expect(worstOverlap(items)).toBe(0);
    expect(after.w * after.h).toBeLessThan(before.w * before.h);
  });

  it('캔버스 모양을 겨냥하면 그 모양에 가까워진다 — 같은 픽셀에서 그림이 커진다', () => {
    // 홀쭉한 구름 — 캔버스는 가로로 넓으므로 이대로 맞추면 좌우가 통째로 논다
    const scattered = (): PackItem[] => {
      let seed = 7;
      const next = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      return Array.from({ length: 12 }, () => box(next() * 220, next() * 1300));
    };
    const free = scattered();
    pack(free, { gap: 10 });
    const wide = scattered();
    pack(wide, { gap: 10, aspect: 1.6 });
    const off = (items: readonly PackItem[]): number => {
      const bb = extent(items);
      return Math.abs(bb.w / bb.h - 1.6);
    };
    expect(off(wide)).toBeLessThan(off(free));
    expect(worstOverlap(wide)).toBe(0);
  });

  it('하나뿐이면 아무것도 하지 않는다', () => {
    const items = [box(17, 42)];
    pack(items, { gap: 10, aspect: 1.6 });
    expect(items[0]).toEqual({ cx: 17, cy: 42, w: 40, h: 40 });
  });
});

describe('구멍 메우기', () => {
  it('멀리 떨어진 상자를 당겨 오되 겹치지는 않는다', () => {
    const items = [box(0, 0), box(60, 0), box(0, 60), box(60, 60), box(900, 900)];
    const far = items[4];
    const before = Math.hypot(far?.cx ?? 0, far?.cy ?? 0);
    gravitate(items, 8, 3);
    expect(Math.hypot(far?.cx ?? 0, far?.cy ?? 0)).toBeLessThan(before);
    expect(worstOverlap(items)).toBe(0);
  });

  it('이미 맞닿아 있으면 움직이지 않는다', () => {
    const items = [box(0, 0), box(50, 0)];
    gravitate(items, 10, 3);
    expect(worstOverlap(items)).toBe(0);
    expect(Math.abs((items[1]?.cx ?? 0) - (items[0]?.cx ?? 0))).toBeGreaterThanOrEqual(50);
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
  /** 두 영역의 자식이 서로 엇갈려 앉은 배치 — 힘기반 배치가 실제로 내놓는 모양이다 */
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
    compactAreas(cy);
    expect(overlap(childrenExtent(cy.$id('p')), childrenExtent(cy.$id('q')))).toBe(0);
    cy.destroy();
  });

  it('영역에 들지 않은 문서도 남의 상자 안에 앉지 않는다', () => {
    const cy = interleaved();
    compactAreas(cy);
    const loose = cy.$id('loose');
    const at = loose.position();
    const bb = loose.boundingBox({ includeLabels: false });
    const alone = { cx: at.x, cy: at.y, w: bb.w, h: bb.h };
    expect(overlap(alone, childrenExtent(cy.$id('p')))).toBe(0);
    expect(overlap(alone, childrenExtent(cy.$id('q')))).toBe(0);
    cy.destroy();
  });

  it('영역 안의 문서끼리도 겹치지 않는다 — 다지기는 붙이는 것이지 포개는 것이 아니다', () => {
    const cy = interleaved();
    compactAreas(cy);
    const inside = cy
      .$id('p')
      .children()
      .map((kid) => {
        const at = kid.position();
        const bb = kid.boundingBox({ includeLabels: false });
        return { cx: at.x, cy: at.y, w: bb.w, h: bb.h };
      });
    expect(worstOverlap(inside)).toBe(0);
    cy.destroy();
  });

  it('영역으로 묶지 않아도 같은 패스가 돈다 — 겹친 노드는 읽을 수 없다', () => {
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
    compactAreas(cy);
    const items = cy.nodes().map((n) => {
      const at = n.position();
      const bb = n.boundingBox({ includeLabels: false });
      return { cx: at.x, cy: at.y, w: bb.w, h: bb.h };
    });
    expect(worstOverlap(items)).toBe(0);
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
  it('9px 글자가 8px 로 찍히는 배율이다 — 스타일과 같은 값을 쓴다', () => {
    // 이 수가 배치의 판정("이름의 자리를 잡아 둘까")과 화면의 판정("이름을 그릴까")을
    // 한 곳에서 잇는다. 두 벌로 적으면 한쪽만 바뀌는 날 둘이 어긋난다.
    expect(LABEL_ZOOM).toBeCloseTo(8 / 9, 10);
  });
});

describe('읽히는 크기 (2026-09-27 · REQ-WEB-095)', () => {
  // cytoscape 의 `min-zoomed-font-size` 는 픽셀 비율을 곱하고 2 의 거듭제곱으로 올려 판정해서,
  // Retina 에서는 배율 0.25 만 넘어도 4px 짜리 이름을 그렸다. 판정은 CSS 픽셀 하나로 한다.
  it('9px 이름은 배율 0.889 부터, 고른 문서(11px)는 그보다 낮은 배율부터 읽힌다', () => {
    expect(labelReadable(0.88)).toBe(false);
    expect(labelReadable(0.89)).toBe(true);
    expect(labelReadable(0.5)).toBe(false);
    expect(labelReadable(0.73, PICKED_FONT_SIZE)).toBe(true);
    expect(labelReadable(0.72, PICKED_FONT_SIZE)).toBe(false);
  });

  it('배율은 문턱을 넘나들 때만 답을 바꾼다 — 확대하는 동안 매 장면 다시 세지 않는다', () => {
    expect(labelZoomState(0.4)).toBe(labelZoomState(0.6));
    expect(labelZoomState(0.6)).not.toBe(labelZoomState(0.8));
    expect(labelZoomState(0.8)).not.toBe(labelZoomState(0.95));
    expect(labelZoomState(1.2)).toBe(labelZoomState(3));
  });
});

describe('밀어내기의 끝 (2026-09-27)', () => {
  // 반씩 물러난 뒤의 부동소수점 찌꺼기를 겹침으로 세지 않게 했고, 다지기는 잇달아 못 풀면
  // 멈춘다 — 그래도 결과의 규칙(겹침이 없다 · 같은 입력이면 같은 답)은 그대로여야 한다
  const crowd = (): PackItem[] => {
    const next = seededRandom(7);
    return Array.from({ length: 120 }, () =>
      box(next() * 600, next() * 400, 20 + next() * 60, 20 + next() * 40),
    );
  };

  it('0 을 돌려주면 정말로 겹친 쌍이 없다', () => {
    const items = crowd();
    expect(relax(items, 12, 2000)).toBe(0);
    for (const [i, a] of items.entries())
      for (const b of items.slice(i + 1)) {
        const ox = (a.w + b.w) / 2 + 12 - Math.abs(a.cx - b.cx);
        const oy = (a.h + b.h) / 2 + 12 - Math.abs(a.cy - b.cy);
        // 1e-6px 보다 얕은 겹침은 없는 것으로 본다(`OVERLAP_EPSILON` — 부동소수점 찌꺼기)
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });

  it('같은 입력이면 같은 답이다', () => {
    const one = crowd();
    const two = crowd();
    pack(one, { gap: 12, aspect: 1.5 });
    pack(two, { gap: 12, aspect: 1.5 });
    expect(one).toEqual(two);
  });
});

describe('같은 번호면 같은 그림 (2026-09-27 · REQ-WEB-245)', () => {
  /** 영역 넷 · 문서 40 · 관계 120 — 번호가 같으면 자리가 같아야 한다 */
  function graph(): cytoscape.Core {
    const next = seededRandom(3);
    const areas = ['a0', 'a1', 'a2', 'a3'];
    const docs = Array.from({ length: 40 }, (_, i) => `d${String(i).padStart(2, '0')}`);
    const edges: { data: { id: string; source: string; target: string } }[] = [];
    for (let i = 0; i < 120; i += 1) {
      const source = docs[Math.floor(next() * docs.length)] as string;
      const target = docs[Math.floor(next() * docs.length)] as string;
      if (source !== target) edges.push({ data: { id: `e${i}`, source, target } });
    }
    return cytoscape({
      headless: true,
      styleEnabled: true,
      elements: [
        ...areas.map((id) => ({ data: { id } })),
        ...docs.map((id, i) => ({ data: { id, parent: areas[i % areas.length] } })),
        ...edges,
      ],
      style: [{ selector: 'node', style: { width: 24, height: 24 } }],
    });
  }

  const layoutWith = (seed: number): Map<string, cytoscape.Position> => {
    const cy = graph();
    let done: Map<string, cytoscape.Position> | null = null;
    runLayout(cy, seed, (positions) => {
      done = positions;
    });
    cy.destroy();
    // 배치는 **같은 턴에** 끝나야 한다 — 비동기가 되면 난수의 일부가 원래 것으로 돌아간다
    expect(done).not.toBeNull();
    return done as unknown as Map<string, cytoscape.Position>;
  };

  it('같은 번호로 두 번 배치하면 모든 문서가 같은 자리다', () => {
    expect([...layoutWith(1)]).toEqual([...layoutWith(1)]);
  });

  it('번호가 다르면 다른 그림이다 — [다른 배치]의 쓸모', () => {
    const one = layoutWith(1);
    const two = layoutWith(2);
    const moved = [...one].filter(([id, at]) => {
      const other = two.get(id);
      return other !== undefined && Math.hypot(other.x - at.x, other.y - at.y) > 1;
    });
    expect(moved.length).toBeGreaterThan(0);
  });

  it('배치가 끝나면 Math.random 을 돌려놓는다 — 던져도 돌려놓는다', () => {
    const original = Math.random;
    layoutWith(1);
    expect(Math.random).toBe(original);
    expect(() =>
      withSeed(5, () => {
        throw new Error('배치 실패');
      }),
    ).toThrow('배치 실패');
    expect(Math.random).toBe(original);
  });

  it('잎의 자리만 적는다 — 영역 상자는 자식을 감싼 자국이다', () => {
    const cy = graph();
    runLayout(cy, 1);
    const at = leafPositions(cy);
    expect(at.has('a0')).toBe(false);
    expect(at.has('d00')).toBe(true);
    cy.destroy();
  });
});
