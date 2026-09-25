// 왼쪽 열 항목의 모양 — 셸 사이드바 · 설정 항목 · 둘째 열(도움말 차례)이 같이 쓴다 (screens.md §1.3)
//
// 세 자리가 같은 글자열을 각자 베껴 두고 있었다(셸 · 설정 · 곧 도움말 열). 한 곳의 높이나 활성 표시만 바뀌면
// 같은 목록이 화면마다 다른 모양이 된다 — 한 번 익힌 "지금 여기" 표시를 다른 열에서 다시 익히게 된다.

/** 항목 — 활성 표시는 배경 + 굵기다. 색만으로 구분하지 않는다(REQ-WEB-033) */
// 시안의 nav 는 29px 줄에 13.5px 글자다 — 손가락이 아니라 눈으로 고르는 목록이라
// 빽빽해도 되고, 빽빽해야 트리와 한 덩어리로 읽힌다(시안 대조 2026-08-23).
export const NAV_ITEM =
  'group flex h-[29px] items-center gap-2 rounded-[5px] px-2 text-base text-text-mute transition-colors hover:bg-bg-hover hover:text-text';
export const NAV_ACTIVE = 'bg-bg-active font-medium text-text';

/** 열의 구역 이름 — 트리 머리와 같은 크기여야 한 덩어리로 읽힌다 */
export const RAIL_LABEL = 'text-2xs font-semibold tracking-[0.07em] text-text-faint uppercase';
