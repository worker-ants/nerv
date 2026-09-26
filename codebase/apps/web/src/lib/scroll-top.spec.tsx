// 보는 것이 바뀌면 읽는 자리를 처음으로 — REQ-WEB-244
//
// jsdom 은 스크롤을 재지 않으므로(`scrollTop` 이 늘 0) 상자의 값을 손으로 붙들고 본다.
// 실제 상자가 되돌아가는지는 L3 가 본다(`test/e2e/manual.spec.ts` · `spec-navigation.spec.ts`).

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useScrollTopOn } from './scroll-top.js';

/** 스크롤 값을 기억하는 상자 — jsdom 의 `scrollTop` 은 대입해도 0 이다 */
function box(): HTMLElement & { scrollTop: number; scrollLeft: number } {
  const el = document.createElement('div');
  let top = 0;
  let left = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => (top = v) });
  Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v: number) => (left = v) });
  return el as HTMLElement & { scrollTop: number; scrollLeft: number };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useScrollTopOn', () => {
  it('처음 그릴 때는 건드리지 않는다 — 들어온 자리를 지운다', () => {
    const el = box();
    el.scrollTop = 300;
    renderHook(() => useScrollTopOn({ current: el }, 'tasks'));
    expect(el.scrollTop).toBe(300);
  });

  it('열쇠가 바뀌면 처음으로, 같으면 그대로다', () => {
    const el = box();
    const ref = { current: el };
    const { rerender } = renderHook(({ key }) => useScrollTopOn(ref, key), {
      initialProps: { key: 'tasks' },
    });
    el.scrollTop = 400;
    el.scrollLeft = 20;
    rerender({ key: 'tasks' });
    expect(el.scrollTop).toBe(400);

    rerender({ key: 'specs' });
    expect(el.scrollTop).toBe(0);
    expect(el.scrollLeft).toBe(0);
  });

  it('#앵커로 들어온 이동은 되돌리지 않는다 — 그 자리로 가는 것이다', () => {
    const el = box();
    const ref = { current: el };
    const { rerender } = renderHook(({ key }) => useScrollTopOn(ref, key), {
      initialProps: { key: 'tasks' },
    });
    el.scrollTop = 400;
    window.history.replaceState(null, '', '/help/specs#rail');
    rerender({ key: 'specs' });
    expect(el.scrollTop).toBe(400);
  });

  it('상자가 아직 없으면 아무것도 하지 않는다', () => {
    const { rerender } = renderHook(({ key }) => useScrollTopOn({ current: null }, key), {
      initialProps: { key: 'a' },
    });
    expect(() => rerender({ key: 'b' })).not.toThrow();
  });
});
