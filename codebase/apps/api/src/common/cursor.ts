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

/**
 * 커서에서 꺼낸 **시각 부분**이 시각인가 — 아니면 `null`(= 처음부터).
 *
 * `decodeCursor` 는 JSON 배열이기만 하면 통과시키므로 `['x','y']` 같은 값이 그대로
 * `::timestamptz` 로 들어가면 22007 로 죽는다. 그 SQLSTATE 는 `db-error.ts` 의 표에 없어
 * **진짜 500** 이 된다 — 낡은 커서 하나가 화면을 깨뜨리는 것은 이 파일이 이미 거부한 일이다.
 *
 * 드라이버가 준 **텍스트 그대로** 다룬다: drizzle 의 node-postgres 세션은 TIMESTAMPTZ 를
 * 문자열로 주고(`2026-09-04 12:39:34.615061+00`), `new Date(...).toISOString()` 왕복은
 * µs 를 ms 로 잘라 동률 판정(`=`)을 깨뜨린다. 세션·알림 열은 `now()` 로 써서 µs 다.
 */
export function cursorTimestamp(part: unknown): string | null {
  if (typeof part !== 'string' || part === '') return null;
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/.test(part)
    ? part
    : null;
}

/** 커서에서 꺼낸 **id 부분** — uuid 모양이 아니면 `null`(같은 이유로 캐스팅 전에 거른다) */
export function cursorId(part: unknown): string | null {
  if (typeof part !== 'string') return null;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(part)
    ? part
    : null;
}

/** `limit` 기본 30 · 최대 100 (§1.6). 범위 밖은 자른다 — 거절하면 쓰는 쪽이 번거롭다. */
export function pageLimit(raw: string | number | undefined): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (n === undefined || Number.isNaN(n)) return PAGE_LIMIT_DEFAULT;
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, n));
}

/**
 * **유한 목록의 봉투**(§1.6 · REQ-API-120).
 *
 * 자라지 않는 목록(한 문서의 버전·코멘트·관계, 한 프로젝트의 기준선)은 커서가 아니라
 * **총계**를 준다 — 쪽이 없으니 `next_cursor` 는 거짓말이 되고, 맨 배열은 화면이 "이게
 * 전부인가" 를 물을 자리를 없앤다. 상한이 없으므로 `total` 은 곧 실제 건수다.
 *
 * 표면에서 감싸고 서비스는 배열을 그대로 둔다 — 도메인 안쪽(`diff()` · `include=comments`)이
 * 같은 서비스를 쓰고, 봉투로 번역하는 것은 표면의 일이다(D-05).
 */
export function finiteList<T>(items: T[]): { items: T[]; total: number } {
  return { items, total: items.length };
}
