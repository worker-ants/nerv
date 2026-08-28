// DB 무결성 위반 → 이유 있는 에러 (api.md §1.4a)
//
// **"internal server error" 는 사용자의 잘못을 서버의 잘못으로 보고한다.** 같은 키로
// 프로젝트를 만들면 유니크 제약이 그대로 올라와 500 이 됐다(사람 보고 2026-08-28) — 화면은
// 무엇이 잘못됐는지 말하지 못하고, 로그를 볼 수 있는 사람만 원인을 안다.
//
// 자리는 **표면**이다. 도메인 서비스가 저장 전에 미리 확인하는 것이 더 친절한 답을 주지만
// (프로젝트 slug 가 그렇게 한다 — 보관된 것이 쥐고 있다는 사실까지 말한다), 모든 제약마다
// 미리 확인을 심는 것은 유지되지 않는다. 미리 확인은 **말이 더 필요한 곳에만** 두고, 나머지는
// 여기서 한 번에 받는다. 그래서 이 변환은 REST 필터와 MCP 컨트롤러 **양쪽**이 같이 쓴다.
//
// 값은 싣지 않는다. Postgres 의 `detail` 에는 충돌한 **값**이 들어 있는데(`Key (key)=(nerv)`),
// 그것을 그대로 돌려주면 남의 행 값이 새는 자리가 된다. 나가는 것은 **필드 이름과 제약 이름**뿐이다.

import { NERV_ERROR, msg } from '@nerv/schema';
import type { Message } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

/** SQLSTATE → 우리가 부르는 이름. 나머지 코드는 여기서 다루지 않는다(진짜 500 이다). */
const KIND: Record<string, string> = {
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23502': 'not_null_violation',
  '23514': 'check_violation',
  '22001': 'too_long',
};

const MESSAGE: Record<string, (fields: string, constraint: string) => Message> = {
  unique_violation: (fields) => msg('error.db.unique_violation', { fields }),
  foreign_key_violation: (fields) => msg('error.db.foreign_key_violation', { fields }),
  not_null_violation: (fields) => msg('error.db.not_null_violation', { fields }),
  check_violation: (_, constraint) => msg('error.db.check_violation', { constraint }),
  too_long: (fields) => msg('error.db.too_long', { fields }),
};

interface PgFailure {
  code: string;
  constraint?: string;
  detail?: string;
  column?: string;
  table?: string;
}

/**
 * 원인 사슬에서 Postgres 오류를 찾는다.
 *
 * drizzle 이 드라이버 오류를 감싸므로 맨 위 예외만 보면 SQL 전문만 보인다 — 그 사고는
 * 2026-08-24 에 로그에서 한 번 겪었다(`diagnostic()` 주석). 여기서도 사슬을 편다.
 */
function pgFailureOf(exception: unknown): PgFailure | null {
  const seen = new Set<unknown>();
  let current: unknown = exception;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === 'string' && code in KIND) return current as unknown as PgFailure;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * 어느 필드가 문제인가.
 *
 * `column` 이 있으면 그것이 답이고(NOT NULL), 아니면 `detail` 의 `Key (a, b)=(…)` 를 읽는다.
 * `detail` 은 서버 로케일을 타므로(`lc_messages`) 못 읽을 수 있고, 그때는 제약 이름만 남는다 —
 * 이름이라도 있는 편이 "internal error" 보다 낫다.
 */
export function fieldsOf(failure: PgFailure): string[] {
  if (typeof failure.column === 'string' && failure.column !== '') return [failure.column];
  const matched = /\(([^)]+)\)=/.exec(failure.detail ?? '');
  if (matched?.[1] === undefined) return [];
  return matched[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * 사람에게 보일 필드 — **범위 열은 뺀다.**
 *
 * `(org_id, key)` 유니크에서 사람이 고른 값은 `key` 하나다. `org_id` 는 그 사람이 지금 있는
 * 조직이지 입력이 아니므로, 그것까지 이름을 부르면 "무엇을 고치라는 것인지"가 흐려진다.
 * 기계가 볼 전체 목록은 `details.fields` 에 그대로 남는다.
 */
export function spokenFields(fields: string[]): string[] {
  const chosen = fields.filter((name) => !name.endsWith('_id'));
  return chosen.length > 0 ? chosen : fields;
}

/**
 * DB 무결성 위반이면 이유 있는 `NervError` 를, 아니면 `null` 을 돌려준다.
 *
 * `null` 은 "이건 진짜 500 이다"라는 뜻이다 — 여기서 아무거나 400 으로 만들면 서버의 결함이
 * 사용자 잘못으로 둔갑하고, 그 순간 500 이 사라져 아무도 고치지 않는다.
 */
export function dbConstraintError(exception: unknown): NervError | null {
  const failure = pgFailureOf(exception);
  if (failure === null) return null;
  const kind = KIND[failure.code];
  const build = kind === undefined ? undefined : MESSAGE[kind];
  if (kind === undefined || build === undefined) return null;

  const fields = fieldsOf(failure);
  const spoken = spokenFields(fields);
  const constraint = failure.constraint ?? '';
  return new NervError(NERV_ERROR.PRECONDITION, build(spoken.join(', '), constraint), {
    kind,
    fields,
    // 제약 이름은 정확한 손잡이다 — 필드 이름을 못 읽었을 때 남는 유일한 단서이기도 하다
    constraint,
    ...(failure.table === undefined ? {} : { table: failure.table }),
  });
}
