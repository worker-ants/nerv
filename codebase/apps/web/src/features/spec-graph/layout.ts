// 관계 그래프의 배치 — 정본: docs/04-mvp/screens.md §2.4a
//
// **지키는 것은 형태다**(2026-09-27 — 사람 결정 · REQ-WEB-245·247). 형태는 한 문서 주위에 어떤
// 문서가 **어느 방향에** 있는가이다. 그림 전체가 옮겨지거나 커지고 작아지는 것은 상관없고,
// 돌아가거나 뒤집히거나 이웃이 바뀌면 안 된다. 배치는 서버에 저장하지 않으므로 문서가 늘거나
// 줄면 그 데이터로 **다시 계산한다** — 그래서 계산 자체가 "데이터가 조금 바뀌면 그림도 조금만
// 바뀌는" 성질을 가져야 한다.
//
// **fcose 로는 지킬 수 없었다**(합성 243 문서 · 3,036 관계 실측). 시드를 고정해도 문서가 하나만
// 늘면 이웃의 방향이 평균 86° 바뀌었다 — 무작위로 다시 놓은 것과 같은 수준이다. 까닭은 셋이다.
//   ① 첫 자리가 **모두가 함께 쓰는 난수열**에서 나온다. 문서 하나가 끼면 그 뒤 문서의 난수가
//      모두 한 칸씩 밀려 전혀 다른 출발점에서 시작한다
//   ② 힘 기반 배치에는 **방향을 붙잡는 것이 없다.** 돌리거나 뒤집어도 에너지가 같아서, 출발점이
//      조금만 달라도 돌아간 답이 나온다 — 아래 ②의 답에서 fcose 를 이어 돌려도 형태 유지율이
//      0.99 → 0.24–0.28 로 떨어졌다
//   ③ 정리 패스가 **가장 작은 후보를 골랐다.** 줄였다가 밀어내기를 되풀이해 가장 작은 답을 고르고
//      구멍 메우기가 상자를 다른 상자 너머로 옮겼다. 입력이 조금만 달라도 다른 후보가 뽑혀 영역의
//      순서가 바뀌었다(0.99 → 0.70)
//
// 그래서 세 단계로 그린다. **난수를 쓰지 않는다.**
//   ① **기준 자리**(`referencePositions`) — 각 문서의 출발점을 자기 id 의 해시로 정한다. 영역의
//      중심은 영역끼리의 관계 수로 작은 그림을 한 번 펴서 정하되 영역 id 의 해시 자리에 묶는다.
//      다른 문서가 늘거나 줄어도 **한 문서의 출발점은 바뀌지 않는다**
//   ② **관계로 다듬기**(`anchoredStress`) — 관계 거리를 화면 거리로 옮기는 스트레스 배치를 기준
//      자리에 묶어서 푼다. 관계가 가까운 문서끼리 모이고, 묶여 있어서 돌거나 뒤집히지 않는다
//   ③ **방향을 지키는 겹침 풀기**(`separate`) — 무리마다 고른 비율로 넓히거나 좁혀 밀도를 맞추고
//      (방향은 그대로다), 겹친 둘은 **두 중심을 잇는 선을 따라서만** 물러난다. 먼저 넓혀 두는
//      까닭은 겹침을 크게 풀수록 형태를 잃기 때문이다(넓히지 않고 밀기만 하면 0.84)
//
// 실측(2026-09-27 · Node 헤드리스). 형태 유지율은 각 문서의 가까운 이웃 5개 가운데 갱신 뒤에도
// 가까운 이웃 10개 안에, ±45° 안의 방향으로 남은 것의 비율이다.
//   - clemvion(문서 141 · 관계 1,230)에서 가장 늦게 만든 문서 30개를 만든 순서대로 하나씩 더하면:
//     형태 유지율 0.44 → 0.996(최악 0.18 → 0.96), 방향 변화 58° → 1.6°
//   - 합성 243 문서 · 3,036 관계에 1개씩 60번: 0.20 → 0.999, 80° → 0.7°
//   - 대가: clemvion 에서 관계를 반영하는 정도(스트레스)가 fcose 의 1.35배로 나쁘고 맞춤 배율은
//     0.84배다(합성 데이터에서는 둘 다 fcose 와 같은 수준 — 0.93–1.07배). 계산은 3–4배 빠르다
//
// ── 이 파일이 여전히 지키는 것 ─────────────────────────────────────────────────────
//
// **형제는 겹치지 않는다**(REQ-WEB-174). 겹친 상자는 부모·자식으로 읽히고, 그것은 데이터에 없는
// 계층이다(clemvion 실측 2026-09-22: 영역 사이 간선이 1,230 중 801 이라, 힘은 자식을 남의 영역
// 안쪽까지 끌고 갔다). **빈자리는 공짜가 아니다** — 캔버스 100px 은 곧 읽을 수 있는 노드 수다.
//
// **이름이 그려질 배치에서만 이름의 자리를 잡아 둔다**(REQ-WEB-178). 먼저 동그라미로 떼어 놓고,
// 그 배치의 맞춤 배율이 이름이 나타나는 배율(`LABEL_ZOOM`) 이상이면 이름을 품은 상자로 한 번 더
// 떼어 놓는다. 그렇게 해서 배율이 그 아래로 내려가면 — 이름이 사라지는데 자리만 버린 것이므로 —
// 앞의 답으로 되돌린다. 그러고도 겹치는 이름은 **화면**이 가린다(`declutterLabels`).
//
// **같은 입력이면 같은 답이다**(REQ-WEB-245). 입력의 순서와도 무관하다 — 모든 반복을 id 순으로
// 돈다. [다른 배치]는 해시에 섞는 번호(`?layout=`)를 바꾼다.
import type cytoscape from 'cytoscape';

/** 영역 **안에서** 형제 사이에 남기는 간격(px) — 좁힐수록 그림이 커지고, 이름은 서로를 가린다 */
const LEAF_GAP = 16;
/** 뿌리에서 영역 상자를 늘어놓을 때의 간격(px) — 상자는 자기 여백을 이미 갖고 있어 더 좁다 */
const AREA_GAP = 12;
/** 영역 이름이 상자 위에 앉을 자리 — 실제로 잰 값을 쓰고, 재지 못할 때의 기본값이다 */
const AREA_LABEL = 16;
/** 영역 상자가 자식 주위에 두는 여백 — 마찬가지로 재서 쓰고, 이것은 재지 못할 때의 값이다 */
const AREA_PAD = 12;
/** 맞춤 여백 — 기본값(30)보다 좁힌다. 여백은 그림이 쓸 수 있었던 픽셀이다 */
const FIT_PADDING = 16;

