/**
 * **보는 것이 바뀌면 읽는 자리를 처음으로** — 자기 상자 안에서 흐르는 본문(REQ-WEB-244).
 *
 * 라우터는 이동할 때마다 **창**의 스크롤만 되돌린다. 그런데 이 앱의 여러 화면은 본문이
 * 자기 상자 안에서 흐르고(도움말 · 스펙 상세 · 리뷰 센터 — REQ-WEB-156·157·158), 그 상자는
 * 장이나 문서를 옮겨도 그대로 남는다. 그래서 도움말에서 다른 장을 누르면 새 장이 앞 장을
 * 읽던 깊이에서 열렸다 — 처음부터 읽으려면 손으로 맨 위까지 올려야 했다(2026-09-26 사람 보고).
 *
 * 라우터의 `scrollToTopSelectors` 에 올리지 않은 이유: 그 설정은 주소가 바뀌는 **모든** 이동에
 * 돈다. 스펙 상세는 레일 탭 · 본문 탭 · 버전을 주소로 들고 있어서, 레일 탭을 누를 때마다 읽던
 * 본문이 맨 위로 튄다. 그래서 상자마다 **무엇을 보는가**(장 · 문서 · 발견 · 작업 · 필터)를
 * 열쇠로 받고, 그 열쇠가 바뀔 때만 되돌린다.
 */

import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useScrollTopOn(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const previous = useRef(key);
  // 그리기 전에 되돌린다 — 새 내용이 앞 내용의 깊이에서 한 번 보였다가 튀지 않게
  useLayoutEffect(() => {
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    // `#앵커` 로 들어온 이동은 그 자리로 가는 것이다 — 라우터가 그 요소로 옮긴다
    if (window.location.hash !== '') return;
    const box = ref.current;
    if (box === null) return;
    box.scrollTop = 0;
    box.scrollLeft = 0;
  }, [ref, key]);
}
