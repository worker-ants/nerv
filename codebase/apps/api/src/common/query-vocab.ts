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
// **2026-09-07 — 접는 것도 무시다**(REQ-API-126). 위 다섯을 고친 뒤에도 표면 다섯 자리는
// 삼항으로 값을 **기본값에 접고** 있었다: `?status=cancelled` 가 열린 질문 목록을 200 으로
// 돌려주고, `?state=foo`·`?direction=inbound` 가 조용히 기본값으로 갔다. 500 은 실패를
// 알리기라도 하는데 접기는 **걸러진 화면이라고 믿게 한다** — 더 나쁘다.
//
// 서비스 시그니처의 리터럴 유니온(`status?: 'open' | 'answered'`)은 컴파일러를 막지
// **호출자를 막지 않는다**(HTTP·MCP 는 문자열을 싣고 온다). 그래서 타입을 `string` 으로
// 넓히고 판정을 도메인에 두는 것이 이 파일의 규칙이다.
//
// 어휘의 정본은 언제나 `@nerv/schema` 의 enum 이다 — 목록을 여기에 다시 적지 않는다(D-05).

import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

/**
 * 쉼표 목록 → 값 배열. 빈 항목은 버린다 — 트레일링 콤마가 어휘 오류가 되면 안 된다.
 *
 * **한 자리에 두는 이유는 `assertVocab` 과 같다.** 이 표기(`?status=draft,approved`)는
 * 트리·검색·목록에서 함께 쓰는데, 표면마다 따로 쪼개면 어느 한쪽만 공백을 다듬거나
 * 빈 항목을 남기게 되고 그 차이는 **어휘 오류로 위장해서** 나타난다.
 */
export function csv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

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
