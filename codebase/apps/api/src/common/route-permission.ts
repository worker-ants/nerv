// 라우트별 권한 선언 — api.md §2 전표의 "권한" 열을 코드에 옮긴다 (2026-09-02)
//
// **왜 선언인가.** 판정 함수(`assertScope`)는 처음부터 있었는데 부르는 곳이 spec·review·
// import 세 컨트롤러뿐이었다. task·approval·session 컨트롤러는 한 번도 부르지 않았고,
// 그래서 `viewer` 세션이나 `spec:read` 만 가진 PAT 로 Task 생성·클레임·전이·초안 저장·
// 스펙 승인이 전부 통과했다(실측 2026-09-02). **"부르는 것을 잊었다"가 실패 모드였다.**
//
// 그래서 부르지 않는 것을 불가능하게 만든다: 프로젝트 경로(`/projects/{proj}/**`)의 라우트는
// 권한을 **선언해야 하고**, 선언이 없으면 `ProjectAccessGuard` 가 요청을 거절한다(fail-closed).
// 새 라우트를 열면 다음 테스트 실행에서 즉시 드러난다 — 조용히 열려 있는 대신에.
//
// 두 축을 그대로 옮긴다. 전표가 스코프로 적은 것(`task:claim`)은 `@RequireScope`,
// 역할로 적은 것(planner·developer·admin)은 `@RequireRole` 이다. 소유권 조건
// ("클레임 보유자", "작성자 본인")은 여기서 판정할 수 없다 — 그것은 도메인 서비스의 몫이고
// 이 선언은 그 앞의 문턱이다.

import { SetMetadata } from '@nestjs/common';
import type { RoleScope } from '@nerv/schema';

export const ROUTE_PERMISSION = 'nerv:route-permission';

/**
 * 축 **안에서는 하나라도**(any-of), 축 **사이에서는 둘 다**(AND).
 * `{roles: ['admin'], scopes: ['import:write']}` 는 전표의 "admin + `import:write`" 다.
 */
export interface RoutePermission {
  scopes?: readonly RoleScope[];
  /** 겸직은 역할의 합집합이다(0003_multi_role) — 하나라도 맞으면 통과 */
  roles?: readonly string[];
}

/** 전표가 스코프로 적은 권한. 여럿이면 **하나라도** 있으면 통과다. */
export const RequireScope = (...scopes: RoleScope[]): MethodDecorator =>
  SetMetadata(ROUTE_PERMISSION, { scopes } satisfies RoutePermission);

/** 전표가 역할로 적은 권한(예: EP-TASK-05 planner·developer·admin). */
export const RequireRole = (...roles: string[]): MethodDecorator =>
  SetMetadata(ROUTE_PERMISSION, { roles } satisfies RoutePermission);

/** 역할과 스코프를 **함께** 요구한다(EP-IMP-* 의 `admin AND import:write`). */
export const RequireRoleAndScope = (roles: string[], ...scopes: RoleScope[]): MethodDecorator =>
  SetMetadata(ROUTE_PERMISSION, { roles, scopes } satisfies RoutePermission);

/**
 * 멤버십으로 충분한 라우트(전표의 "프로젝트 멤버"). **비어 있음을 명시한다** —
 * 선언을 잊은 것과 권한 축이 없는 것은 다르고, 그 차이를 가드가 구별해야 한다.
 */
export const MemberOnly = (): MethodDecorator =>
  SetMetadata(ROUTE_PERMISSION, {} satisfies RoutePermission);
