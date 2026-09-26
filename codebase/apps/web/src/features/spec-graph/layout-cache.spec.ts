// 관계 그래프의 입력 지문과 배치 기억 — REQ-WEB-245
//
// 지문이 같으면 그림을 부수지 않고(초안 저장 · 상태 전이가 그림을 뒤집지 않게), 기억은 같은
// 입력에만 쓴다(적어 둔 자리가 다시 계산할 자리와 같아야 사람마다 다른 그림이 되지 않는다).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_CACHE_LIMIT,
  graphFingerprint,
  layoutCacheKey,
  layoutSignature,
  readCachedLayout,
  writeCachedLayout,
} from './layout-cache.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const nodes = [
  { id: 'a', parent: 'area' },
  { id: 'b', parent: 'area' },
  { id: 'area', parent: null },
];
const edges = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'a' },
];

describe('지문', () => {
  it('순서와 무관하다 — 서버가 다른 순서로 줘도 같은 그래프다', () => {
    expect(graphFingerprint([...nodes].reverse(), [...edges].reverse())).toBe(
      graphFingerprint(nodes, edges),
    );
  });

  it('부모 · 간선이 바뀌면 달라진다 — 배치를 바꾸는 것들이다', () => {
    const base = graphFingerprint(nodes, edges);
    expect(graphFingerprint([{ id: 'a', parent: null }, ...nodes.slice(1)], edges)).not.toBe(base);
    expect(graphFingerprint(nodes, edges.slice(1))).not.toBe(base);
    expect(graphFingerprint([...nodes, { id: 'c', parent: null }], edges)).not.toBe(base);
  });
});

describe('기억의 열쇠', () => {
  const key = (patch: Partial<Parameters<typeof layoutCacheKey>[0]> = {}): string =>
    layoutCacheKey({
      fingerprint: 'f',
      seed: 1,
      width: 1158,
      height: 752,
      titles: ['가', '나'],
      ...patch,
    });

  it('번호 · 캔버스 크기 · 제목이 다르면 다른 열쇠다 — 계산한 답이 다르다', () => {
    expect(key({ seed: 2 })).not.toBe(key());
    expect(key({ width: 900 })).not.toBe(key());
    expect(key({ titles: ['가', '다'] })).not.toBe(key());
    expect(key({ titles: ['나', '가'] })).toBe(key());
  });
});

describe('배치 기억', () => {
  const at = new Map([
    ['a', { x: 10.04, y: -3.26 }],
    ['b', { x: 100, y: 50 }],
  ]);

  it('적은 것을 그대로 읽는다(0.1px 로 줄여 적는다)', () => {
    writeCachedLayout('k1', at);
    expect(readCachedLayout('k1')).toEqual(
      new Map([
        ['a', { x: 10, y: -3.3 }],
        ['b', { x: 100, y: 50 }],
      ]),
    );
    expect(readCachedLayout('없는 열쇠')).toBeNull();
  });

  it(`최근 ${LAYOUT_CACHE_LIMIT}개만 남는다 — 오래 안 쓴 것부터 밀려난다`, () => {
    for (let i = 0; i <= LAYOUT_CACHE_LIMIT; i += 1) writeCachedLayout(`k${i}`, at);
    expect(readCachedLayout('k0')).toBeNull();
    expect(readCachedLayout(`k${LAYOUT_CACHE_LIMIT}`)).not.toBeNull();
  });

  it('저장소가 막혀도 던지지 않는다 — 기억은 편의일 뿐이다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeCachedLayout('k', at)).not.toThrow();
    expect(readCachedLayout('k')).toBeNull();
  });
});

describe('그림의 서명', () => {
  it('새로 계산한 자리와 기억에서 꺼낸 자리가 같은 서명이다 — 반올림 경계에서도', () => {
    const fresh = new Map([['a', { x: 12.46, y: 7.44 }]]);
    writeCachedLayout('k', fresh);
    const cached = readCachedLayout('k') ?? new Map();
    expect(layoutSignature(cached)).toBe(layoutSignature(fresh));
  });

  it('자리가 1px 넘게 바뀌면 서명이 바뀐다', () => {
    const one = new Map([['a', { x: 10, y: 10 }]]);
    const two = new Map([['a', { x: 14, y: 10 }]]);
    expect(layoutSignature(one)).not.toBe(layoutSignature(two));
  });
});