/**
 * 문서가 차지하는 넓이 ÷ 무리가 차지하는 넓이 — **전체 보기의 크기와 형태 사이의 값**이다
 * (2026-09-27 — 사람 결정 S2). 올리면 그림이 촘촘해져 문서가 크게 그려지는 대신, 겹침을 더 크게
 * 풀어야 해서 형태가 조금씩 흔들린다. 0.25 → 0.3 에서 맞춤 배율은 5% 커지고 형태 유지율은
 * 0.01 안쪽으로만 달라졌다(합성 243 문서 · 줄였다 밀기를 넣기 전에 쟀다).
 */
export const LEAF_DENSITY = 0.3;
/** 뿌리에서 영역 상자들이 차지하는 넓이의 비율 — 상자는 속이 이미 비어 있어 더 촘촘히 둔다 */
const AREA_DENSITY = 0.5;
/**
 * 그림이 겨냥하는 모양(가로 ÷ 세로). **창 크기가 아니라 고정값이다** — 캔버스 모양을 겨냥하면
 * 창마다 다른 그림이 된다. 가로로 넓은 화면이 흔하므로 16:10 이다.
 */
export const TARGET_ASPECT = 1.6;
/**
 * 그 모양 쪽으로 얼마나 기울이는가 — 0.5 면 한 번에 가로·세로 비의 제곱근만큼 다가간다. 가로·세로를
 * 다르게 늘여도 좌우·위아래 순서는 그대로다. 약하게(0.25) 두었더니 clemvion 에서 그림이 거의
 * 정사각으로 남아 세로가 배율을 깎았다.
 */
const STRETCH_POWER = 0.5;
/**
 * 밀어낸 뒤 **고르게 줄였다가 다시 미는** 횟수와 한 번에 줄이는 비율. 넓혀 둔 무리를 조금 더
 * 다지는 일이고, 예전 다지기와 달리 **후보를 고르지 않는다** — 정해진 횟수만큼 하고 끝난 자리를
 * 쓴다. 두 번이면 clemvion 의 맞춤 배율이 0.56 → 0.64 가 되고 형태 유지율은 0.997 → 0.996 이었다.
 * 여덟 번이면 배율은 0.67 이지만 합성 데이터에서 영역의 좌우·위아래가 한 번에 30% 까지 뒤집혔다.
 */
const SQUEEZE_ROUNDS = 2;
const SQUEEZE = 0.94;
/** 스트레스를 몇 바퀴 푸는가 — 60 이면 기준 자리에서 충분히 가라앉는다 */
const STRESS_ROUNDS = 60;
/** 기준 자리에 묶는 힘(1 이면 관계와 기준이 같은 무게다) — 약하면 돌아가고, 강하면 관계를 못 따른다 */
const ANCHOR = 1;
/** 영역끼리의 작은 그림을 해시 자리에 묶는 힘 — 영역 하나가 늘어도 나머지가 돌지 않게 더 세게 묶는다 */
const AREA_ANCHOR = 2;
const AREA_ROUNDS = 200;
/** 영역끼리의 원하는 거리 = 반지름의 합 × (가까움 + 멂 × (1 − 관계의 세기)) */
const AREA_NEAR = 1.1;
const AREA_FAR = 1.5;
/** 부모가 다른 두 문서는 관계 거리를 이만큼 더 멀게 본다 — 영역이 한 덩어리로 모인다 */
const CROSS_PARENT = 1;
/** 겹침을 끝까지 푸는 반복 상한 */
const SPREAD_ROUNDS = 2000;
/** 이보다 얕은 겹침은 없는 것으로 본다(px) — 화면에서 보이지 않고, 부동소수점이 남기는 크기다 */
const OVERLAP_EPSILON = 1e-6;
/**
 * 기준 자리의 크기(모델 좌표) — 무리는 부모의 반지름(√잎 수에 비례) 안에, 문서는 √형제 수에 비례해
 * 흩는다. 처음에는 뿌리의 반지름을 그래프 크기와 무관한 고정값(700)으로 두었는데, 그러면 작은
 * 그래프일수록 무리가 필요 이상으로 흩어진다.
 */
const DOC_SPREAD = 30;

/**
 * 문서 이름의 글자 크기와 그것을 그리기 시작하는 배율 — **정본은 여기다.**
 *
 * `graph.tsx` 의 cytoscape 스타일이 이 값을 읽는다. 두 벌로 적으면 한쪽만 바뀌는 날
 * 배치는 "이름이 그려진다" 고 계산하고 화면은 그리지 않는다(또는 그 반대다).
 */
export const LABEL_FONT_SIZE = 9;
/** 고른 문서의 이름은 조금 크다 — 그래서 더 낮은 배율부터 읽힌다 */
export const PICKED_FONT_SIZE = 11;
/**
 * 이 배율부터 문서 이름을 그린다 — 배치가 이름의 자리를 잡아 둘지 가르는 문턱이기도 하다.
 *
 * **0.5 다**(2026-09-27 — 사람 결정 · REQ-WEB-095). 예전에는 "9px 이름이 화면에서 8px 이 되는
 * 배율"(0.889)이었는데, 문서가 수백 개인 프로젝트는 맞춤 배율이 0.43–0.53 이라 이름을 보려면
 * 한참 확대해야 했다. 이제 9px 이름이 화면에서 4.5px 이 되는 배율부터 그리고, 그러고도 겹치는
 * 이름은 `declutterLabels` 가 가린다.
 */
export const LABEL_ZOOM = 0.5;
/** 화면에서 이 크기(CSS px) 아래의 이름은 그리지 않는다 — 문서 이름이 `LABEL_ZOOM` 에서 닿는 크기다 */
export const LABEL_MIN_ZOOMED = LABEL_FONT_SIZE * LABEL_ZOOM;

