// 도구 실행 컨텍스트 — 표면이 도메인 서비스에 넘기는 "누가·어디서"의 묶음.
//
// MCP 도구는 REST 와 달리 경로에 프로젝트가 없다. PAT 가 프로젝트에 바인딩돼 있으므로
// (api.md §1.3) 컨텍스트가 그것을 나른다 — 도구 입력의 `project` 인자는 검증용이지
// 권한의 근거가 아니다. 근거는 언제나 토큰이다.

import type { Principal } from '../modules/auth/auth.service.js';

export interface ToolContext {
  principal: Principal;
  /** 토큰이 바인딩된 프로젝트 */
  projectId: string;
  /** 이 호출을 낸 에이전트 세션. nerv_bootstrap 전에는 없다 */
  sessionId: string | null;
  /** A2 이상 도구의 공통 입력(agent-integration §2.1 원칙 4) */
  idempotencyKey?: string | undefined;
}
