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
//   ④ **이름의 자리** — 이름이 그려질 배치에서만 이름이 차지할 자리까지 떼어 놓고,
//      그러고도 겹치는 이름은 그리지 않는다(2026-09-22 · REQ-WEB-095 개정 · 178)
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
//
// ── 이름 (2026-09-22 · 사람 보고) ───────────────────────────────────────────────
//
// **작은 프로젝트에서는 이름이 서로를 덮었다.** §2.4a 는 "전체 보기의 맞춤 배율은 이름이
// 나타나는 배율(0.89)보다 낮으므로 겹칠 이름은 애초에 그려지지 않는다"고 적었는데, 그것은
// clemvion 의 **141 노드에서만** 성립하는 전제다. 시드처럼 노드가 스물이면 맞춤 배율이 1을
// 넘어 이름이 전부 그려지고, 이름은 노드보다 훨씬 넓어(`'text-max-width': '90px'`) 옆 문서의
// 이름 위에 눕는다 — 정리 패스가 잎을 **동그라미 기준으로** 떼어 놓기 때문이다.
//
// 그래서 둘을 한다.
//   ① **이름이 그려질 배치에서만 이름의 자리를 잡아 둔다.** 먼저 여느 때처럼 동그라미로
//      다지고, 그 배치의 맞춤 배율이 이름이 나타나는 배율 이상이면 **이름을 품은 상자로**
//      한 번 더 다진다. 그렇게 해서 배율이 그 아래로 내려가면 — 이름이 사라지는데 자리만
//      버린 것이므로 — 앞의 답으로 되돌린다. **큰 그래프는 이 길을 지나가지 않는다**:
//      clemvion 의 맞춤 배율은 0.53 이라 첫 판정에서 걸러진다(측정값이 그대로인 이유다).
//   ② **그러고도 겹치는 이름은 그리지 않는다.** 배치가 아니라 **화면**의 일이다 — 사람이
//      확대하면 큰 그래프에서도 이름이 나타나고 그때 다시 겹친다. 큰 것(피참조가 많은 것)
//      부터 자리를 차지하고, 자리를 잃은 이름은 가라앉는다. 읽을 수 없는 크기를 그리지
//      않는 것과 같은 규칙의 다른 얼굴이다(REQ-WEB-095) — **가려서 못 읽는 것도 못 읽는
//      것이다.** 고른 문서의 이름은 언제나 이긴다.

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
 * 문서 이름의 글자 크기와 그것을 그리기 시작하는 화면 크기 — **정본은 여기다.**
 *
 * `graph.tsx` 의 cytoscape 스타일이 이 값을 읽는다. 두 벌로 적으면 한쪽만 바뀌는 날
 * 배치는 "이름이 그려진다" 고 계산하고 화면은 그리지 않는다(또는 그 반대다).
 */
export const LABEL_FONT_SIZE = 9;
export const LABEL_MIN_ZOOMED = 8;
/** 이 배율부터 이름이 그려진다 — 배치가 이름의 자리를 잡아 둘지 가르는 문턱이다 */
export const LABEL_ZOOM = LABEL_MIN_ZOOMED / LABEL_FONT_SIZE;

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
  /**
   * 상자 중심 → 노드 자리.
   *
   * 이름은 노드 **아래**에 달리므로(`'text-valign': 'bottom'`) 이름까지 품은 상자의 중심은
   * 노드보다 아래에 있다. 그 어긋남을 들고 다니지 않으면 노드가 상자 중심에 놓이고,
   * 그만큼 이름이 아래 이웃 쪽으로 밀려 **떼어 놓은 자리를 스스로 되돌린다.**
   */
  ox: number;
  oy: number;
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

function insetOf(node: cytoscape.NodeSingular, withLabels: boolean): AreaInset {
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
  // **이름의 자리를 두 번 세지 않는다.** 잎이 이름을 품고 다지면 자식들의 extent 가 이미
  // 이름까지 덮으므로, 여기서 또 얹으면 영역 상자가 이름 한 벌만큼 헛되이 부푼다.
  const over = withLabels
    ? { x: 0, top: 0, bottom: 0 }
    : { x: overX, top: overTop, bottom: overBottom };
  return {
    x: fixed + (Number.isFinite(over.x) ? Math.max(0, over.x) : 0),
    top: fixed + title + (Number.isFinite(over.top) ? Math.max(0, over.top) : 0),
    bottom: fixed + (Number.isFinite(over.bottom) ? Math.max(0, over.bottom) : 0),
  };
}

