// 관계 그래프의 배치 — 정본: docs/04-mvp/screens.md §2.4a
//
// **힘기반 배치 한 번으로는 영역이 서로 겹친다.** fcose 는 compound 를 알지만 영역 상자가
// 겹치지 않는다고 보장하지 않는다. 노드를 밀고 당기는 것은 노드끼리이고, 상자는 그 결과로
// 자식들을 감싼 자국일 뿐이다 — clemvion 실측(노드 141 · 간선 1,230)에서 영역 사이 간선이
// 1,230 중 **801**이라, 힘은 자식들을 남의 영역 안쪽까지 끌고 간다. 그러면 상자 둘이 겹쳐
// 그려지고, 겹친 상자는 **부모·자식으로 읽힌다.** 화면이 없는 계층을 말하는 것이다.
//
// 두 번째 문제는 빈자리다. 배치는 화면보다 훨씬 크게 퍼져 맞춤 배율이 **평균 0.472**
// 였고, 그 배율에서 노드는 작고 이름은 아예 그려지지 않는다(REQ-WEB-095).
// **빈자리는 공짜가 아니다 — 캔버스 100px 은 곧 읽을 수 있는 노드 수다**(§2.4a).
//
// 그래서 fcose 가 답을 낸 **뒤에** 한 벌 더 돈다. 이 패스가 하는 일은 세 가지다.
//   ① **겹침 제거** — 같은 부모를 둔 형제 상자끼리만 본다. 진짜 부모·자식은 겹쳐도 되고
//      (그것이 계층이다) 형제는 겹치면 안 된다. 상자는 통째로 움직인다 — 안쪽 배치는
//      fcose 의 답 그대로다
//   ② **다지기** — 중심으로 조금씩 줄였다가 다시 밀어내기를 반복하며 가장 작은 답을 고른다.
//      균일 축소라 **누가 누구 옆에 있었는지는 그대로**다
//   ③ **중력** — 다지고 나서도 안쪽에 남은 구멍으로 바깥 것을 끌어당긴다. 멀리 떨어진
//      작은 영역 하나가 화면 전체의 배율을 깎는 자리를 메운다
//
// 실측(clemvion · **실브라우저** 14회 평균 · 2026-09-22 · 캔버스 1,158×752): 겹친 형제
// 상자 **33.8쌍 → 0**(영역끼리는 20.1 → 0), 맞춤 배율 **0.472 → 0.529**, 노드가 덮는
// 면적 비율 **0.042 → 0.074**, 배치 한 번 **115ms → 224ms**. 영역으로 묶기를 껐을 때도
// 같은 패스가 돈다 — 그쪽은 겹친 **노드** 94.8쌍이 0이 된다.
//
// **헤드리스로 재면 이득이 부풀려진다**(같은 데이터로 0.559 → 0.792). 글꼴이 없어 라벨이
// 0 크기로 잡히고, 그러면 영역 상자가 실제보다 훨씬 작아진다 — 숫자는 화면이 내는 것으로
// 적는다. **최저 배율은 0.46 → 0.43 으로 나아지지 않는다**: 이 패스가 고치는 것은 매번
// 겹치던 상자이지 최악의 배치가 아니다.
//
// **이 패스는 배치를 대신하지 않는다.** 어느 영역이 어느 영역 옆에 서는지, 어느 문서가
// 허브인지는 여전히 fcose 가 정한다. 여기서 바뀌는 것은 자리 사이의 **거리**뿐이다.

import type cytoscape from 'cytoscape';

/** 영역 **안에서** 형제 사이에 남기는 간격(px) — 좁힐수록 그림이 커지고, 이름은 서로를 가린다 */
const LEAF_GAP = 16;
/** 뿌리에서 영역 상자를 늘어놓을 때의 간격(px) — 상자는 자기 여백을 이미 갖고 있어 더 좁다 */
const AREA_GAP = 12;
/** 영역 이름이 상자 위에 앉을 자리 — 실제로 잰 값을 쓰고, 재지 못할 때의 기본값이다 */
const AREA_LABEL = 16;
/** 영역 상자가 자식 주위에 두는 여백 — 마찬가지로 재서 쓰고, 이것은 재지 못할 때의 값이다 */
const AREA_PAD = 12;
/** 구멍 메우기를 몇 번 도는가 */
const GRAVITY_PASSES = 3;
/** 겹침을 끝까지 푸는 데 쓰는 반복 상한 — 처음과 마지막에 한 번씩만 돈다 */
const SETTLE_ITERATIONS = 2000;
/** 맞춤 여백 — 기본값(30)보다 좁힌다. 여백은 그림이 쓸 수 있었던 픽셀이다 */
const FIT_PADDING = 16;

