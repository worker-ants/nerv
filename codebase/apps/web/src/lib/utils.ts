import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 충돌 해소가 **우리 토큰의 이름을 안다**(2026-09-26). tailwind-merge 는 기본 척도만 알아서 `rounded-nerv` 와
 * `rounded-nerv-sm`, `h-control-sm` 과 `h-auto` 를 서로 다른 속성으로 보고 둘 다 남겼다 — 그러면 어느 쪽이 이기는지는
 * CSS 가 생성된 순서가 정한다. 프리미티브의 기본값을 부르는 쪽이 덮어쓰지 못하는 자리가 그렇게 생긴다.
 * 이름은 `styles/tokens.css` 의 `@theme` 과 같아야 한다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['nerv-sm', 'nerv', 'nerv-lg'],
      spacing: ['control-sm', 'control', 'nav-row', 'header', 'sidebar', 'content'],
      text: ['3xs', 'metric'],
    },
  },
});

/** shadcn/ui 관례 — 조건부 클래스 결합 + Tailwind 충돌 해소 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