function toItem(node: cytoscape.NodeSingular, withLabels: boolean): GraphItem {
  if (node.isParent()) {
    const inset = insetOf(node, withLabels);
    const kids = node.children().map((kid) => toItem(kid, withLabels));
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
    return { node, kids, w, h, cx, cy, rx: 0, ry: 0, ox: 0, oy: 0 };
  }
  const box = node.boundingBox({ includeLabels: withLabels });
  const at = node.position();
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  // 이름 없이 잴 때는 상자가 노드에 딱 맞아 어긋남이 0 이다 — 예전 동작 그대로다
  return {
    node,
    kids: null,
    w: box.w,
    h: box.h,
    cx,
    cy,
    rx: 0,
    ry: 0,
    ox: at.x - cx,
    oy: at.y - cy,
  };
}

function place(item: GraphItem): void {
  if (item.kids === null) {
    item.node.position({ x: item.cx + item.ox, y: item.cy + item.oy });
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
export function compactAreas(cy: cytoscape.Core, aspect?: number | null, withLabels = false): void {
  const width = cy.width();
  const height = cy.height();
  // 캔버스를 모르는 자리(테스트·측정 전)에서는 모양을 겨냥하지 않는다 — 겹침만 푼다
  const target =
    aspect !== undefined
      ? aspect
      : Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? (width - 2 * FIT_PADDING) / (height - 2 * FIT_PADDING)
        : null;
  // `filter` 를 지나면 원소 타입이 넓어진다 — 지역 함수로 좁혀서 넘긴다
  const asItem = (node: cytoscape.NodeSingular): GraphItem => toItem(node, withLabels);
  const roots = cy
    .nodes()
    .filter((node) => node.parent().empty())
    .map(asItem);
  if (roots.length === 0) return;
  pack(roots, { gap: AREA_GAP, aspect: target });
  cy.batch(() => {
    for (const root of roots) place(root);
  });
}

/** 지금 배치를 화면에 맞추면 몇 배가 되는가 — `cy.fit()` 이 고를 배율을 미리 센다 */
function fitZoomOf(cy: cytoscape.Core): number {
  const width = cy.width();
  const height = cy.height();
  const bb = cy.elements().boundingBox();
  if (!(width > 0) || !(height > 0) || !(bb.w > 0) || !(bb.h > 0)) return 0;
  return Math.min((width - 2 * FIT_PADDING) / bb.w, (height - 2 * FIT_PADDING) / bb.h);
}

const positionsOf = (cy: cytoscape.Core): Map<string, cytoscape.Position> =>
  new Map(cy.nodes().map((node) => [node.id(), { ...node.position() }]));

function putPositions(cy: cytoscape.Core, saved: Map<string, cytoscape.Position>): void {
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const at = saved.get(node.id());
      if (at !== undefined) node.position(at);
    });
  });
}

/**
 * 이름이 그려질 배치라면 **이름의 자리까지** 잡아 두고 다시 다진다.
 *
 * 순서가 이 함수의 전부다. 먼저 동그라미로 다져 보고 그 배치의 맞춤 배율이 문턱을 넘을
 * 때에만 — 즉 **이름이 실제로 그려질 때에만** — 이름을 품은 상자로 한 번 더 다진다.
 * 이름의 자리는 공짜가 아니라서(`'text-max-width': '90px'` 는 노드 지름의 서너 배다) 그리지도
 * 않을 이름 때문에 그림을 넓히면 노드만 작아진다 — 이 저장소가 "빈자리는 공짜가 아니다"
 * 라고 적은 그것이다.
 *
 * 그래서 되돌리는 길도 둔다: 이름의 자리를 잡았더니 배율이 문턱 **아래로** 내려갔다면
 * 이름은 어차피 사라지므로, 자리만 버린 그 답을 쓰지 않는다.
 *
 * **fcose 의 답에서 다시 시작한다** — 이미 다져 놓은 자리 위에서 또 다지면 두 번째 답은
 * 첫 번째의 모양을 물려받고, 그러면 무엇이 더 나은지 견주는 일이 아니게 된다.
 */
