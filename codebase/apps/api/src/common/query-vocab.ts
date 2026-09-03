// 질의 인자의 어휘 검사 — 모르는 값은 **거절이지 무시가 아니다**(api.md §1.4j · REQ-API-074).
//
// 이 파일이 생긴 이유는 같은 판정이 다섯 자리에 흩어져 있었기 때문이다. 한 자리(EP-SES-01)만
// 제대로 막고 나머지는 값을 그대로 `::enum` 으로 캐스팅해서, **사용자의 오타가 500 이 됐다** —
// 라이브 실측(2026-09-03): `?status=doing` · `?impl_status=nope` · `?v=abc` · `events?limit=abc`
// 넷 모두 500 이고, MCP 표면에서는 그 위에 SQL 원문까지 실려 나갔다.
//
// 500 과 400 은 사람에게 다른 말이다. 500 은 "서버가 잘못했다, 기다렸다 다시" 이고 400 은
// "네가 보낸 값이 어휘 밖이다, 이 목록에서 골라라" 다. 오타에 500 을 주면 클라이언트는
// 고칠 수 없는 요청을 재시도한다.
//
// 어휘의 정본은 언제나 `@nerv/schema` 의 enum 이다 — 목록을 여기에 다시 적지 않는다(D-05).

import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

/**
 * 어휘 안의 값만 통과시킨다. 어긋나면 **무엇이 어긋났고 무엇이 허용인지** 함께 준다 —
 * "잘못된 입력" 만 돌려주면 클라이언트는 같은 요청을 반복한다.
 */
export function assertVocab(
  values: readonly string[],
  allowed: readonly string[],
  field: string,
): string[] {
  const unknown = values.filter((value) => !allowed.includes(value));
  if (unknown.length > 0) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
      kind: 'invalid_input',
      field,
      unknown,
      allowed,
    });
  }
  return [...values];
}

/**
 * 정수 질의 인자 — `Number('abc')` 는 `NaN` 이고, `NaN` 을 그대로 SQL 에 실으면
 * 22P02 로 죽는다(`?v=abc` 가 500 이던 자리다). 값이 없으면 `null` 이다.
 */
export function intParam(raw: string | undefined, field: string): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
      kind: 'invalid_input',
      field,
      unknown: [raw],
      // 허용 목록이 열거가 아닌 자리다 — 모양을 말해 준다
      allowed: ['integer'],
    });
  }
  return value;
}
