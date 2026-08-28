// 테마 — 고르는 순서와 기억하는 방식만 본다(screens.md §1.7a).
//
// 색이 예쁜지는 여기서 볼 일이 아니다. 여기서 지키는 것은 셋이다: 고른 값이 시스템을
// **이기는가** · `system` 을 고른 사람이 시스템을 **따라가는가** · CSS 가 알아야 하는 것이
// 문서에 **적히는가**(팔레트는 `[data-theme]` 한 곳에만 있으므로 이 속성이 곧 화면이다).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  resetThemeForTesting,
  resolveTheme,
  setTheme,
  startTheme,
  storedTheme,
  systemTheme,
} from './theme.js';

/** jsdom 에는 matchMedia 가 없다 — 시스템 취향을 손으로 쥐여 준다. */
function stubSystem(dark: boolean): { change: (next: boolean) => void } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = dark;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    }),
  });
  return {
    change: (next) => {
      matches = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetThemeForTesting();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('고르는 순서', () => {
  it('고른 값이 시스템을 이긴다 — 한 번 고른 사실이 배신당하지 않는다', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('`system` 은 시스템을 따른다 — 그것이 그 선택의 내용이다', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('고른 적이 없으면 `system` 이다 — 모르는 값도 마찬가지', () => {
    expect(storedTheme()).toBe('system');
    localStorage.setItem('nerv.theme', 'sepia');
    expect(storedTheme()).toBe('system');
  });

  it('matchMedia 가 없는 환경에서는 밝게 본다 — 던지지 않는다', () => {
    expect(systemTheme()).toBe('light');
  });
});

describe('문서에 적히는 것', () => {
  it('풀린 값만 적는다 — CSS 는 light/dark 둘만 안다', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    // 스크롤바·기본 폼 컨트롤은 CSS 변수를 모르고 이 속성만 본다
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('고르면 기억하고 그 자리에서 반영한다', () => {
    stubSystem(false);
    startTheme();
    setTheme('dark');
    expect(localStorage.getItem('nerv.theme')).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});

describe('시스템이 바뀔 때', () => {
  it('`system` 이면 따라 바뀐다', () => {
    const system = stubSystem(false);
    startTheme();
    expect(document.documentElement.dataset['theme']).toBe('light');

    system.change(true);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('고른 값이 있으면 흔들리지 않는다 — 밝게를 고른 사람의 화면은 밤에도 밝다', () => {
    const system = stubSystem(false);
    localStorage.setItem('nerv.theme', 'light');
    startTheme();

    system.change(true);
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});