/**
 * 이 글자가 화면에서 읽히는 크기인가 — **CSS 픽셀로 잰다**(REQ-WEB-095).
 *
 * cytoscape 의 `min-zoomed-font-size` 에 맡기지 않는다. 그 판정은 `글자 × 2^ceil(log2(배율 ×
 * 픽셀 비율))` 이라 픽셀 비율이 2 인 화면(Retina)에서는 배율 0.25 만 넘어도 그린다 — 맞춤
 * 배율(0.43–0.51)에서 모든 이름이 4px 짜리 얼룩으로 찍혔고, 이 파일은 "아직 안 그려진다" 고
 * 믿어 겹친 이름을 가리지도 않았다(2026-09-27 실측 · 스크린숏). 같은 문턱을 화면 종류와
 * 무관하게 쓰려고 이름을 감추는 일을 클래스(`tiny`)로 직접 한다.
 */
export function labelReadable(zoom: number, fontSize = LABEL_FONT_SIZE): boolean {
  return zoom * fontSize >= LABEL_MIN_ZOOMED;
}

// ── 배치 번호와 해시 ────────────────────────────────────────────────────────────

/** 기본 배치 번호 — 주소에 `?layout=` 이 없으면 이것이다 */
export const DEFAULT_LAYOUT = 1;

/**
 * 글자 하나로 정해지는 [0, 1) 의 수 — FNV-1a 에 murmur3 의 마무리 섞기를 더했다.
 *
 * 기준 자리는 **이 값 하나로만** 정해진다: 배치 번호와 자기 id 다. 공유하는 난수열이 없어서 다른
 * 문서가 늘거나 줄어도 한 문서의 출발점은 그대로다. 브라우저와 무관한 정수 연산이다.
 */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // id 는 앞부분이 같은 것이 많다(uuid v7) — 끝 글자 하나의 차이가 윗자리까지 번지게 섞는다
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── 계층 ────────────────────────────────────────────────────────────────────────

/**
 * 배치가 보는 계층 — id → 부모 id(뿌리면 `null`).
 *
 * **영역으로 묶지 않은 그림도 같은 계층으로 기준 자리를 잡는다.** 그러면 묶기를 켜고 끌 때도
 * 문서들이 같은 방향에 남는다. 그래서 그리는 쪽이 데이터의 부모를 건넨다 — 그림(cytoscape)의
 * compound 는 묶기를 끄면 사라지기 때문이다. 건네지 않으면 그림의 compound 를 쓴다.
 */
export type LayoutTree = ReadonlyMap<string, string | null>;

function treeOf(cy: cytoscape.Core): Map<string, string | null> {
  const tree = new Map<string, string | null>();
  cy.nodes().forEach((node) => {
    const parent: unknown = node.data('parent');
    tree.set(node.id(), typeof parent === 'string' ? parent : null);
  });
  return tree;
}

const byId = (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular): number =>
  a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0;

const byItemId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** 잎(compound 가 아닌 노드) — **id 순**이다. 모든 반복을 이 순서로 돌아야 입력 순서와 무관하다 */
function leavesOf(cy: cytoscape.Core): cytoscape.NodeSingular[] {
  const leaves: cytoscape.NodeSingular[] = [];
  cy.nodes().forEach((node) => {
    if (!node.isParent()) leaves.push(node);
  });
  return leaves.sort(byId);
}

/** 계층을 오르내리는 도구 — 계층이 고리를 이루는 잘못된 입력에서도 멈춘다 */
function hierarchy(tree: LayoutTree): {
  parentOf: (id: string) => string | null;
  rootOf: (id: string) => string;
  kids: Map<string, number>;
} {
  const parentOf = (id: string): string | null => tree.get(id) ?? null;
  const rootOf = (id: string): string => {
    let at = id;
    for (let depth = 0; depth < 64; depth += 1) {
      const up = parentOf(at);
      if (up === null) break;
      at = up;
    }
    return at;
  };
  const kids = new Map<string, number>();
  for (const parent of tree.values()) {
    if (parent !== null) kids.set(parent, (kids.get(parent) ?? 0) + 1);
  }
  return { parentOf, rootOf, kids };
}

// ── ① 기준 자리 ─────────────────────────────────────────────────────────────────

/**
 * 한 부모 아래 형제 무리(영역 · 영역에 들지 않은 문서)의 중심 — 형제끼리의 관계 수로 편 작은 그림.
 *
 * 무리를 해시 자리에만 두면 관계가 많은 두 영역이 반대편에 놓여 영역을 건너는 선이 길어진다.
 * 그래서 형제만의 그림(대개 열 개 안팎)을 한 번 편다. 원하는 거리는 두 무리의 반지름 합에서
 * 시작해 관계가 약할수록 멀어지고, **해시 자리에 묶어 둔다**(`AREA_ANCHOR`) — 새 영역이 하나
 * 생겨도 나머지가 돌지 않는다. 관계의 세기는 **두 무리의 크기에만 견준다**: 가장 많은 쌍에 견주면
 * 그 쌍이 바뀔 때 모든 거리가 함께 바뀐다.
 *
 * 뿌리에서 한 번, 안쪽 영역을 거느린 영역마다 한 번 돈다. 안쪽 영역을 해시로만 흩으면 관계를
 * 모르는 채로 놓인다 — 안쪽 영역 여덟을 둔 clemvion 에서 그렇게 했다가 관계 반영이 크게 나빴다.
 */
