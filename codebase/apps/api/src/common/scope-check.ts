// 권한 판정 한 곳 (api.md §1.3 · D-05)
//
// 서비스 메서드가 아니라 함수인 이유: 컨트롤러가 이것을 쓰려고 AuthService 를 주입하면
// 표면이 도메인 서비스를 끌어오는 모양이 된다. 판정에 필요한 것은 주체와 권한뿐이다.

import { msg, NERV_ERROR } from '@nerv/schema';
import type { RoleScope } from '@nerv/schema';
import { NervError } from './nerv-exception.filter.js';
import type { Principal } from '../modules/auth/auth.service.js';

/**
 * **두 경로가 같은 어휘로 판정된다.**
 *
 * 예전에는 `if (!principal.isAgent) return;` 로 세션을 통과시키고 "세션 사용자는 역할
 * 매트릭스가 판정한다"고 적어 두었는데, 그 매트릭스가 없어 웹으로 들어오면 `viewer` 도
 * 메타 편집·아카이브·기준선 동결을 통과했다(실측 2026-08-23).
 *
 * 지금은 주체의 `scopes` 가 이미 유효 권한이다:
 *   - 세션: 역할이 허용하는 권한 (ProjectAccessGuard 가 채운다)
 *   - PAT: 역할 ∩ 토큰 (verifyPat 이 교집합을 낸다)
 */
export function assertScope(principal: Principal, required: RoleScope): void {
  if (principal.scopes.includes(required)) return;
  throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.scope_missing', { scope: required }), {
    kind: 'missing_scope',
    required,
    granted: principal.scopes,
    roles: principal.roles,
  });
}

/**
 * 요청에서 주체를 꺼낸다. 컨트롤러마다 따로 만들던 것을 여기로 모은다 —
 * 권한 판정과 짝이라 같은 자리에 있는 편이 낫다.
 */
export function principalOf(req: { nervPrincipal?: Principal }): Principal {
  const principal = req.nervPrincipal;
  if (principal === undefined) {
    throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), { kind: 'missing' });
  }
  return principal;
}
