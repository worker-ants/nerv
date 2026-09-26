// 관계 그래프의 입력 지문과 배치 기억 — 정본: docs/04-mvp/screens.md §2.4a (REQ-WEB-245)
//
// **지문은 배치를 바꾸는 것만 담는다.** 노드 id · 부모(영역으로 묶을 때) · 간선의 두 끝이다.
// 제목 · 상태 · 열린 코멘트 수는 넣지 않는다 — 에이전트가 초안을 저장할 때마다 그래프 질의가
// 다시 오는데(스펙 이벤트가 무효화한다), 그때마다 그림을 부수고 새로 배치하면 보던 자리가
// 사라진다. 지문이 같으면 그리는 쪽은 글자와 색만 갈아 끼운다.
//
// **기억은 다시 계산한 것과 같다.** 배치가 결정적이므로(같은 입력 · 같은 번호 · 같은 캔버스면
// 같은 자리 — `layout.ts` `withSeed`) 적어 둔 자리는 새로 계산할 자리와 다르지 않다. 그래서
// 사람마다 다른 그림이 되지 않는다(§2.4a 가 서버 저장을 막은 이유가 그것이었다). 건너뛰는 것은
// fcose 와 정리 패스다 — 합성 243 문서 · 3,036 관계에서 0.6–0.7초.
//
// 열쇠에 **제목**과 **캔버스 크기**가 드는 이유: 이름이 그려질 만큼 작은 그래프는 이름의 자리까지
// 떼어 놓고(`compactForLabels`), 정리 패스는 캔버스 모양을 겨냥한다. 둘이 다르면 계산한 답도
// 다르므로 같은 열쇠를 쓰면 안 된다.

/** 지문에 드는 노드 — 영역으로 묶지 않으면 부모는 배치에 들지 않는다 */
export interface FingerprintNode {
  id: string;
  parent: string | null;
}
export interface FingerprintEdge {
  from: string;
  to: string;
}

/**
 * 53비트 해시(cyrb53) — 캐시의 열쇠와 지문에만 쓴다. 암호가 아니고, 충돌해도 틀린 자리를
 * 쓰는 대신 모든 잎이 있는지부터 보므로(`applyLeafPositions`) 노드 집합이 다르면 새로 계산한다.
 */
export function hash53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * 배치를 바꾸는 입력의 지문 — **순서와 무관하다**(정렬해서 센다).
 * 크기(피참조 수)는 간선에서 나오므로 따로 넣지 않는다.
 */
export function graphFingerprint(
  nodes: readonly FingerprintNode[],
  edges: readonly FingerprintEdge[],
): string {
  const n = nodes.map((node) => `${node.id}<${node.parent ?? ''}`).sort();
  const e = edges.map((edge) => `${edge.from}>${edge.to}`).sort();
  return `${n.length}.${e.length}.${hash53(`${n.join('|')}#${e.join('|')}`)}`;
}

/** 캐시의 열쇠 — 지문 · 배치 번호 · 캔버스 크기 · 제목 */
export function layoutCacheKey(input: {
  fingerprint: string;
  seed: number;
  width: number;
  height: number;
  titles: readonly string[];
}): string {
  const titles = hash53([...input.titles].sort().join('\u0000'));
  return `${input.fingerprint}:${input.seed}:${Math.round(input.width)}x${Math.round(input.height)}:${titles}`;
}

const STORAGE_KEY = 'nerv.graph.layout.v1';
/** 적어 두는 그림의 수 — 243 문서 한 벌이 12KB 남짓이다 */
export const LAYOUT_CACHE_LIMIT = 8;

interface Stored {
  k: string;
  /** [id, x, y] — 소수 한 자리로 줄여 적는다(0.1px 는 화면에서 보이지 않는다) */
  p: [string, number, number][];
}

function readAll(): Stored[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Stored[]) : [];
  } catch {
    return [];
  }
}

/** 적어 둔 자리 — 없거나 읽을 수 없으면 `null`(새로 계산한다) */
export function readCachedLayout(key: string): Map<string, { x: number; y: number }> | null {
  const hit = readAll().find((entry) => entry.k === key);
  if (hit === undefined || !Array.isArray(hit.p)) return null;
  return new Map(hit.p.map(([id, x, y]) => [id, { x, y }]));
}

/** 방금 계산한 자리를 맨 앞에 적는다 — 오래 안 쓴 것부터 밀려난다 */
export function writeCachedLayout(
  key: string,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): void {
  const entry: Stored = {
    k: key,
    p: [...positions].map(([id, at]) => [
      id,
      Math.round(at.x * 10) / 10,
      Math.round(at.y * 10) / 10,
    ]),
  };
  const next = [entry, ...readAll().filter((old) => old.k !== key)].slice(0, LAYOUT_CACHE_LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장소가 막혔거나 가득 찼다 — 기억은 편의일 뿐이라 다음에 다시 계산하면 된다
  }
}

/**
 * 그림의 서명 — 잎 자리를 반올림해 해시한 것. 화면(`data-layout`)에 걸어 두면 E2E 가
 * "새로 고쳐도 같은 그림인가" 를 캔버스 안을 들여다보지 않고 잰다.
 */
export function layoutSignature(positions: ReadonlyMap<string, { x: number; y: number }>): string {
  // 기억은 0.1px 로 줄여 적으므로, 새로 계산한 자리도 같은 단계를 거쳐야 둘의 서명이 같다
  const px = (v: number): number => Math.round(Math.round(v * 10) / 10);
  const parts = [...positions]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, at]) => `${id}@${px(at.x)},${px(at.y)}`);
  return hash53(parts.join('|'));
}