function groupCentres(
  cy: cytoscape.Core,
  seed: number,
  members: readonly string[],
  groupOf: (id: string) => string | null,
  size: ReadonlyMap<string, number>,
  centre: cytoscape.Position,
  ring: number,
): Map<string, cytoscape.Position> {
  const ids = [...members].sort();
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = new Float64Array(n * n);
  cy.edges().forEach((edge) => {
    const from = groupOf(edge.source().id());
    const to = groupOf(edge.target().id());
    const a = from === null ? undefined : index.get(from);
    const b = to === null ? undefined : index.get(to);
    if (a === undefined || b === undefined || a === b) return;
    links[a * n + b] = (links[a * n + b] ?? 0) + 1;
    links[b * n + a] = (links[b * n + a] ?? 0) + 1;
  });
  const count = ids.map((id) => size.get(id) ?? 1);
  const radius = count.map((c) => DOC_SPREAD * Math.sqrt(c));
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const AX = new Float64Array(n);
  const AY = new Float64Array(n);
  ids.forEach((id, i) => {
    const r = ring * Math.sqrt(0.2 + 0.8 * hash01(`${seed}:r:${id}`));
    const angle = 2 * Math.PI * hash01(`${seed}:a:${id}`);
    X[i] = AX[i] = centre.x + r * Math.cos(angle);
    Y[i] = AY[i] = centre.y + r * Math.sin(angle);
  });
  const want = new Float64Array(n * n);
  const weight = new Float64Array(n * n);
  const wsum = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const ci = count[i] ?? 1;
      const cj = count[j] ?? 1;
      const s = Math.min(1, (links[i * n + j] ?? 0) / (2 * Math.sqrt(ci * cj)));
      const d = ((radius[i] ?? 0) + (radius[j] ?? 0)) * (AREA_NEAR + AREA_FAR * (1 - s));
      want[i * n + j] = d;
      weight[i * n + j] = (0.2 + s) / (d * d);
      wsum[i] = (wsum[i] ?? 0) + (0.2 + s) / (d * d);
    }
  }
  for (let round = 0; round < AREA_ROUNDS && n > 1; round += 1) {
    for (let i = 0; i < n; i += 1) {
      const xi = X[i] ?? 0;
      const yi = Y[i] ?? 0;
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const w = weight[i * n + j] ?? 0;
        const d = want[i * n + j] ?? 0;
        const xj = X[j] ?? 0;
        const yj = Y[j] ?? 0;
        const dist = Math.hypot(xi - xj, yi - yj) || 1e-6;
        sx += w * (xj + (d * (xi - xj)) / dist);
        sy += w * (yj + (d * (yi - yj)) / dist);
      }
      const hold = AREA_ANCHOR * (wsum[i] ?? 0);
      const total = (wsum[i] ?? 0) + hold;
      X[i] = (sx + hold * (AX[i] ?? 0)) / total;
      Y[i] = (sy + hold * (AY[i] ?? 0)) / total;
    }
  }
  return new Map(ids.map((id, i) => [id, { x: X[i] ?? 0, y: Y[i] ?? 0 }]));
}

/**
 * 잎마다의 출발점 — 배치 번호 · 자기 id · 부모의 자리로만 정해진다.
 *
 * 영역의 중심은 위에서부터 정한다: 뿌리 무리를 `groupCentres` 로 펴고, 안쪽 영역을 거느린 영역마다
 * 그 안쪽 영역들을 다시 편다(부모 중심 둘레, 부모의 반지름 안). 문서는 자기 영역 중심 둘레의 한
 * 점(반지름 ∝ √형제 수)이다. 영역으로 묶지 않은 그림에서 영역 노드는 잎이지만 자식을 가진다 —
 * 그때는 자기 자식들의 한가운데에 둔다.
 */
export function referencePositions(
  cy: cytoscape.Core,
  seed: number = DEFAULT_LAYOUT,
  tree: LayoutTree = treeOf(cy),
): Map<string, cytoscape.Position> {
  const leaves = leavesOf(cy);
  const { parentOf, kids } = hierarchy(tree);
  // 뿌리부터 자기까지의 길 — 무리를 나눌 때 "이 부모 바로 아래의 누구 편인가" 를 읽는다
  const paths = new Map<string, string[]>();
  const pathOf = (id: string): string[] => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const path = [id];
    let up = parentOf(id);
    for (let depth = 0; up !== null && depth < 64; depth += 1) {
      path.unshift(up);
      up = parentOf(up);
    }
    paths.set(id, path);
    return path;
  };
  // 무리의 크기 = 그 아래 잎의 수
  const size = new Map<string, number>();
  for (const leaf of leaves) {
    for (const id of pathOf(leaf.id())) size.set(id, (size.get(id) ?? 0) + 1);
  }
  const children = new Map<string, string[]>();
  for (const [id, parent] of tree) {
    if (parent === null || !kids.has(id)) continue;
    const list = children.get(parent) ?? [];
    list.push(id);
    children.set(parent, list);
  }
  /** `parent` 바로 아래에서 `id` 가 속한 무리(뿌리에서는 `parent` 가 `null`) */
  const branchOf =
    (parent: string | null) =>
    (id: string): string | null => {
      const path = pathOf(id);
      if (parent === null) return path[0] ?? null;
      const at = path.indexOf(parent);
      return at < 0 ? null : (path[at + 1] ?? null);
    };
  const centres = new Map<string, cytoscape.Position>();
  const lay = (parent: string | null, members: readonly string[]): void => {
    if (members.length === 0) return;
    const centre = parent === null ? { x: 0, y: 0 } : (centres.get(parent) ?? { x: 0, y: 0 });
    const ring = DOC_SPREAD * Math.sqrt(parent === null ? leaves.length : (size.get(parent) ?? 1));
    const placed = groupCentres(cy, seed, members, branchOf(parent), size, centre, ring);
    for (const [id, at] of placed) centres.set(id, at);
    for (const id of [...members].sort()) lay(id, children.get(id) ?? []);
  };
  lay(null, [...new Set(leaves.map((leaf) => pathOf(leaf.id())[0] ?? leaf.id()))]);
  const out = new Map<string, cytoscape.Position>();
  for (const leaf of leaves) {
    const id = leaf.id();
    const own = centres.get(id);
    if (own !== undefined) {
      out.set(id, own);
      continue;
    }
    const parent = parentOf(id);
    const base = (parent === null ? undefined : centres.get(parent)) ?? { x: 0, y: 0 };
    const spread = DOC_SPREAD * Math.sqrt(parent === null ? 1 : (kids.get(parent) ?? 1));
    const r = spread * Math.sqrt(hash01(`${seed}:lr:${id}`));
    const angle = 2 * Math.PI * hash01(`${seed}:la:${id}`);
    out.set(id, { x: base.x + r * Math.cos(angle), y: base.y + r * Math.sin(angle) });
  }
  return out;
}

// ── ② 관계로 다듬기 ─────────────────────────────────────────────────────────────

/**
 * 기준 자리에 묶은 스트레스 배치(Gansner·Koren·North 의 stress majorization 에 닻을 단 것 —
 * Brandes·Mader 2011 이 "anchoring" 으로 견준 방법이다).
 *
 * 두 문서 사이의 목표 거리는 **관계 거리**(몇 번 건너 닿는가)에 길이 하나를 곱한 것이다. 부모가
 * 다르면 한 칸 더 멀게 보고(`CROSS_PARENT`), 이어지지 않은 쌍은 가장 먼 거리보다 한 칸 더다.
 * 길이는 기준 자리에 가장 잘 맞는 값으로 고른다 — 그래서 닻과 스트레스가 서로 다른 크기를 당기지
 * 않는다. 풀 때마다 각 문서를 "관계가 원하는 자리" 와 "기준 자리" 의 가중 평균으로 옮긴다
 * (Gauss–Seidel · id 순).
 *
 * 비용은 문서 수의 제곱이다 — 거리표가 n² 칸(Uint16)이고 한 바퀴가 n² 쌍이다. 합성 1,000 문서에서
 * 배치 전체가 1.2초(fcose 는 2.7초)였다. 수천 문서로 가면 일부 문서만 기준으로 쓰는
 * 희소 스트레스로 바꿔야 한다 — 4.1 §2 의 재검토 트리거("여는 데 1초 초과")가 그 신호다.
 */
