// 요청 본문의 **모양** 검사 — 정본: api.md §1.7
//
// 표면이 하는 일은 번역이고(REQ-CB-003), 그 번역의 정확성이 이 한 줄이다.
// 예전에는 컨트롤러마다 `String(body['x'] ?? '')` 로 손수 읽었고, 그래서 **받는다고
// 적어 두고 안 읽는 코드**를 쓰기가 너무 쉬웠다 — 이번 감사가 찾은 결함 넷이 거기서 나왔다.
//
// 실패는 400 이다(`details.issues` 가 있으면 필터가 그렇게 매핑한다 — §1.4).
// 모양이 틀린 요청은 다시 보내도 같은 결과이므로 상태가 아니라 모양이다.

import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

interface Parseable<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown };
}

export function parseBody<T>(schema: Parseable<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success || result.data === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.request.schema'), {
      issues: result.error,
    });
  }
  return result.data;
}
