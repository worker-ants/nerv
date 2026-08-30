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
 * 필수 인자와 타입을 본다. 어긋나면 **무엇이 어긋났는지 이름으로** 말한다 —
 * "잘못된 입력"만 돌려주면 에이전트는 같은 호출을 반복한다(agent-integration §2.7).
 */
export function assertToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): void {
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
  const properties = (schema['properties'] ?? {}) as Record<string, PropertySchema>;

  const missing = required.filter((name) => input[name] === undefined || input[name] === null);
  const wrongType: string[] = [];
  const notAllowed: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    const property = properties[name];
    if (property === undefined || value === undefined || value === null) continue;
    const mismatch = typeMismatch(name, value, property);
    if (mismatch !== null) wrongType.push(mismatch);
    else if (Array.isArray(property.enum) && !property.enum.includes(value)) notAllowed.push(name);
  }

  if (missing.length === 0 && wrongType.length === 0 && notAllowed.length === 0) return;
  throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
    kind: 'invalid_input',
    ...(missing.length > 0 ? { missing } : {}),
    ...(wrongType.length > 0 ? { wrong_type: wrongType } : {}),
    ...(notAllowed.length > 0 ? { not_allowed: notAllowed } : {}),
  });
}