export function anchoredStress(
  cy: cytoscape.Core,
  reference: ReadonlyMap<string, cytoscape.Position>,
  tree: LayoutTree = treeOf(cy),
): void {
  const leaves = leavesOf(cy);
  const n = leaves.length;
  const ids = leaves.map((leaf) => leaf.id());
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  ids.forEach((id, i) => {
    const at = reference.get(id) ?? { x: 0, y: 0 };
    X[i] = at.x;
    Y[i] = at.y;
  });
  if (n >= 2) {
    const AX = Float64Array.from(X);
    const AY = Float64Array.from(Y);
    const index = new Map(ids.map((id, i) => [id, i]));
    const neighbours: number[][] = ids.map(() => []);
    cy.edges().forEach((edge) => {
      const a = index.get(edge.source().id());
      const b = index.get(edge.target().id());
      if (a === undefined || b === undefined || a === b) return;
      neighbours[a]?.push(b);
      neighbours[b]?.push(a);
    });
    // 관계 거리 — 문서마다 한 번씩 넓이 우선 탐색
    const hops = new Uint16Array(n * n);
    const row = new Int32Array(n);
    const queue = new Int32Array(n);
    let farthest = 0;
    for (let s = 0; s < n; s += 1) {
      row.fill(-1);
      row[s] = 0;
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      while (head < tail) {
        const u = queue[head++] ?? 0;
        const next = (row[u] ?? 0) + 1;
        for (const v of neighbours[u] ?? []) {
          if ((row[v] ?? 0) >= 0) continue;
          row[v] = next;
          queue[tail++] = v;
        }
      }
      for (let j = 0; j < n; j += 1) {
        const d = row[j] ?? -1;
        hops[s * n + j] = d < 0 ? 0xffff : d;
        if (d > farthest) farthest = d;
      }
    }
    const { parentOf } = hierarchy(tree);
    const parents = ids.map((id) => parentOf(id));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const raw = hops[i * n + j] ?? 0;
        const d = raw === 0xffff ? farthest + 1 : raw;
        hops[i * n + j] = d + (parents[i] === parents[j] ? 0 : CROSS_PARENT);
      }
    }
    // 길이 — 기준 자리에 가장 잘 맞는 값(가중 최소제곱)
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const d = hops[i * n + j] ?? 1;
        const w = 1 / (d * d);
        num += w * d * Math.hypot((X[i] ?? 0) - (X[j] ?? 0), (Y[i] ?? 0) - (Y[j] ?? 0));
        den += w * d * d;
      }
    }
    const unit = den > 0 && num > 0 ? num / den : 1;
    const wsum = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const d = hops[i * n + j] ?? 1;
        s += 1 / (d * d);
      }
      wsum[i] = s;
    }
    for (let round = 0; round < STRESS_ROUNDS; round += 1) {
      for (let i = 0; i < n; i += 1) {
        const xi = X[i] ?? 0;
        const yi = Y[i] ?? 0;
        let sx = 0;
        let sy = 0;
        for (let j = 0; j < n; j += 1) {
          if (j === i) continue;
          const d = hops[i * n + j] ?? 1;
          const w = 1 / (d * d);
          const xj = X[j] ?? 0;
          const yj = Y[j] ?? 0;
          const dist = Math.hypot(xi - xj, yi - yj) || 1e-6;
          sx += w * (xj + (unit * d * (xi - xj)) / dist);
          sy += w * (yj + (unit * d * (yi - yj)) / dist);
        }
        const hold = ANCHOR * (wsum[i] ?? 0);
        const total = (wsum[i] ?? 0) + hold;
        X[i] = (sx + hold * (AX[i] ?? 0)) / total;
        Y[i] = (sy + hold * (AY[i] ?? 0)) / total;
      }
    }
  }
  cy.batch(() => {
    leaves.forEach((leaf, i) => leaf.position({ x: X[i] ?? 0, y: Y[i] ?? 0 }));
  });
}

// ── ③ 방향을 지키는 겹침 풀기 ───────────────────────────────────────────────────

