// 목록·기간을 SQL 에 싣는 **단 하나의 방법** (2026-09-02 — 보안 점검)
//
// 왜 파일이 하나 더 생겼나. 배열 리터럴을 `sql.raw` 로 조립하던 자리가 일곱 곳이었고,
// 이스케이프는 자리마다 달랐다 — glob 은 따옴표를 두 배로 늘렸고, uuid 와 권한은
// 조립만 했으며, **세션 보드의 `state` 는 사용자 입력을 그대로 이어 붙였다.** 마지막 것은
// 프로젝트 멤버 누구나 WHERE 절을 다시 쓸 수 있다는 뜻이었다(EP-SES-01).
//
// 자리마다 이스케이프를 맞추는 대신 **조립을 없앤다.** 값은 언제나 파라미터로 가고,
// SQL 본문에 리터럴로 남는 것은 이 파일이 열거한 타입 이름뿐이다. 새 타입이 필요하면
// `SqlArrayType` 에 더한다 — 임의 문자열을 받지 않는 이유가 그것이다.

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** 이 저장소가 배열로 싣는 타입. 값이 아니라 **타입 이름**이라 열거로 닫는다. */
export type SqlArrayType = 'text' | 'uuid' | 'session_state';

/**
 * `ARRAY[$1, $2]::<type>[]` — 각 값은 바인딩된 파라미터다.
 *
 * 빈 목록은 `'{}'::<type>[]` 다. `ARRAY[]` 는 타입을 추론하지 못해 Postgres 가 거절한다.
 */
export function sqlArray(values: readonly string[], type: SqlArrayType): SQL {
  if (values.length === 0) return sql`'{}'::${sql.raw(type)}[]`;
  const items = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return sql`ARRAY[${items}]::${sql.raw(type)}[]`;
}

/**
 * `make_interval(secs => $1)` — `interval 'N seconds'` 문자열을 만들지 않는다.
 *
 * 지금 이 자리들에 오는 초는 전부 상수(`@nerv/schema`)이거나 정수 입력이라 조립이
 * 위험하지는 않았다. 그래도 같은 모양으로 두는 이유는 하나다: **문자열 조립을 하는
 * 자리가 남아 있으면 다음 사람이 거기에 사용자 입력을 넣는다.**
 */
export function sqlSeconds(seconds: number): SQL {
  return sql`make_interval(secs => ${seconds})`;
}
