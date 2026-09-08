/**
 * 가로로 스크롤하는 줄의 **양 끝 상태** — 어느 쪽에 잘린 것이 남아 있는가.
 *
 * 페이드는 "더 있다" 는 신호다. 그래서 **끝에 닿았는데도 흐려져 있으면 거짓말**이 되고,
 * 반대로 잘렸는데 아무 표시가 없으면 사람은 그것을 목록의 끝으로 읽는다(macOS 는
 * 스크롤 막대를 쉬는 동안 숨긴다 — 그 자리에 신호가 없다).
 *
 * 판정을 여기 한 곳에 두는 이유는 화면에서 잴 수 없기 때문이다: jsdom 은 `scrollWidth`
 * 를 0 으로 두므로 L1 은 이 함수로만 태울 수 있고, 실제 폭은 L3 가 잰다.
 */
export type ScrollEdges = 'none' | 'start' | 'end' | 'both';

/**
 * @param scrollLeft 현재 스크롤 위치
 * @param scrollWidth 내용 전체 폭
 * @param clientWidth 보이는 폭
 */
export function scrollEdges(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
): ScrollEdges {
  // 1px 은 소수 폭의 반올림 여유다. 브라우저는 끝에 닿아도 `scrollLeft` 를 0.5px 남기는
  // 일이 있어, 여유 없이 재면 끝에서 페이드가 사라지지 않는다.
  const start = scrollLeft > 1;
  const end = scrollWidth - clientWidth - scrollLeft > 1;
  if (start && end) return 'both';
  if (start) return 'start';
  if (end) return 'end';
  return 'none';
}