/** 정리가 다루는 최소 단위 — 잎 노드 하나이거나, 영역 상자 하나다 */
export interface PackItem {
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/** 밀어내기가 다루는 조각 — 잎은 동그라미(`round`)이고 영역·이름 상자는 네모다 */
export interface SpreadItem extends PackItem {
  id: string;
  round: boolean;
  /** 영역 상자(또는 보이지 않는 무리)인가 — 속이 이미 비어 있어 더 촘촘히 둔다(`AREA_DENSITY`) */
  box?: boolean;
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

/** 두 조각이 겹치지 않으려면 (단위 방향 ux,uy 로) 중심 사이가 얼마나 떨어져야 하는가 */
function clearance(a: SpreadItem, b: SpreadItem, ux: number, uy: number, gap: number): number {
  if (a.round && b.round) return (a.w + b.w) / 2 + gap;
  const tx = Math.abs(ux) > 1e-9 ? ((a.w + b.w) / 2 + gap) / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-9 ? ((a.h + b.h) / 2 + gap) / Math.abs(uy) : Infinity;
  return Math.min(tx, ty);
}

/**
 * 겹친 둘을 **두 중심을 잇는 선을 따라** 반씩 물러나게 한다 — 그 쌍의 방향은 그대로다.
 *
 * 예전의 밀어내기는 짧은 축(가로 또는 세로)으로 밀었다. 이동은 가장 적지만, 비스듬히 놓인 둘을
 * 가로로 밀면 방향이 바뀌고 입력이 조금만 달라도 미는 축이 바뀌었다. 중심이 정확히 같으면 방향이
 * 없으므로 두 id 의 해시로 정한다(같은 입력이면 같은 답이다).
 *
 * 돌려주는 값은 **남은 가장 깊은 겹침**이다 — 0 이면 더 볼 것이 없다.
 */
export function spread(items: readonly SpreadItem[], gap: number, rounds: number): number {
  let worst = 0;
  for (let round = 0; round < rounds; round += 1) {
    worst = 0;
    for (let i = 0; i < items.length; i += 1) {
      const a = items[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < items.length; j += 1) {
        const b = items[j];
        if (b === undefined) continue;
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        let d = Math.hypot(dx, dy);
        if (d < 1e-9) {
          const angle = 2 * Math.PI * hash01(`${a.id}|${b.id}`);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 0;
        }
        const length = Math.hypot(dx, dy);
        const ux = dx / length;
        const uy = dy / length;
        const over = clearance(a, b, ux, uy, gap) - d;
        if (over <= OVERLAP_EPSILON) continue;
        if (over > worst) worst = over;
        a.cx -= (ux * over) / 2;
        a.cy -= (uy * over) / 2;
        b.cx += (ux * over) / 2;
        b.cy += (uy * over) / 2;
      }
    }
    if (worst === 0) break;
  }
  return worst;
}

/**
 * 한 무리를 정리한다 — **고른 비율로** 밀도를 맞추고, 겹친 것만 중심선을 따라 떼어 놓는다.
 *
 * 먼저 넓히는 까닭: 겹침을 크게 풀수록 형태를 잃는다. 관계로 다듬은 그림은 대개 촘촘해서(관계가
 * 많은 그래프는 가운데로 모인다) 그대로 밀면 거의 모든 쌍이 움직인다. 고른 비율로 넓히면 방향은
 * 하나도 바뀌지 않고, 밀어내기는 조금만 움직인다. 비율은 입력의 연속 함수라 데이터가 조금 바뀌면
 * 조금만 바뀐다 — **후보를 여럿 만들어 고르지 않는 것**이 요점이다.
 *
 * 순서: 밀도 맞추기 → (`aspect` 가 있으면) 넓이를 지킨 채 그 모양 쪽으로 기울이기 → 밀어내기 →
 * 고르게 줄였다 다시 밀기 `SQUEEZE_ROUNDS` 번 → 남은 여유를 고르게 거두기(`tighten`). 돌려주는 값은
 * 남은 가장 깊은 겹침이다 — 0 이 아니면 밀어내기가 반복 상한 안에 풀지 못한 것이다.
 */
export function settle(
  items: readonly SpreadItem[],
  gap: number,
  density: number,
  aspect: number | null = null,
): number {
  if (items.length < 2) return 0;
  const mx = items.reduce((sum, it) => sum + it.cx, 0) / items.length;
  const my = items.reduce((sum, it) => sum + it.cy, 0) / items.length;
  const before = extent(items);
  // 무리가 차지해야 할 넓이 — 문서는 `density`, 상자는 `AREA_DENSITY` 로 센다. 상자를 문서처럼
  // 세면 안쪽 영역을 거느린 영역이 텅 빈다(clemvion 실측: 안쪽 영역 여덟을 둔 영역)
  const need = items.reduce(
    (sum, it) => sum + (it.w * it.h) / (it.box === true ? AREA_DENSITY : density),
    0,
  );
  const k = Math.sqrt(need / Math.max(1, before.w * before.h));
  for (const it of items) {
    it.cx = mx + (it.cx - mx) * k;
    it.cy = my + (it.cy - my) * k;
  }
  if (aspect !== null) {
    const now = extent(items);
    if (now.w > 0 && now.h > 0) {
      const kx = Math.pow(aspect / (now.w / now.h), STRETCH_POWER);
      for (const it of items) {
        it.cx = mx + (it.cx - mx) * kx;
        it.cy = my + (it.cy - my) / kx;
      }
    }
  }
  const left = spread(items, gap, SPREAD_ROUNDS);
  if (left > 0) return left;
  for (let round = 0; round < SQUEEZE_ROUNDS; round += 1) {
    const saved = items.map((it) => [it.cx, it.cy] as const);
    const bb = extent(items);
    for (const it of items) {
      it.cx = bb.cx + (it.cx - bb.cx) * SQUEEZE;
      it.cy = bb.cy + (it.cy - bb.cy) * SQUEEZE;
    }
    // 줄였더니 풀리지 않으면 줄이기 전으로 — 겹치지 않는 것이 작은 것보다 먼저다
    if (spread(items, gap, SPREAD_ROUNDS) > 0) {
      items.forEach((it, i) => {
        const at = saved[i];
        if (at !== undefined) [it.cx, it.cy] = at;
      });
      break;
    }
  }
  tighten(items, gap);
  return 0;
}

/**
 * 밀어낸 뒤 남은 여유를 **고른 비율로** 거둔다 — 가장 가까운 한 쌍이 맞닿을 때까지 좁힌다.
 * 모든 쌍의 방향이 그대로이고, 줄이는 비율은 자리의 연속 함수다(가장 빠듯한 쌍이 정한다).
 */
function tighten(items: readonly SpreadItem[], gap: number): void {
  let scale = 0;
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j];
      if (b === undefined) continue;
      const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      if (d < 1e-9) return;
      scale = Math.max(scale, clearance(a, b, (b.cx - a.cx) / d, (b.cy - a.cy) / d, gap) / d);
    }
  }
  if (!(scale > 0 && scale < 1)) return;
  const mx = items.reduce((sum, it) => sum + it.cx, 0) / items.length;
  const my = items.reduce((sum, it) => sum + it.cy, 0) / items.length;
  // 부동소수점으로 맞닿은 쌍이 1e-12 만큼 겹치지 않게 아주 조금 덜 좁힌다
  const k = scale * (1 + 1e-9);
  for (const it of items) {
    it.cx = mx + (it.cx - mx) * k;
    it.cy = my + (it.cy - my) * k;
  }
}

