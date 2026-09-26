// 요청 본문의 **모양** 검사 — 정본: api.md §1.7
//
// 표면이 하는 일은 번역이고(REQ-CB-003), 그 번역의 정확성이 이 한 줄이다.
// 예전에는 컨트롤러마다 `String(body['x'] ?? '')` 로 손수 읽었고, 그래서 **받는다고
// 적어 두고 안 읽는 코드**를 쓰기가 너무 쉬웠다 — 이번 감사가 찾은 결함 넷이 거기서 나왔다.
//
// 실패는 400 이다(`details.issues` 가 있으면 필터가 그렇게 매핑한다 — §1.4).
// 모양이 틀린 요청은 다시 보내도 같은 결과이므로 상태가 아니라 모양이다.
//
// **스키마가 문장을 정했으면 그 문장으로 답한다**(REQ-API-191 · codebase.md §3.4). zod 규칙에
// 카탈로그 키를 달아 두면(`.max(50, 'error.approval.bulk_limit')`) 봉투의 `message` 가 그 문구가
// 되고, 상한·하한은 자리표시자 `{max}`·`{min}` 으로 들어간다. 달지 않은 위반은 예전처럼
// "요청 본문이 스키마와 맞지 않습니다" 다 — 일괄 결정 51건이 그 한 줄로만 돌아와서, 받은
// 쪽은 무엇을 줄여야 하는지 알 수 없었다.

import { isMessageKey, msg, NERV_ERROR } from '@nerv/schema';
import type { Message, PlaceholderValues } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';

interface Parseable<T> {
  safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown };
}

/** zod 이슈에서 읽는 것 — 버전마다 모양이 조금씩 달라 필요한 칸만 본다 */
interface IssueLike {
  message?: unknown;
  maximum?: unknown;
  minimum?: unknown;
}

export function parseBody<T>(schema: Parseable<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success || result.data === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, describeIssues(result.error), {
      issues: result.error,
    });
  }
  return result.data;
}

/**
 * 위반 중 **카탈로그 키를 단 첫 이슈**의 문장. 여럿이 어겨졌어도 사람에게 필요한 것은 무엇을
 * 고칠지 하나이고, 나머지는 `details.issues` 에 그대로 있다. 키가 아닌 문자열(zod 의 기본
 * 영어 문장)은 믿지 않는다 — 그대로 넘기면 로케일과 무관한 문장이 봉투에 실린다.
 */
export function describeIssues(error: unknown): Message {
  const issues = (error as { issues?: IssueLike[] } | undefined)?.issues ?? [];
  for (const issue of issues) {
    if (typeof issue.message !== 'string' || !isMessageKey(issue.message)) continue;
    const values: PlaceholderValues = {};
    if (typeof issue.maximum === 'number' || typeof issue.maximum === 'bigint')
      values['max'] = Number(issue.maximum);
    if (typeof issue.minimum === 'number' || typeof issue.minimum === 'bigint')
      values['min'] = Number(issue.minimum);
    return Object.keys(values).length === 0
      ? { key: issue.message }
      : { key: issue.message, values };
  }
  return msg('error.request.schema');
}
