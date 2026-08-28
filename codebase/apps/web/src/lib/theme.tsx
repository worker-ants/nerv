// 웹의 테마 — 정본: docs/04-mvp/screens.md §1.7a
//
// 로케일(§1.7)과 **같은 규칙**이다: 고른 값은 이 브라우저에 기억하고, 고르지 않았으면 환경을
// 따른다. 다른 점 하나 — 로케일은 계정에 붙는 성질이지만 **테마는 기계에 붙는다.** 같은
// 사람이 낮의 노트북에서는 밝게, 밤의 데스크톱에서는 어둡게 쓴다. 그래서 서버로 보내지 않고
// 이 브라우저에만 남긴다.
//
// **Provider 를 두지 않는다.** 테마의 실체는 `document.documentElement` 의 속성과
// localStorage 이지 React 상태가 아니다. context 로 감싸면 화면을 그리는 테스트마다 래퍼를
// 하나씩 더 기억해야 하고(실측: 셸을 그리는 스펙 11개가 한꺼번에 깨졌다), 그렇게 늘어난
// 래퍼는 언젠가 빠뜨려진다. 여기서는 모듈이 상태를 쥐고 `useSyncExternalStore` 로 알린다 —
// 훅은 어디서 불러도 동작하고, 테스트는 아무것도 감싸지 않아도 된다.

import { useCallback, useSyncExternalStore } from 'react';

/** 사용자가 고르는 것 셋. `system` 은 "고르지 않겠다"는 선택이다. */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** 화면에 실제로 칠해지는 것 둘 — `system` 은 여기서 둘 중 하나로 풀린다. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nerv.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** 사용자가 고른 값. 없으면 `system` — "환경을 따른다"는 뜻이다. */
export function storedTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    // 사생활 보호 모드처럼 localStorage 가 막힌 환경도 있다 — 그때는 시스템을 따른다
    return 'system';
  }
}

/** 시스템의 현재 취향. `matchMedia` 가 없는 환경(jsdom 기본)에서는 밝게 본다. */
export function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function resolveTheme(theme: Theme, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return theme === 'system' ? system : theme;
}

/**
 * 풀린 값을 문서에 적는다.
 *
 * **팔레트는 `[data-theme]` 한 곳에만 있다**(`tokens.css`). 미디어 쿼리에도 한 벌을 더 두면
 * 두 벌이 되고, 두 벌이 되면 언젠가 한쪽만 고친다 — 그 토큰 파일은 그 사고를 이미 한 번
 * 겪었다. 그래서 여기서 항상 **풀린 값**을 적는다: `system` 이라는 상태는 속성에 남지 않고
 * CSS 는 light/dark 둘만 안다.
 *
 * `color-scheme` 도 같이 적는다 — 스크롤바·기본 폼 컨트롤처럼 브라우저가 직접 그리는 것들은
 * CSS 변수를 모르고 이 속성만 본다.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset['theme'] = resolved;
  root.style.colorScheme = resolved;
}

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
}

const listeners = new Set<() => void>();
let state: ThemeState = { theme: 'system', resolved: 'light' };
let started = false;

function publish(theme: Theme, system?: ResolvedTheme): void {
  const resolved = resolveTheme(theme, system);
  // **문서에는 언제나 적는다.** 첫 호출에서 결과가 초깃값과 같다는 이유로 건너뛰면
  // 밝은 시스템의 첫 방문에서 `data-theme` 이 비어 버린다(실측 — 테스트가 잡았다).
  applyTheme(resolved);
  // 스냅샷은 **바뀔 때만** 새 객체다 — useSyncExternalStore 가 같은 값을 다르다고 보면
  // 렌더가 무한히 돈다.
  if (state.theme === theme && state.resolved === resolved) return;
  state = { theme, resolved };
  for (const listener of listeners) listener();
}

/**
 * 저장된 값을 문서에 반영하고, 시스템 변화를 듣기 시작한다.
 *
 * `system` 을 고른 사람은 시스템이 바뀌면 **따라 바뀐다** — 그것이 그 선택의 내용이다.
 * 구독은 고른 값과 무관하게 걸어 둔다: `system` 으로 돌아오는 순간 바로 맞아야 한다.
 */
export function startTheme(): void {
  if (started) return;
  started = true;
  publish(storedTheme());
  try {
    window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
      publish(state.theme, event.matches ? 'dark' : 'light');
    });
  } catch {
    // matchMedia 가 없는 환경 — 고른 값은 그대로 쓰고 시스템 추적만 없다
  }
}

export function setTheme(next: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 저장이 막혀도 이번 세션 동안은 바뀐 채로 쓴다 — 되돌려 놓는 것이 더 나쁘다
  }
  publish(next);
}

/** 테스트용 — 모듈 상태를 처음으로 되돌린다(브라우저에는 없는 일이다). */
export function resetThemeForTesting(): void {
  started = false;
  state = { theme: 'system', resolved: 'light' };
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): ThemeState & { setTheme: (next: Theme) => void } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  return { ...snapshot, setTheme: useCallback((next: Theme) => setTheme(next), []) };
}
