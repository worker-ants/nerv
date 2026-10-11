// PAT 권한 어휘 — 정본: docs/04-mvp/api.md §1.3 · agent-integration §2.3 "필요 권한" 열
//
// `resource:action` 표기다. 두 가지가 이 파일의 존재 이유다.
//
//   ① **사람 전용 권한은 토큰에 부여 자체가 불가능하다.** `approval:decide` 는 정책이 아니라
//      **시스템 불변식**이다(agent-integration §6.1 ④). "설정에서 끄면 되는 것"이 아니라 발급
//      경로에 존재하지 않아야 한다. `spec:approve` 도 오래 이 자리에 있었는데, 2026-10-11 사람
//      결정으로 **옵트인 토큰 권한**이 됐다 — 에이전트 세션에서 사람이 대답으로 승인하는
//      `nerv_spec_approve`(A3) 하나만 이 권한을 본다. 권장 묶음에는 넣지 않고, 역할에 그 권한이
//      없는 사람(admin · planner 밖)의 토큰에서는 검증할 때 교집합으로 빠진다.
//   ② **MCP 도구 대응이 없는 권한이 셋 있다** — `import:write`(admin 전용 이관 표면) ·
//      `spec:meta`(EP-SPEC-12·15~17) · `spec:evidence`(EP-REQ-03). 나머지 여덟이 도구 27종을
//      덮는다. "도구 표와 1:1" 은 그 여덟에 대한 말이고, 이 셋은 REST 축이다(api.md §1.3).

