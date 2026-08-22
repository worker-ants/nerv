// better-auth 래핑 — organization 플러그인(조직·멤버십) + api-key 플러그인(PAT)
// 정본: docs/04-mvp/api.md §1.3 · docs/03-proposal/agent-integration.md §6.1(D-08)
//
// 인증은 2경로다(웹 세션 쿠키 / PAT Bearer). PAT 는 (사용자, 프로젝트, 역할, 스코프) 튜플에
// 바인딩되고 권한은 소유 사용자의 부분집합을 넘지 못한다. `spec:approve`·`approval:decide` 는
// 토큰에 부여 자체가 불가능한 사람 전용 스코프다 — 정책이 아니라 시스템 불변식이다.

import { Injectable } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import type { AuthContext } from '../../common/auth.guard.js';

/** membership.role 정본 — docs/03-proposal/data-model.md §2.1 */
export type MembershipRole = 'admin' | 'planner' | 'designer' | 'developer' | 'qa' | 'viewer';

export interface Principal {
  userId: string;
  isAgent: boolean;
  role: MembershipRole;
  scopes: readonly string[];
  projectId: string | null;
}

@Injectable()
export class AuthService {
  /** 자격증명 검증 → Principal. AuthGuard 가 이 메서드에 연결된다. */
  verify(_auth: AuthContext): never {
    throw new NotImplementedYetError('E03-S02', 'PAT·세션 자격증명 검증');
  }

  /** 프로젝트 멤버십 검사 — REST·WS join·SSE 가 같은 판정을 쓴다(D-05). */
  assertMembership(): never {
    throw new NotImplementedYetError('E03-S02', '프로젝트 멤버십 판정');
  }

  /** PAT 발급 — 원문은 발급 응답에서 한 번만 반환한다(api.md §1.3). */
  issueToken(): never {
    throw new NotImplementedYetError('E03-S02', 'PAT 발급');
  }

  revokeToken(): never {
    throw new NotImplementedYetError('E03-S02', 'PAT 폐기');
  }
}
