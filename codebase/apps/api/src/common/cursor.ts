// 커서 페이지네이션 (api.md §1.6)
//
// 커서는 **(정렬 키, id)를 인코딩한 불투명 문자열**이고 클라이언트는 해석하지 않는다.
// 불투명하게 두는 이유는 정렬 기준을 바꿀 자유를 서버가 갖기 위해서다 — 클라이언트가
// 안을 읽기 시작하면 그 구조가 사실상 계약이 된다.
//
// 오프셋을 쓰지 않는 이유: 목록이 실시간으로 바뀌는 화면이라(보드·세션) 페이지 사이에
// 행이 끼거나 빠지면 오프셋은 항목을 건너뛰거나 두 번 보여 준다.

import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from '@nerv/schema';

/** 정렬 키 묶음 — 엔드포인트마다 다르므로 문자열 배열로 받는다 */
export function encodeCursor(parts: readonly (string | number | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

/**
 * 해독 실패는 **조용히 무시한다**(null 반환) — 낡은 커서를 들고 온 클라이언트에게
 * 400 을 주면 화면이 통째로 깨진다. 처음부터 보여 주는 편이 낫다.
 */
export function decodeCursor(raw: string | undefined): (string | number | null)[] | null {
  if (raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? (parsed as (string | number | null)[]) : null;
  } catch {
    return null;
  }
}

/** `limit` 기본 30 · 최대 100 (§1.6). 범위 밖은 자른다 — 거절하면 쓰는 쪽이 번거롭다. */
export function pageLimit(raw: string | number | undefined): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (n === undefined || Number.isNaN(n)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, n));
}