/** 토큰에 부여할 수 있는 권한. */
export const AGENT_SCOPES = [
  'spec:read',
  'spec:draft',
  'spec:meta',
  // 옵트인 — 사람이 세션에서 대답으로 승인할 때만 쓴다(nerv_spec_approve · A3). 권장 묶음에 없다
  'spec:approve',
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
 * **권장 묶음** — 에이전트가 스킬 다섯(next·spec·impl·question·review)을 쓰는 데 드는 권한
 * (2026-09-24 · REQ-WEB-207 · plugin.md §4 1단계). 발급 폼의 기본값이다.
 *
 * 폼의 기본값이 `spec:read`·`task:claim` 둘이던 동안 그대로 발급한 토큰은 `nerv_bootstrap` 이
 * 요구하는 `agent-session:launch` 가 없어 설치 4·5단계에서 처음부터 막혔다 — 매뉴얼은 그 함정을
 * 설명하고 있었지만 화면의 기본값은 그대로였다. 역할에 없는 권한은 발급할 때 교집합으로 빠진다.
 * `review:resolve`·`spec:meta`·`spec:evidence`·`import:write` 는 넣지 않는다 — 일부 역할의 일이거나
 * 이관 전용이라 필요한 사람이 직접 고른다.
 */
export const AGENT_RECOMMENDED_SCOPES = [
  'spec:read',
  'spec:draft',
  'task:claim',
  'task:update',
  'review:submit',
  'agent-session:launch',
] as const satisfies readonly AgentScope[];

/**
 * 사람 전용 — 어떤 자율성 레벨에서도 토큰이 가질 수 없다.
 * 카탈로그에 대응 MCP 도구가 **존재하지 않는 것**이 설계다(agent-integration §2.1 원칙 3).
 *
 * `spec:approve` 는 여기 없다(2026-10-11 사람 결정). 결재 카드를 내리는 권한(`approval:decide`)은
 * 그대로 사람 전용이고, 토큰의 `spec:approve` 는 **세션에서 사람이 대답한 승인**을 서버에 전하는
 * 문 하나다 — 그 문은 클라이언트의 승인 창(A3)과 역할(admin · planner)을 함께 지나야 열린다.
 */
export const HUMAN_ONLY_SCOPES = ['approval:decide'] as const;

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
// 토큰이 역할보다 넓을 수 없다는 뜻이다 — 상한은 요청할 때의 역할이다(서버가 요청마다 지금 역할과
// 교집합을 낸다). 그래서 역할이 줄면 이미 발급한 토큰에도 바로 반영되고, 역할이 늘어도 토큰에 없던
// 권한은 생기지 않는다(새로 발급해야 한다).

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
 * **작업을 만들고 고치는 역할**(EP-TASK-03 · EP-TASK-05 — 전표의 권한 열).
 *
 * 서버 가드(`RequireRoleAndScope`)와 화면이 **같은 값을 본다**(2026-09-24 — UI/UX 검토 ·
 * REQ-WEB-203). 화면이 역할을 보지 않던 동안 designer 는 제목과 4요소를 다 적고 저장한 뒤에야
 * 403 을 받았고, qa 는 리뷰 센터에서 올린 작업의 [채우기]를 다 채운 뒤 403 을 받았다.
 * 두 목록이 다른 이유는 전표가 그렇게 적었기 때문이다 — qa 는 발견을 작업으로 **올리지만**
 * 위임 명세는 쓰지 않는다.
 */
export const TASK_CREATE_ROLES = ['planner', 'developer', 'admin', 'qa'] as const;
export const TASK_EDIT_ROLES = ['planner', 'developer', 'admin'] as const;

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
/**
 * **검증 서명을 남길 수 있는 역할**(2026-09-07 · REQ-API-143). `kind=test` 증적을 이 역할의 사람이
 * 올리면 그 자리에서 서명이 붙고, 파생이 `verified` 를 판정한다. 에이전트 세션이 올린 것은 서명이
 * 아니다. 화면은 같은 목록으로 "영향 없음 확인" 을 보일지 정한다(2026-09-26 · REQ-WEB-241).
 */
export const EVIDENCE_SIGNER_ROLES = ['qa', 'admin'] as const;

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

/**
 * **자기 결재를 승인할 수 있는 역할**(2026-10-11 사람 결정 · api.md REQ-API-288).
 *
 * 지시자≠승인자(spec-workflow §2.3)는 요청자 · 작성자 · 작성 세션의 소유자가 그 결재를 승인하지
 * 못하게 한다. admin 은 2026-08-30 부터 예외였고, 이 결정으로 planner 도 예외가 됐다 — 기획자가
 * 자기 세션이 쓴 초안을 그 자리에서 승인하는 것이 이 플랫폼의 주 경로라서다. 예외를 허용하는
 * 것과 감추는 것은 다른 일이라 결정 이벤트에 `self_approved` 가 남는다. 정족수의 "서로 다른
 * 사용자"(T3)는 이 목록과 상관없이 그대로다.
 */
export const SELF_APPROVAL_ROLES = ['admin', 'planner'] as const;

/**
 * **바로 승인을 할 수 있는가**(2026-10-11 · api.md REQ-API-287) — 초안을 검토 요청과 승인 한 번으로
 * 확정하는 동작이다. 제출(`spec:approve` 를 가진 역할)과 결재(`approval:decide`)를 함께 하므로 둘 다
 * 있어야 한다. 서버와 화면이 같은 식을 본다 — 화면이 역할 목록을 따로 적으면 두 벌이 된다.
 */
export function canDirectApprove(roles: readonly string[]): boolean {
  const scopes = scopesForRoles(roles);
  return scopes.has('spec:approve') && scopes.has('approval:decide');
}

/** 바로 승인을 할 수 있는 역할 — 잠긴 단추가 "누가 할 수 있는가" 를 말할 때 쓴다(위 식에서 파생한다) */
export const DIRECT_APPROVE_ROLES: readonly string[] = Object.keys(ROLE_SCOPES).filter((role) =>
  canDirectApprove([role]),
);

/**
 * **리뷰 종류마다 면제할 수 있는 역할**(2026-10-09 · api.md REQ-API-274). 정본은 spec-workflow §1.6 의 권한표다 —
 * 게이트 면제(BYPASS)는 admin ● · planner ○ 스펙 계열만 · developer ○ 코드 계열만 · 에이전트 불가. 코드 계열은 `code` ·
 * `merge`, 스펙 계열은 `consistency` · `spec_coverage` 다. 범위를 고른 면제(`kinds`)가 이 표로 판정한다. 범위 없는 면제는
 * admin만 내고, planner · developer의 범위 없는 면제는 이 표로 풀어 읽는다(2026-10-11 · REQ-API-293).
 */
export const REVIEW_WAIVER_ROLES: Readonly<Record<string, readonly string[]>> = {
  code: ['admin', 'developer'],
  merge: ['admin', 'developer'],
  consistency: ['admin', 'planner'],
  spec_coverage: ['admin', 'planner'],
};

/** 그 역할들로 면제할 수 있는 리뷰 종류인가 — 서버 판정과 화면이 같은 표를 본다 */
export function canWaiveReviewKind(roles: readonly string[], kind: string): boolean {
  const allowed = REVIEW_WAIVER_ROLES[kind] ?? [];
  return roles.some((role) => allowed.includes(role));
}

/** 그 역할들로 면제할 수 있는 리뷰 종류 전부(표의 순서) — 범위 없는 면제를 풀어 읽을 때 쓴다 */
export function waivableReviewKinds(roles: readonly string[]): string[] {
  return Object.keys(REVIEW_WAIVER_ROLES).filter((kind) => canWaiveReviewKind(roles, kind));
}

/**
 * **범위 없는 면제는 admin만 낸다**(2026-10-11 · api.md REQ-API-293 · 사람 결정). 권한표의 admin ● 자리다. planner ·
 * developer가 종류를 고르지 않고 면제하면 그 역할이 면제할 수 있는 종류 전부(`waivableReviewKinds`)로 풀어 읽는다 —
 * 범위 없는 면제가 "스펙 계열만 · 코드 계열만" 을 넘지 않게 한다. 종류로 나뉘지 않은 조건(정책이 `true`인 리뷰 커버리지)
 * 과 작업이 아닌 대상의 면제도 그래서 admin만 낸다.
 */
export function canBypassUnscoped(roles: readonly string[]): boolean {
  return roles.includes('admin');
}

/**
 * **코드 계열 리뷰의 면제는 코드 증적이 없는 작업에만 적용된다**(2026-10-09 · REQ-API-274). 면제의 전제가 "이 작업은 코드를
 * 내지 않았다" 이므로, 커밋 · PR · 코드 경로 증적이 붙은 작업에서는 그 면제를 받지 않고, 면제 뒤에 붙으면 done 게이트가
 * 그 면제를 세지 않는다 — 코드가 있는 작업의 code 리뷰 요구를 약하게 하지 않는다.
 */
export const CODE_REVIEW_KINDS = ['code', 'merge'] as const;
export const CODE_EVIDENCE_KINDS = ['commit', 'pr', 'code_path'] as const;
