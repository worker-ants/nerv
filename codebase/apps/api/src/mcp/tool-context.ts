// 도구 실행 컨텍스트 — 표면이 도메인 서비스에 넘기는 "누가·어디서"의 묶음.
//
// MCP 도구는 REST 와 달리 경로에 프로젝트가 없다. PAT 가 프로젝트에 바인딩돼 있으므로
// (api.md §1.3) 컨텍스트가 그것을 나른다 — 도구 입력의 `project` 인자는 검증용이지
// 권한의 근거가 아니다. 근거는 언제나 토큰이다.

import type { Principal } from '../modules/auth/auth.service.js';
import type { SessionCandidate } from '../modules/session/session.service.js';

export interface ToolContext {
  principal: Principal;
  /** 토큰이 바인딩된 프로젝트 */
  projectId: string;
  /**
   * 이 호출을 낸 에이전트 세션 — 명시 인자(`session_id`) 또는 **살아 있는 세션 추정**이다.
   * `nerv_bootstrap` 전에는 없고, 후보가 여럿이면 고르지 않으므로 여기도 null 이다.
   */
  sessionId: string | null;
  /**
   * 추정 후보 — 하나로 좁히지 못했을 때의 목록이다(§1.4c).
   *
   * 세션을 **요구하지 않는** 도구(스펙 읽기 등)는 여럿이어도 그냥 돌아야 하므로, 모호함은
   * 여기서 던지지 않고 `requireSession` 이 필요할 때 던진다.
   */
  sessionCandidates?: readonly SessionCandidate[];
  /** A2 이상 도구의 공통 입력(agent-integration §2.1 원칙 4) */
  idempotencyKey?: string | undefined;
}
