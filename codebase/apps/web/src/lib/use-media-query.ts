// 지금 폭이 이 조건에 맞는가 — **배치가 CSS 만으로 안 되는 자리**를 위한 최소 훅
//
// 폭에 따른 배치는 원칙적으로 CSS 가 한다(`lg:` · `xl:`). 이 훅이 필요한 자리는 하나뿐이다:
// **같은 컴포넌트를 폭에 따라 다른 부모 아래에 두어야 할 때.** `hidden`/`block` 으로 두 벌을
// 그리면 화면에는 하나만 보이지만 DOM 에는 둘이 있고, 그러면 접근성 트리·`id`·테스트가 그
// 둘을 모두 본다(그리고 내부 상태를 쥔 컴포넌트는 두 벌이 각자 다른 상태를 갖는다).
//
// **jsdom 에는 `matchMedia` 가 없다**(`theme.tsx` 가 이미 같은 자리를 지난다). 없으면 거짓을
// 돌려준다 — 좁은 화면의 배치가 기본이라는 뜻이고, 그쪽이 "볼 수 있는 것이 더 많은" 배치다.

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
