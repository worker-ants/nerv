// 배치 정리 패스 — 정본: docs/04-mvp/screens.md §2.4a
//
// **여기서 지키는 것은 "형제는 겹치지 않는다" 하나다.** 겹친 상자는 화면에서 부모·자식으로
// 읽히고, 그것은 데이터에 없는 계층이다. 눈으로는 "좀 지저분하네"로 보여서 넘어가고,
// 넘어가면 그래프가 거짓 구조를 말하는 채로 산다.
//
// 배치 자체(어느 영역이 어느 영역 옆에 서는가)는 fcose 의 일이라 검사하지 않는다 —
// `randomize` 라 매번 다르고, 다른 것이 그 옵션의 쓸모다.

import cytoscape from 'cytoscape';
import { describe, expect, it } from 'vitest';
import { compactAreas, extent, gravitate, pack, relax, type PackItem } from './layout.js';

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
