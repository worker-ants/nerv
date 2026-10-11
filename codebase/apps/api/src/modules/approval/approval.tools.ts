// MCP — nerv_spec_approve. 사람이 세션에서 대답한 승인을 서버에 전한다 (2026-10-11 사람 결정 · api.md REQ-API-291)
//
// **승인 권한을 가진 도구는 오래 없었다**(agent-integration §2.1 원칙 3). 이 도구가 그 원칙을 버리는 것이
// 아니라 좁힌다: 결재 카드를 내리는 권한(`approval:decide`)은 여전히 사람 전용이고, 이 도구가 하는 일은
// "사람이 방금 이 대화에서 승인하라고 했다" 를 서버에 전하는 것 하나다. 문은 셋이 함께 지킨다 —
//
//   ① **A3** — 스킬의 `allowed-tools` 에 넣지 않으므로 클라이언트가 호출마다 사람에게 묻는다.
//   ② **토큰의 옵트인 권한** `spec:approve` — 권장 묶음에 없다. 사람이 골라야 생긴다.
//   ③ **역할** — admin · planner 만 바로 승인한다(`canDirectApprove`). 판정은 결재 서비스 한 곳이다.
//
// 본 지문(`seen_content_hash`)은 필수다. 초안은 가변이라 "보여 준 것" 과 "승인되는 것" 이 같아야 한다.
import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { requireSession } from '../session/session.tools.js';
import { ApprovalService } from './approval.service.js';

@Injectable()
export class ApprovalTools implements NervToolProvider {
  constructor(private readonly approvals: ApprovalService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_spec_approve',
      tier: 'A3',
      phase: 'P1',
      summaryKey: 'mcp.tool.approve_on_reply',
      scope: 'spec:approve',
      inputSchema: {
        type: 'object',
        properties: {
          spec_version_id: { type: 'string', description: 'mcp.arg.approve_version' },
          seen_content_hash: { type: 'string', description: 'mcp.arg.seen_content_hash' },
          session_id: { type: 'string', description: 'mcp.arg.session_id' },
          idempotency_key: { type: 'string' },
        },
        required: ['spec_version_id', 'seen_content_hash'],
      },
      handler: async (input, ctx) =>
        this.approvals.approveDirect({
          actor: { userId: ctx.principal.userId, isAgent: ctx.principal.isAgent },
          surface: 'mcp',
          projectId: ctx.projectId,
          specVersionId: String(input['spec_version_id'] ?? ''),
          userId: ctx.principal.userId,
          seenContentHash: String(input['seen_content_hash'] ?? ''),
          // **어느 세션에서 사람이 대답했나**가 감사의 축이다 — 세션 없이는 받지 않는다
          sessionId: requireSession(ctx),
        }),
    },
  ];
}