function compactForLabels(cy: cytoscape.Core, fcoseAt: Map<string, cytoscape.Position>): void {
  if (fitZoomOf(cy) < LABEL_ZOOM) return;
  const bareAt = positionsOf(cy);
  putPositions(cy, fcoseAt);
  compactAreas(cy, undefined, true);
  if (fitZoomOf(cy) < LABEL_ZOOM) putPositions(cy, bareAt);
}

/** 화면에 그려진 이름 하나가 차지하는 자리 — `rank` 가 클수록 먼저 자리를 잡는다 */
export interface LabelBox {
  id: string;
  rank: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * 겹쳐서 못 읽는 이름을 고른다 — **큰 것부터 자리를 차지한다.**
 *
 * 돌려주는 것은 **가릴 id** 다. 순서는 `rank` 내림차순이고, 같으면 id 로 가른다 —
 * 같은 그림에서 매번 같은 이름이 남아야 한다(누를 때마다 다른 이름이 사라지면 그림을
 * 읽는 일 자체가 어지러워진다).
 */
export function crowdedLabels(boxes: readonly LabelBox[]): Set<string> {
  const hidden = new Set<string>();
  const kept: LabelBox[] = [];
  const order = [...boxes].sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1));
  for (const box of order) {
    const hit = kept.some((k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2);
    if (hit) hidden.add(box.id);
    else kept.push(box);
  }
  return hidden;
}

/**
 * 겹치는 이름을 가린다 — 배치가 아니라 **화면**의 일이다(REQ-WEB-095 개정).
 *
 * 재는 것은 모델 좌표가 아니라 **화면 좌표**다 — 읽을 수 있느냐는 화면의 성질이다.
 * 다만 이름은 그림과 **함께** 커지므로(cytoscape 의 `font-size` 는 모델 크기다) 배율을
 * 바꾼다고 답이 달라지지는 않는다. 답을 바꾸는 것은 노드를 끄는 일과, 하나를 골라
 * 나머지를 가라앉히는 일이다.
 *
 * 셋을 건너뛴다 — **영역 이름**(지도의 지명이라 배율과 무관하게 남는다 · REQ-WEB-095) ·
 * **가라앉은 노드**(이미 안 보이므로 자리를 다투지 않는다. 그래서 하나를 고르면 그 이웃의
 * 이름이 되살아난다) · **이름이 없는 노드**.
 *
 * 배율이 낮아 cytoscape 가 이미 이름을 지운 자리에서는 아무 일도 하지 않는다(가릴 것이
 * 없다). 그 판정에 쓰는 값이 스타일과 갈리지 않도록 상수는 이 파일이 갖는다.
 */
export function declutterLabels(cy: cytoscape.Core): void {
  const drawn = cy.zoom() * LABEL_FONT_SIZE >= LABEL_MIN_ZOOMED;
  const boxes: LabelBox[] = [];
  if (drawn) {
    cy.nodes().forEach((node) => {
      if (node.isParent() || node.hasClass('faded')) return;
      const bare = node.renderedBoundingBox({ includeLabels: false });
      const named = node.renderedBoundingBox({ includeLabels: true });
      if (named.h - bare.h < 1) return;
      boxes.push({
        id: node.id(),
        // 고른 문서의 이름은 언제나 이긴다 — 그것을 읽으려고 누른 것이다
        rank: node.hasClass('picked') ? Infinity : Number(node.data('weight') ?? 0),
        x1: named.x1,
        x2: named.x2,
        // 이름만 본다 — 동그라미까지 세면 맞닿은 이웃이 서로의 이름을 지운다
        y1: bare.y2,
        y2: named.y2,
      });
    });
  }
  const hidden = crowdedLabels(boxes);
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      node.toggleClass('crowded', hidden.has(node.id()));
    });
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
    const fcoseAt = positionsOf(cy);
    compactAreas(cy);
    compactForLabels(cy, fcoseAt);
    cy.fit(undefined, FIT_PADDING);
    declutterLabels(cy);
  });
  layout.run();
}
