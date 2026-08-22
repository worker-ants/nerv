// PAT 스코프 어휘 — 정본: docs/04-mvp/api.md §1.3 · agent-integration §2.3 "필요 권한" 열
//
// `resource:action` 표기이고 도구 표와 1:1 이다. 두 가지가 이 파일의 존재 이유다.
//
//   ① **사람 전용 스코프는 토큰에 부여 자체가 불가능하다.** `spec:approve` 와
//      `approval:decide` 는 정책이 아니라 **시스템 불변식**이다(agent-integration §6.1 ④).
//      "설정에서 끄면 되는 것"이 아니라 발급 경로에 존재하지 않아야 한다.
//   ② `import:write` 는 도구 대응이 없는 유일한 REST 전용 스코프다(api.md §1.3) —
//      admin 이 자신에게만 발급하고 역할 판정과 AND 로 검사된다.

/** 토큰에 부여할 수 있는 스코프. */
export const AGENT_SCOPES = [
  'spec:read',
  'spec:draft',
  'spec:meta',
  'task:claim',
  'task:update',
  'review:submit',
  'review:resolve',
  'agent-session:launch',
  'import:write',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

/**
 * 사람 전용 — 어떤 자율성 레벨에서도 토큰이 가질 수 없다.
 * 카탈로그에 대응 MCP 도구가 **존재하지 않는 것**이 설계다(agent-integration §2.1 원칙 3).
 */
export const HUMAN_ONLY_SCOPES = ['spec:approve', 'approval:decide'] as const;

export type HumanOnlyScope = (typeof HUMAN_ONLY_SCOPES)[number];

const AGENT_SET: ReadonlySet<string> = new Set(AGENT_SCOPES);
const HUMAN_SET: ReadonlySet<string> = new Set(HUMAN_ONLY_SCOPES);

export function isAgentScope(value: string): value is AgentScope {
  return AGENT_SET.has(value);
}

export function isHumanOnlyScope(value: string): value is HumanOnlyScope {
  return HUMAN_SET.has(value);
}

/** REST 전용 — MCP 도구 대응이 없다(api.md §1.3). */
export const REST_ONLY_SCOPES = ['import:write'] as const;
