import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui 관례 — 조건부 클래스 결합 + Tailwind 충돌 해소 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