/** 정리가 들고 다니는 한 조각 — 잎이면 `kids` 가 없다 */
interface GraphItem extends SpreadItem {
  /** 잎이면 그 노드, 영역 상자면 그 compound, 묶지 않은 그림의 보이지 않는 무리면 `null` */
  node: cytoscape.NodeSingular | null;
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
 * 놓인 자식의 이름이 상자를 그만큼 밀어낸다. 화면은 배율이 낮으면 이름을 그리지 않지만
 * (REQ-WEB-095) **상자 크기는 배율과 무관하게 그 자리를 잡아 둔다.**
 *
 * 그래서 넷을 따로 잰다. 한 값으로 뭉뚱그려 네 면에 다 주면 — 처음에 그렇게 했다 — 위아래가
 * 좌우만큼 부풀어 영역 하나가 90px 씩 커지고, 그 낭비가 열여섯 개 쌓인다(실측 2026-09-22).
 * 이름의 튀어나옴은 **자식 중 가장 심한 것**으로 잡는다: 정리하고 나면 어느 자식이 가장자리에
 * 놓일지 달라지므로, 지금 가장자리에 놓인 자식만 보면 그 뒤에 상자가 모자란다.
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
  // **이름의 자리를 두 번 세지 않는다.** 잎이 이름을 품고 떼어 놓으면 자식들의 extent 가 이미
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

function leafItem(node: cytoscape.NodeSingular, withLabels: boolean): GraphItem {
  const box = node.boundingBox({ includeLabels: withLabels });
  const at = node.position();
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  // 이름 없이 잴 때는 상자가 노드에 딱 맞아 어긋남이 0 이고, 노드는 동그라미로 떼어 놓는다
  return {
    id: node.id(),
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
    round: !withLabels,
  };
}

/** 자식들을 정리하고 그 무리를 한 조각으로 만든다 — 자식의 자리는 무리 중심에서의 상대 위치로 들고 다닌다 */
function groupItem(
  id: string,
  node: cytoscape.NodeSingular | null,
  kids: GraphItem[],
  inset: AreaInset,
): GraphItem {
  kids.sort(byItemId);
  settle(kids, LEAF_GAP, LEAF_DENSITY);
  const bb = extent(kids);
  const cx = bb.cx;
  const cy = bb.cy + (inset.bottom - inset.top) / 2;
  for (const kid of kids) {
    kid.rx = kid.cx - cx;
    kid.ry = kid.cy - cy;
  }
  const w = bb.w + 2 * inset.x;
  const h = bb.h + inset.top + inset.bottom;
  return { id, node, kids, w, h, cx, cy, rx: 0, ry: 0, ox: 0, oy: 0, round: false, box: true };
}

/**
 * 한 노드와 그 아래를 한 조각으로 — 영역 상자면 자식들을, **영역으로 묶지 않은 그림의 영역
 * 노드**면 자기와 자기 문서들을 한 무리로 정리한다(상자는 그리지 않는다).
 *
 * 묶지 않은 그림을 문서 수백 개의 한 무리로 정리하면 겹침을 크게 풀어야 해서 형태를 잃고
 * 느렸다(합성 243 문서: 형태 유지율 0.46–0.62 · 한 번에 1–2.5초). 보이지 않는 무리로 나누면
 * 묶은 그림과 같은 성질이 되고, 묶기를 켜고 꺼도 문서들이 같은 방향에 남는다.
 */
function toItem(
  node: cytoscape.NodeSingular,
  withLabels: boolean,
  childrenOf: ReadonlyMap<string, cytoscape.NodeSingular[]>,
): GraphItem {
  if (node.isParent()) {
    const kids = node.children().map((kid) => toItem(kid, withLabels, childrenOf));
    return groupItem(node.id(), node, kids, insetOf(node, withLabels));
  }
  const members = childrenOf.get(node.id());
  if (members === undefined || members.length === 0) return leafItem(node, withLabels);
  const kids = [
    leafItem(node, withLabels),
    ...members.map((kid) => toItem(kid, withLabels, childrenOf)),
  ];
  return groupItem(node.id(), null, kids, { x: AREA_PAD, top: AREA_PAD, bottom: AREA_PAD });
}

function place(item: GraphItem): void {
  if (item.kids === null) {
    item.node?.position({ x: item.cx + item.ox, y: item.cy + item.oy });
    return;
  }
  for (const kid of item.kids) {
    kid.cx = item.cx + kid.rx;
    kid.cy = item.cy + kid.ry;
    place(kid);
  }
}

/**
 * 관계로 다듬은 그림에서 겹침을 푼다 — **형제끼리 겹치지 않게, 방향은 그대로**(REQ-WEB-174).
 *
 * 깊은 곳부터 올라온다: 안쪽을 먼저 정리해야 바깥 상자가 실제 크기로 자리를 잡는다. 옮기는 것은
 * 잎 노드의 좌표뿐이고, 영역 상자는 자식을 감싼 자국이라 따라온다. 뿌리에서는 그림을
 * `TARGET_ASPECT` 쪽으로 조금 기울인다 — 창 크기를 보지 않으므로 어느 화면에서나 같은 그림이다.
 */
export function separate(
  cy: cytoscape.Core,
  withLabels = false,
  tree: LayoutTree = treeOf(cy),
): void {
  // 그림에 없는 부모는 없는 것으로 본다 — 부모가 화면 밖이면 그 문서는 뿌리다
  const present = (id: string | null): cytoscape.NodeSingular | null => {
    if (id === null) return null;
    const node = cy.getElementById(id);
    return node.nonempty() && node.isNode() ? node : null;
  };
  const childrenOf = new Map<string, cytoscape.NodeSingular[]>();
  const roots: GraphItem[] = [];
  cy.nodes().forEach((node) => {
    const parent = present(tree.get(node.id()) ?? null);
    if (parent === null || node.parent().nonempty()) return;
    const list = childrenOf.get(parent.id()) ?? [];
    list.push(node);
    childrenOf.set(parent.id(), list);
  });
  cy.nodes().forEach((node) => {
    if (node.parent().nonempty()) return;
    if (present(tree.get(node.id()) ?? null) !== null) return;
    roots.push(toItem(node, withLabels, childrenOf));
  });
  if (roots.length === 0) return;
  roots.sort(byItemId);
  const docsOnly = roots.every((root) => root.kids === null);
  settle(roots, docsOnly ? LEAF_GAP : AREA_GAP, LEAF_DENSITY, TARGET_ASPECT);
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

/**
 * 이름이 그려질 배치라면 **이름의 자리까지** 잡아 두고 다시 떼어 놓는다(REQ-WEB-178).
 *
 * 순서가 이 함수의 전부다. 먼저 동그라미로 떼어 놓고 그 배치의 맞춤 배율이 문턱을 넘을 때에만 —
 * 즉 **이름이 실제로 그려질 때에만** — 이름을 품은 상자로 한 번 더 한다. 이름의 자리는 공짜가
 * 아니라서(`'text-max-width': '90px'` 는 노드 지름의 서너 배다) 그리지도 않을 이름 때문에 그림을
 * 넓히면 노드만 작아진다. 자리를 잡았더니 배율이 문턱 **아래로** 내려갔다면 이름은 어차피
 * 사라지므로 그 답을 쓰지 않는다.
 *
 * **관계로 다듬은 자리에서 다시 시작한다** — 이미 떼어 놓은 자리 위에서 또 하면 두 번째 답이
 * 첫 번째의 넓힘을 물려받아 두 번 넓어진다.
 */
function separateForLabels(
  cy: cytoscape.Core,
  stressAt: ReadonlyMap<string, cytoscape.Position>,
  tree: LayoutTree,
): void {
  if (fitZoomOf(cy) < LABEL_ZOOM) return;
  const bareAt = leafPositions(cy);
  applyLeafPositions(cy, stressAt);
  separate(cy, true, tree);
  if (fitZoomOf(cy) < LABEL_ZOOM) applyLeafPositions(cy, bareAt);
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
 * 이름의 상태를 정한다 — **작아서 못 읽는 것**(`tiny`)과 **가려서 못 읽는 것**(`crowded`).
 * 배치가 아니라 **화면**의 일이다(REQ-WEB-095 개정).
 *
 * 재는 것은 모델 좌표가 아니라 **화면 좌표**다 — 읽을 수 있느냐는 화면의 성질이다.
 * 다만 이름은 그림과 **함께** 커지므로(cytoscape 의 `font-size` 는 모델 크기다) 배율은
 * 문턱(`labelReadable`)을 넘나들 때만 답을 바꾼다. 그 밖에 답을 바꾸는 것은 노드를 끄는 일과,
 * 하나를 골라 나머지를 가라앉히는 일이다.
 *
 * 셋을 건너뛴다 — **영역 이름**(지도의 지명이라 배율과 무관하게 남는다 · REQ-WEB-095) ·
 * **가라앉은 노드**(이미 안 보이므로 자리를 다투지 않는다. 그래서 하나를 고르면 그 이웃의
 * 이름이 되살아난다) · **이름이 없는 노드**.
 *
 * **바뀐 노드의 클래스만 건드린다**(2026-09-27). 전체를 다시 칠하면 WebGL 렌더러는 클래스가
 * 그대로여도 한 장면을 통째로 다시 그렸다 — 확대 중 초당 116 장이 48 장이 됐다(실측).
 */
export function declutterLabels(cy: cytoscape.Core): void {
  const zoom = cy.zoom();
  const drawn = labelReadable(zoom);
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
  const changes: [cytoscape.NodeSingular, string, boolean][] = [];
  cy.nodes().forEach((node) => {
    const crowded = hidden.has(node.id());
    if (node.hasClass('crowded') !== crowded) changes.push([node, 'crowded', crowded]);
    if (node.isParent()) return;
    const tiny = !labelReadable(zoom, node.hasClass('picked') ? PICKED_FONT_SIZE : LABEL_FONT_SIZE);
    if (node.hasClass('tiny') !== tiny) changes.push([node, 'tiny', tiny]);
  });
  if (changes.length === 0) return;
  cy.batch(() => {
    for (const [node, name, on] of changes) node.toggleClass(name, on);
  });
}

/**
 * 배율이 이름의 답을 바꾸는가 — 확대 중에는 이 값이 달라질 때만 이름을 다시 센다.
 * (이름은 그림과 함께 커지므로 문턱을 넘나들 때만 누가 보이는지가 바뀐다)
 */
export function labelZoomState(zoom: number): string {
  return `${labelReadable(zoom)}|${labelReadable(zoom, PICKED_FONT_SIZE)}`;
}

/** 잎 노드의 자리 — 영역 상자는 자식을 감싼 자국이라 적지 않는다(부모를 옮기면 자식이 따라 움직인다) */
export function leafPositions(cy: cytoscape.Core): Map<string, cytoscape.Position> {
  const at = new Map<string, cytoscape.Position>();
  cy.nodes().forEach((node) => {
    if (!node.isParent()) at.set(node.id(), { ...node.position() });
  });
  return at;
}

/**
 * 적어 둔 자리로 되돌린다 — **모든 잎의 자리가 있을 때만** 쓴다. 하나라도 빠지면 그 노드가
 * 원점에 남아 그림 한가운데 엉뚱한 점이 생기므로, 그때는 `false` 를 돌려주고 새로 계산하게 한다.
 */
export function applyLeafPositions(
  cy: cytoscape.Core,
  saved: ReadonlyMap<string, cytoscape.Position>,
): boolean {
  let complete = true;
  cy.nodes().forEach((node) => {
    if (!node.isParent() && !saved.has(node.id())) complete = false;
  });
  if (!complete) return false;
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const at = node.isParent() ? undefined : saved.get(node.id());
      if (at !== undefined) node.position(at);
    });
  });
  return true;
}

