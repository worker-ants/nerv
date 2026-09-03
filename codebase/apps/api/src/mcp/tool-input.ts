// 도구 입력 검증 — 스키마의 `required` 와 기본 타입을 **호출 전에** 본다.
//
// 레지스트리 주석은 처음부터 "zod 입력 검증"을 말하고 있었지만 그 검증이 없었다(실측
// 2026-08-30): 인자 없이 부른 `nerv_spec_get` 이 그대로 핸들러까지 갔다. 스키마가
// `required` 를 적어도 아무도 읽지 않으면 그것은 문서일 뿐 계약이 아니다.
//
// **조용한 실패가 여기서 만들어진다.** 핸들러는 없는 값을 `?? ''` 로 받아 넘기므로,
// 이름을 잘못 적은 호출이 거부되는 대신 **빈 값으로 성공한다** — 본문 저장에서는 그것이
// 곧 문서를 지우는 일이다. 그래서 검증은 표면의 몫이고, 도메인 서비스가 아니라 여기서 한다.
//
// JSON Schema 전부를 해석하지 않는다. 도구 스키마가 실제로 쓰는 것은 최상위
// `required` 와 `type`·`enum` 뿐이고, 그 이상은 도메인 판정이라 서비스가 본다.

import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../common/nerv-exception.filter.js';

interface PropertySchema {
  type?: string;
  enum?: readonly unknown[];
}

/** 값이 스키마의 `type` 과 맞는가 — 맞지 않으면 이름을 돌려준다 */
function typeMismatch(name: string, value: unknown, schema: PropertySchema): string | null {
  const expected = schema.type;
  if (expected === undefined) return null;
  const ok =
    expected === 'string'
      ? typeof value === 'string'
      : expected === 'number' || expected === 'integer'
        ? typeof value === 'number'
        : expected === 'boolean'
          ? typeof value === 'boolean'
          : expected === 'array'
            ? Array.isArray(value)
            : expected === 'object'
              ? typeof value === 'object' && value !== null && !Array.isArray(value)
              : true;
  return ok ? null : name;
}

/**
 * 게이트웨이가 **직접** 읽는 봉투 인자 — 도구 스키마에 없어도 유령이 아니다.
 *
 * 두 값은 도구가 아니라 표면이 소비한다(`resolveSession` · `runOnce`). 스키마에 적은 도구도
 * 있고 안 적은 도구도 있는데, 안 적었다고 "무시됐다" 고 말하면 정상 호출이 경고를 받는다.
 */
const ENVELOPE_ARGS = new Set(['session_id', 'idempotency_key']);

/**
 * 필수 인자와 타입을 본다. 어긋나면 **무엇이 어긋났는지 이름으로** 말한다 —
 * "잘못된 입력"만 돌려주면 에이전트는 같은 호출을 반복한다(agent-integration §2.7).
 *
 * **모르는 인자는 세어서 돌려준다**(2026-09-03 · REQ-API-080). 예전에는 스키마에 없는
 * 속성을 검사도 거부도 없이 지나쳤다. 그래서 스킬이 지시하는 인자 중 도구가 받지 않는
 * 것들이 **성공 응답과 함께 사라졌다** — `state_note`(인수인계 노트) · `stats`(diff 통계) ·
 * `include` · `repo{}` · `role` · `capabilities` · `branch` · `worktree` ·
 * `resolved_in_version_id` · `note` · `reviewer_hint` 열한 종이 그렇게 조용히 버려졌다.
 * 거부하지 않는 이유는 배포된 스킬이 지금 그것들을 보내고 있기 때문이다: 거부하면 방금
 * 살려 놓은 첫 세션 경로가 다시 막힌다. 대신 **버렸다는 사실을 말한다** — 조용한 실패를
 * 시끄러운 실패로 바꾸는 것이 이 한 줄의 일이다.
 *
 * @returns 스키마에 없어 무시한 인자 이름들(정상 호출이면 빈 배열)
 */
export function assertToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): string[] {
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
  const properties = (schema['properties'] ?? {}) as Record<string, PropertySchema>;

  const missing = required.filter((name) => input[name] === undefined || input[name] === null);
  const wrongType: string[] = [];
  const notAllowed: string[] = [];
  const unknown: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    const property = properties[name];
    if (property === undefined) {
      // 값이 null 이어도 이름은 드리프트다 — 스키마에 없는 이름을 보냈다는 사실이 신호다
      if (!ENVELOPE_ARGS.has(name)) unknown.push(name);
      continue;
    }
    if (value === undefined || value === null) continue;
    const mismatch = typeMismatch(name, value, property);
    if (mismatch !== null) wrongType.push(mismatch);
    else if (Array.isArray(property.enum) && !property.enum.includes(value)) notAllowed.push(name);
  }

  if (missing.length === 0 && wrongType.length === 0 && notAllowed.length === 0) return unknown;
  throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
    kind: 'invalid_input',
    ...(missing.length > 0 ? { missing } : {}),
    ...(wrongType.length > 0 ? { wrong_type: wrongType } : {}),
    ...(notAllowed.length > 0 ? { not_allowed: notAllowed } : {}),
    // 거절당한 호출에도 함께 말한다 — 이름을 잘못 적은 것이 원인일 수 있다
    ...(unknown.length > 0 ? { unknown } : {}),
  });
}
