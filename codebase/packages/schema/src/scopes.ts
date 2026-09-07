// PAT 권한 어휘 — 정본: docs/04-mvp/api.md §1.3 · agent-integration §2.3 "필요 권한" 열
//
// `resource:action` 표기다. 두 가지가 이 파일의 존재 이유다.
//
//   ① **사람 전용 권한은 토큰에 부여 자체가 불가능하다.** `spec:approve` 와
//      `approval:decide` 는 정책이 아니라 **시스템 불변식**이다(agent-integration §6.1 ④).
//      "설정에서 끄면 되는 것"이 아니라 발급 경로에 존재하지 않아야 한다.
//   ② **MCP 도구 대응이 없는 권한이 셋 있다** — `import:write`(admin 전용 이관 표면) ·
//      `spec:meta`(EP-SPEC-12·15~17) · `spec:evidence`(EP-REQ-03). 나머지 일곱이 도구 24종을
//      덮는다. "도구 표와 1:1" 은 그 일곱에 대한 말이고, 이 셋은 REST 축이다(api.md §1.3).

/** 토큰에 부여할 수 있는 권한. */
export const AGENT_SCOPES = [
  'spec:read',
  'spec:draft',
  'spec:meta',
  'task:claim',
  'task:update',
  'review:submit',
  'review:resolve',
  'agent-session:launch',
  'spec:evidence',
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

/**
 * REST 전용 — MCP 도구 대응이 없다(api.md §1.3).
 *
 * 목록이 `import:write` 하나였던 동안 `spec:meta` 는 어느 쪽에도 없었다 — 도구 24종이
 * 쓰는 권한은 일곱인데 문서는 "도구 표와 1:1" 이라고 적고 있었다(2026-09-04 실측).
 */
export const REST_ONLY_SCOPES = ['import:write', 'spec:meta', 'spec:evidence'] as const;

// ── 역할 → 권한 (api.md §2 전표의 "권한" 열) ────────────────────────────────
//
// **역할과 권한을 한 축으로 합친다.** `assertScope` 는 원래 "세션 사용자는 역할
// 매트릭스가 판정한다"고 적어 두고 그 매트릭스가 없어, 웹 세션이면 `viewer` 도
// EP-SPEC-15(메타 편집)·16(아카이브)·12(기준선 동결)을 통과했다(실측 2026-08-23).
//
// 두 경로가 같은 어휘를 쓰면 판정이 하나가 된다(D-05):
//   - 세션(쿠키): 역할이 허용하는 권한
//   - PAT: 역할이 허용하는 권한 **AND** 토큰에 실린 권한 (api.md §1.3 "AND 로 추가")
// 토큰이 역할보다 넓을 수 없다는 뜻이다 — 발급 시점의 역할이 상한이다.

/** 사람 전용 권한까지 포함한 권한 어휘 — 토큰 부여 가능 여부와는 다른 축이다. */
export type RoleScope = AgentScope | HumanOnlyScope;

/**
 * 역할이 허용하는 권한. **`viewer` 는 읽기뿐이다.**
 *
 * `admin` 을 전량으로 두는 것은 정본의 "admin ●"들과 정합한다. 나머지는 전표의
 * 권한 열을 그대로 옮긴 것이고, 근거가 없는 권한은 주지 않는다 — 넓게 열어 두고
 * 나중에 조이는 것은 이미 통과하던 요청을 깨는 일이라 더 비싸다.
 */
export const ROLE_SCOPES: Readonly<Record<string, readonly RoleScope[]>> = {
  admin: [...AGENT_SCOPES, ...HUMAN_ONLY_SCOPES],
  // 스펙 계열의 주인 — 메타·기준선·승인이 여기 있다(EP-SPEC-12·15~17 · EP-APR-03)
  planner: [
    'spec:read',
    'agent-session:launch',
    'spec:draft',
    'spec:meta',
    'spec:approve',
    'approval:decide',
    'task:claim',
    'task:update',
    'review:submit',
    'review:resolve',
  ],
  // ○ — 만들 수 있는 타입이 제한된다(SPEC_CREATE_TYPES). 메타·승인은 없다.
  designer: [
    'spec:read',
    'agent-session:launch',
    'spec:draft',
    'task:claim',
    'task:update',
    'review:submit',
  ],
  // `spec:evidence` 는 EP-REQ-03 의 권한 열(developer·qa·admin)을 그대로 옮긴 것이다.
  // planner 에게 주지 않는 이유도 같다 — 전표가 그렇게 적고 있다.
  developer: [
    'spec:read',
    'agent-session:launch',
    'spec:draft',
    'spec:evidence',
    'task:claim',
    'task:update',
    'review:submit',
  ],
  qa: [
    'spec:read',
    'agent-session:launch',
    'spec:draft',
    'spec:evidence',
    'task:claim',
    'task:update',
    'review:submit',
    'review:resolve',
  ],
  viewer: ['spec:read'],
};

/**
 * 역할별로 **새로 만들 수 있는 스펙 타입**(EP-SPEC-07 의 ● / ○).
 *
 * `null` 은 제한 없음, `[]` 는 **하나도 못 만든다**는 뜻이다.
 *
 * `qa` 가 `[]` 인 이유(2026-08-23 확정 — 사람 확인): **qa 가 만드는 것은 리뷰이지 스펙이
 * 아니다.** 그 리뷰 표면은 같은 날 들어왔다(`nerv_review_submit`·`nerv_finding_resolve` —
 * scope.md §5 FR-09 착수 기록) — 이제 qa 에게 만들 것이 있고, 그것이 스펙이 아니라 리뷰라는
 * 판정은 그대로다. `spec:draft` 는 남긴다 — 생성이 아니라 코멘트 해소
 * (EP-CMT-04 는 `spec:draft` 보유 역할)와 초안 편집의 몫이다.
 */
export const SPEC_CREATE_TYPES: Readonly<Record<string, readonly string[] | null>> = {
  admin: null,
  planner: null,
  designer: ['design'],
  developer: ['convention', 'adr'],
  qa: [],
  viewer: [],
};

/** 역할 여럿을 **합친다** — 고르지 않는다. 겸직은 권한의 합집합이다. */
export function scopesForRoles(roles: readonly string[]): Set<RoleScope> {
  const out = new Set<RoleScope>();
  for (const role of roles) for (const s of ROLE_SCOPES[role] ?? []) out.add(s);
  return out;
}

/** 어느 역할 하나라도 그 타입을 만들 수 있으면 만들 수 있다. */
export function canCreateSpecType(roles: readonly string[], type: string): boolean {
  return roles.some((role) => {
    const allowed = SPEC_CREATE_TYPES[role];
    return allowed === undefined ? false : allowed === null || allowed.includes(type);
  });
}

/**
 * 그 권한을 가진 역할 목록 — **역할 큐의 정본**(2026-09-07 · REQ-API-136).
 *
 * `approval:decide` 큐가 코드 두 곳에 하드코딩돼 있었다(`approval.service` 의 주석은
 * "역할 큐 목록을 여기 다시 적지 않는다" 고 적어 두고, `notification.service` 는
 * `role IN ('admin','planner')` 를 적고 있었다). 목록이 두 벌이면 한쪽만 고쳐진다 —
 * `ROLE_SCOPES` 에서 파생해 한 벌로 만든다.
 */
export function rolesWithScope(scope: RoleScope): string[] {
  return Object.entries(ROLE_SCOPES)
    .filter(([, scopes]) => scopes.includes(scope))
    .map(([role]) => role);
}

/**
 * **스펙 타입별 둘째 승인자의 직군**(2026-09-07 · REQ-API-138).
 *
 * 정본은 [1.6 역할과 권한 매트릭스](../../../../docs/01-problem/pain-points.md) 의 "스펙/CR
 * 승인·거절" 행이다 — 그 행의 ○ 는 **"지정 시"** 라는 뜻이지 전역 권한이 아니다. 그래서
 * `ROLE_SCOPES` 를 넓히지 않고 결재 행의 슬롯(`approval.assignee_role`)으로 실현한다:
 * designer 가 지정 없이 모든 design 문서를 결재하게 되면 ○ 가 ● 로 바뀌는 것이고,
 * 그것은 매트릭스를 고치는 결정이지 구현이 아니다.
 */
export const SPEC_APPROVER_ROLES: Readonly<Record<string, string>> = {
  vision: 'admin',
  area: 'planner',
  feature: 'qa',
  design: 'designer',
  convention: 'developer',
  adr: 'developer',
};

/**
 * **검토 요청(in_review 제출)을 할 수 있는 역할** — 작성자 본인은 역할과 무관하게 할 수 있다.
 *
 * 매트릭스의 "in_review 제출" ● 열이다. 이 문이 없던 동안 아무나 남의 초안을 제출할 수
 * 있었고, 그러면 **작성자가 자기 초안을 승인**할 수 있었다(요청자만 비교했기 때문이다).
 */
export const SPEC_SUBMIT_ROLES = ['admin', 'planner'] as const;