/** 배치를 끝낸 뒤 화면에 맞추고 이름을 정한다 — 새로 계산한 때와 적어 둔 자리를 쓴 때가 같은 길이다 */
export function fitAndLabel(cy: cytoscape.Core): void {
  cy.fit(undefined, FIT_PADDING);
  declutterLabels(cy);
}

/**
 * 배치를 계산하고 겹침을 푼 뒤 화면에 맞춘다 — 첫 그림과 [다른 배치]가 같은 길을 지난다.
 * 모두 동기로 끝난다(`onDone` 은 이 함수가 돌아오기 전에 불린다).
 *
 * `onDone` 은 정리까지 끝난 잎의 자리를 받는다 — 그리는 쪽이 그것을 적어 두었다가 다음에
 * 같은 입력이면 계산을 건너뛴다(`layout-cache.ts`). `tree` 는 기준 자리를 잡을 계층이다
 * (`LayoutTree` — 주지 않으면 그림의 compound 를 쓴다).
 */
export function runLayout(
  cy: cytoscape.Core,
  seed: number = DEFAULT_LAYOUT,
  onDone?: (positions: Map<string, cytoscape.Position>) => void,
  tree: LayoutTree = treeOf(cy),
): void {
  anchoredStress(cy, referencePositions(cy, seed, tree), tree);
  const stressAt = leafPositions(cy);
  separate(cy, false, tree);
  separateForLabels(cy, stressAt, tree);
  onDone?.(leafPositions(cy));
  fitAndLabel(cy);
}