/**
 * 배치 옵션 — 첫 그림과 [다시 배치]가 **같은 값**을 쓴다.
 *
 * `randomize` 라 누를 때마다 다른 답이 나온다. 그것이 그 버튼의 쓸모다: 밀집한 자리는
 * 한 번 더 굴리면 풀리고, 손으로 끌어 흐트러뜨린 뒤 되돌리는 길도 여기 하나다.
 *
 * **`fit` 은 끈다.** 맞추는 것은 정리 패스가 끝난 뒤의 일이고, fcose 가 먼저 맞춰 두면
 * 그 배율은 곧 버려진다.
 */
export const LAYOUT = {
  name: 'fcose',
  // 밀도가 높을수록 밀어내는 힘을 키운다 — 기본값으로는 중앙에 뭉친다
  nodeRepulsion: 9000,
  idealEdgeLength: 90,
  nestingFactor: 0.2,
  animate: false,
  randomize: true,
  fit: false,
} as cytoscape.LayoutOptions;

/** 정리 패스가 다루는 최소 단위 — 잎 노드 하나이거나, 영역 상자 하나다 */
export interface PackItem {
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface PackRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** 무리 전체를 감싸는 상자 */
export function extent(items: readonly PackItem[]): PackRect {
  if (items.length === 0) return { x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0, cx: 0, cy: 0 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const it of items) {
    x1 = Math.min(x1, it.cx - it.w / 2);
    y1 = Math.min(y1, it.cy - it.h / 2);
    x2 = Math.max(x2, it.cx + it.w / 2);
    y2 = Math.max(y2, it.cy + it.h / 2);
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

function pairsOf(items: readonly PackItem[]): [PackItem, PackItem][] {
  const pairs: [PackItem, PackItem][] = [];
  for (const [i, a] of items.entries()) {
    for (const b of items.slice(i + 1)) pairs.push([a, b]);
  }
  return pairs;
}

/**
 * 겹친 형제를 **짧은 쪽으로** 밀어낸다 — 둘이 반씩 물러난다.
 *
 * 짧은 쪽으로 미는 이유는 그것이 겹침을 푸는 가장 적은 이동이기 때문이다. 옆으로 조금만
 * 비키면 될 것을 위아래로 밀면 배치가 통째로 늘어난다.
 *
 * 돌려주는 값은 **남은 가장 깊은 겹침**이다 — 0 이면 더 볼 것이 없다.
 */
export function relax(items: readonly PackItem[], gap: number, iterations: number): number {
  const pairs = pairsOf(items);
  let worst = 0;
  for (let round = 0; round < iterations; round += 1) {
    worst = 0;
    for (const [a, b] of pairs) {
      const ox = (a.w + b.w) / 2 + gap - Math.abs(a.cx - b.cx);
      const oy = (a.h + b.h) / 2 + gap - Math.abs(a.cy - b.cy);
      if (ox <= 0 || oy <= 0) continue;
      const depth = Math.min(ox, oy);
      if (depth > worst) worst = depth;
      // 중심이 정확히 같으면 방향이 없다 — 목록 순서로 가른다(같은 입력이면 같은 답이다)
      if (ox < oy) {
        const away = a.cx <= b.cx ? -1 : 1;
        a.cx += (away * ox) / 2;
        b.cx -= (away * ox) / 2;
      } else {
        const away = a.cy <= b.cy ? -1 : 1;
        a.cy += (away * oy) / 2;
        b.cy -= (away * oy) / 2;
      }
    }
    if (worst === 0) break;
  }
  return worst;
}

/**
 * 겹치지 않고 갈 수 있는 만큼 중심으로 끌어당긴다 — 상자 **사이에 남은 구멍**을 메운다.
 *
 * 다지기는 무리를 통째로 줄이므로, 한 쌍이 맞닿는 순간 나머지가 아무리 헐거워도 멈춘다.
 * 그래서 고립된 작은 영역 하나가 화면 절반을 비워 둔 채 남는다(실측: clemvion 의
 * `채널·웹챗` — 문서 둘짜리 영역이 본체에서 한참 떨어져 앉아 배율을 깎았다).
 *
 * 먼 것부터 당긴다 — 안쪽 것이 먼저 들어오면 바깥 것의 길을 막는다.
 */
export function gravitate(items: readonly PackItem[], gap: number, passes: number): void {
  if (items.length < 2) return;
  const clear = (self: PackItem, cx: number, cy: number): boolean => {
    for (const other of items) {
      if (other === self) continue;
      const ox = (self.w + other.w) / 2 + gap - Math.abs(cx - other.cx);
      const oy = (self.h + other.h) / 2 + gap - Math.abs(cy - other.cy);
      if (ox > 0.001 && oy > 0.001) return false;
    }
    return true;
  };
  for (let pass = 0; pass < passes; pass += 1) {
    const bb = extent(items);
    const far = [...items].sort(
      (a, b) => Math.hypot(b.cx - bb.cx, b.cy - bb.cy) - Math.hypot(a.cx - bb.cx, a.cy - bb.cy),
    );
    for (const it of far) {
      const dx = bb.cx - it.cx;
      const dy = bb.cy - it.cy;
      let bestX = it.cx;
      let bestY = it.cy;
      let bestDistance = Math.hypot(dx, dy);
      // 곧장 · 가로만 · 세로만 — 곧장 가는 길이 막혔어도 옆으로는 들어갈 수 있다
      const ways: [number, number][] = [
        [dx, dy],
        [dx, 0],
        [0, dy],
      ];
      for (const [vx, vy] of ways) {
        if (vx === 0 && vy === 0) continue;
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 12; k += 1) {
          const mid = (lo + hi) / 2;
          if (clear(it, it.cx + vx * mid, it.cy + vy * mid)) lo = mid;
          else hi = mid;
        }
        const nx = it.cx + vx * lo;
        const ny = it.cy + vy * lo;
        const distance = Math.hypot(bb.cx - nx, bb.cy - ny);
        if (distance < bestDistance - 0.001) {
          bestDistance = distance;
          bestX = nx;
          bestY = ny;
        }
      }
      it.cx = bestX;
      it.cy = bestY;
    }
  }
}

const snapshot = (items: readonly PackItem[]): [number, number][] =>
  items.map((it) => [it.cx, it.cy]);

function restore(items: readonly PackItem[], saved: readonly [number, number][]): void {
  for (const [i, it] of items.entries()) {
    const at = saved[i];
    if (at === undefined) continue;
    [it.cx, it.cy] = at;
  }
}

/**
 * 한 무리를 정리한다 — 겹침을 없애고, 남는 빈자리를 줄이고, 캔버스 모양에 맞춘다.
 *
 * **줄였다 밀어내기를 반복한다.** 중심 쪽으로 조금 줄이면 몇 쌍이 겹치고, 그 겹침을 풀면
 * 무리는 조금 다르게 — 대개 더 촘촘하게 — 눕는다. 줄이기가 더는 이득이 없어질 때까지
 * 돌면서 **가장 좋았던 답**을 들고 나온다(줄인다고 늘 작아지지는 않는다).
 *
 * `aspect` 를 주면 캔버스 모양까지 본다. 그림이 캔버스보다 홀쭉하면 세로를 더 줄이고,
 * 그러면 밀어내기가 가로로 퍼뜨린다 — **같은 픽셀에서 그림이 커진다.**
 */
export function pack(
  items: readonly PackItem[],
  options: { gap: number; aspect?: number | null; gravity?: number },
): void {
  const { gap, aspect = null, gravity = GRAVITY_PASSES } = options;
  const n = items.length;
  if (n < 2) return;
  // 비용은 쌍의 수(n²)로 자란다 — 무리가 크면 횟수를 줄인다(영역으로 묶기를 끄면 141개다)
  const steps = n > 60 ? 24 : 60;
  const iterations = n > 60 ? 120 : 400;
  // **재는 것은 넓이가 아니라 맞춤 배율이다.** 캔버스 모양을 알면 화면에 들어가는 배율은
  // `min(W/너비, H/높이)` 이고, 그것을 키우는 일은 `max(너비/종횡비, 높이)` 를 줄이는 일과
  // 같다. 넓이로 고르면 **같은 넓이의 정사각형**이 이기는데, 가로로 넓은 캔버스에서 정사각형은
  // 좌우를 비워 둔 채로 작게 맞춰진다(실측: 종횡비 1.72 → 1.10 으로 뭉개졌다).
  const cost = (bb: PackRect): number => {
    if (bb.w === 0 || bb.h === 0) return 0;
    return aspect === null ? bb.w * bb.h : Math.max(bb.w / aspect, bb.h);
  };

  // 첫 밀어내기에는 넉넉히 준다 — 한 번뿐이고, 여기서 못 푼 겹침은 **뒤의 모든 후보가
  // 물려받는다**(밀어내기는 겹침이 없어지면 스스로 멈추므로 대개 몇 바퀴에 끝난다)
  relax(items, gap, SETTLE_ITERATIONS);
  let best = snapshot(items);
  let bestCost = cost(extent(items));

  for (let step = 0; step < steps; step += 1) {
    const bb = extent(items);
    let sx = 0.94;
    let sy = 0.94;
    if (aspect !== null && bb.h > 0) {
      if (bb.w / bb.h < aspect) sy *= 0.94;
      else sx *= 0.94;
    }
    for (const it of items) {
      it.cx = bb.cx + (it.cx - bb.cx) * sx;
      it.cy = bb.cy + (it.cy - bb.cy) * sy;
    }
    // **겹침이 남은 후보는 고르지 않는다.** 줄이면 대개 더 작아지므로, 크기만 보고 고르면
    // "작지만 겹친" 답이 이긴다 — 이 패스가 없애려던 바로 그것이다(실측 2026-09-22:
    // 영역으로 묶기를 끈 141개에서 겹친 쌍 169 이 그렇게 살아남았다).
    const settled = relax(items, gap, iterations) === 0;
    const now = cost(extent(items));
    if (settled && now < bestCost) {
      bestCost = now;
      best = snapshot(items);
    }
  }
  restore(items, best);
  // 첫 밀어내기가 끝내 못 풀었으면 여기서 한 번 더 — **겹치지 않는 것이 작은 것보다 먼저다**
  relax(items, gap, SETTLE_ITERATIONS);

  // 중력은 **가장 좋은 답을 고른 뒤**에 한 번만 돈다. 중심으로 당기는 일은 상자를 넓히지
  // 못하므로 되돌릴 이유가 없고, 이것이 메우는 것은 상자 크기가 아니라 **안쪽에 남은
  // 구멍**이다 — 크기로 고르는 판정에는 그 구멍이 보이지 않아, 판정에 맡기면 매번 버려진다.
  //
  // **다지기를 한 바퀴 더 돌리는 것은 이득이 없었다**(실측 2026-09-22 · 실브라우저 8회:
  // 맞춤 배율 0.568 → 0.531). 비용만 두 배가 된다.
  gravitate(items, gap, gravity);
}

/** 정리 패스가 들고 다니는 한 조각 — 잎이면 `kids` 가 없다 */
interface GraphItem extends PackItem {
  node: cytoscape.NodeSingular;
  kids: GraphItem[] | null;
  /** 부모 상자 중심에서의 상대 위치 — 부모가 움직이면 따라간다 */
  rx: number;
  ry: number;
}

/**
 * 영역 상자가 자식 **바깥으로** 얼마나 나가는지를 면마다 잰다 — 숫자를 베끼지 않는다.
 *
 * 상자를 넓히는 것은 둘이다. ① cytoscape 가 더하는 고정 여백(기본 11.5px) ② **자식의 이름** —
 * 라벨은 노드보다 훨씬 넓고(`'text-max-width': '90px'`) 아래로 한 줄 더 내려가므로, 가장자리에
 * 선 자식의 이름이 상자를 그만큼 밀어낸다. 화면은 배율이 낮으면 이름을 그리지 않지만
 * (REQ-WEB-095) **상자 크기는 배율과 무관하게 그 자리를 잡아 둔다.**
 *
 * 그래서 넷을 따로 잰다. 한 값으로 뭉뚱그려 네 면에 다 주면 — 처음에 그렇게 했다 — 위아래가
 * 좌우만큼 부풀어 영역 하나가 90px 씩 커지고, 그 낭비가 열여섯 개 쌓인다(실측 2026-09-22).
 * 이름의 튀어나옴은 **자식 중 가장 심한 것**으로 잡는다: 다지고 나면 어느 자식이 가장자리에
 * 설지 달라지므로, 지금 가장자리에 선 자식만 보면 그 뒤에 상자가 모자란다.
 */
interface AreaInset {
  /** 좌우 — 이름은 노드 가운데에 걸리므로 양쪽이 같다 */
  x: number;
  top: number;
  bottom: number;
}

function insetOf(node: cytoscape.NodeSingular): AreaInset {
  const box = node.boundingBox({ includeLabels: false });
  const kids = node.children();
  let overX = 0;
  let overTop = 0;
  let overBottom = 0;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  kids.forEach((kid) => {
    const bare = kid.boundingBox({ includeLabels: false });
    const named = kid.boundingBox({ includeLabels: true });
    overX = Math.max(overX, (named.w - bare.w) / 2);
    overTop = Math.max(overTop, bare.y1 - named.y1);
    overBottom = Math.max(overBottom, named.y2 - bare.y2);
    x1 = Math.min(x1, named.x1);
    y1 = Math.min(y1, named.y1);
    x2 = Math.max(x2, named.x2);
    y2 = Math.max(y2, named.y2);
  });
  // 고정 여백 — 이름까지 품은 자식 전체와 상자의 차이가 그것이다
  const pad = Math.max(x1 - box.x1, box.x2 - x2, y1 - box.y1, box.y2 - y2);
  const fixed = Number.isFinite(pad) && pad > 0 ? pad : AREA_PAD;
  // 영역 **자기** 이름은 상자 위에 앉는다(`'text-valign': 'top'`) — 그만큼을 위에 더 얹어야
  // 위 형제가 그 글자를 덮지 않는다
  const labeled = node.boundingBox({ includeLabels: true });
  const own = box.y1 - labeled.y1 - overTop;
  const title = Number.isFinite(own) && own > 0 ? own : AREA_LABEL;
  return {
    x: fixed + (Number.isFinite(overX) ? Math.max(0, overX) : 0),
    top: fixed + title + (Number.isFinite(overTop) ? Math.max(0, overTop) : 0),
    bottom: fixed + (Number.isFinite(overBottom) ? Math.max(0, overBottom) : 0),
  };
}

function toItem(node: cytoscape.NodeSingular): GraphItem {
  if (node.isParent()) {
    const inset = insetOf(node);
    const kids = node.children().map(toItem);
    // 안쪽은 정사각에 가깝게 민다(`aspect: 1`) — 길쭉한 상자는 서로 끼워 넣기 어렵고,
    // 끼워지지 않은 상자는 옆에 빈자리를 남긴다
    pack(kids, { gap: LEAF_GAP, aspect: 1 });
    const bb = extent(kids);
    const cx = bb.cx;
    const cy = bb.cy + (inset.bottom - inset.top) / 2;
    for (const kid of kids) {
      kid.rx = kid.cx - cx;
      kid.ry = kid.cy - cy;
    }
    const w = bb.w + 2 * inset.x;
    const h = bb.h + inset.top + inset.bottom;
    return { node, kids, w, h, cx, cy, rx: 0, ry: 0 };
  }
  const box = node.boundingBox({ includeLabels: false });
  const at = node.position();
  return { node, kids: null, w: box.w, h: box.h, cx: at.x, cy: at.y, rx: 0, ry: 0 };
}

function place(item: GraphItem): void {
  if (item.kids === null) {
    item.node.position({ x: item.cx, y: item.cy });
    return;
  }
  for (const kid of item.kids) {
    kid.cx = item.cx + kid.rx;
    kid.cy = item.cy + kid.ry;
    place(kid);
  }
}

/**
 * fcose 의 답을 정리한다 — **형제끼리 겹치지 않게, 빈자리 없이, 캔버스 모양으로.**
 *
 * 깊은 곳부터 올라온다: 안쪽을 먼저 다져야 바깥 상자가 실제 크기로 자리를 잡는다.
 * 옮기는 것은 잎 노드의 좌표뿐이고, 영역 상자는 자식을 감싼 자국이라 따라온다.
 */
export function compactAreas(cy: cytoscape.Core, aspect?: number | null): void {
  const width = cy.width();
  const height = cy.height();
  // 캔버스를 모르는 자리(테스트·측정 전)에서는 모양을 겨냥하지 않는다 — 겹침만 푼다
  const target =
    aspect !== undefined
      ? aspect
      : Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? (width - 2 * FIT_PADDING) / (height - 2 * FIT_PADDING)
        : null;
  const roots = cy
    .nodes()
    .filter((node) => node.parent().empty())
    .map(toItem);
  if (roots.length === 0) return;
  pack(roots, { gap: AREA_GAP, aspect: target });
  cy.batch(() => {
    for (const root of roots) place(root);
  });
}

/**
 * 배치를 계산하고 정리한 뒤 화면에 맞춘다 — 첫 그림과 [다시 배치]가 같은 길을 지난다.
 *
 * `layoutstop` 을 기다리는 이유는 fcose 가 언제 끝났는지를 그 이벤트만 알기 때문이다.
 * `animate: false` 라 지금은 같은 턴에 끝나지만, 그 사실에 기대어 순서를 적으면
 * 옵션 한 줄이 바뀌는 날 정리 패스가 **빈 배치 위에서** 돈다.
 */
export function runLayout(cy: cytoscape.Core): void {
  const layout = cy.layout(LAYOUT);
  layout.one('layoutstop', () => {
    compactAreas(cy);
    cy.fit(undefined, FIT_PADDING);
  });
  layout.run();
}
