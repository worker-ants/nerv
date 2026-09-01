// MCP — nerv_review_* 2종(Phase 2). REST 컨트롤러와 같은 ReviewService 를 쓴다(D-05).
//
// 이 두 도구가 **리뷰 산출물을 저장소에서 걷어낸다**(agent-integration §5.1 금지 목록 —
// "리뷰 산출물을 저장소에 파일로 커밋하지 않는다"). 표면은 번역만 한다 — dedup·라운드·
// A3 판정은 전부 서비스 안에 있다(REQ-CB-003).

import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { ReviewService } from './review.service.js';
import type { ResolutionKind, SubmitFinding } from './review.service.js';

/** 선언된 area 만 받는다 — 모르는 값은 안 준 것으로 보고 서버가 추론한다 */
const AREAS = ['codebase', 'spec', 'task', 'process'];

/** 도구 계약의 `resolution` 3값 → 저장 모델의 (kind, status) 짝. */
const RESOLUTION: Readonly<
  Record<string, { kind: ResolutionKind; status: 'fixed' | 'dismissed' | 'wont_fix' }>
> = {
  fixed: { kind: 'fixed', status: 'fixed' },
  // **스펙을 고쳐 해결했다.** 발견은 닫히므로 상태는 `fixed` 와 같고, `왜` 를 담는
  // `resolution_kind` 만 다르다 — 그래야 "이 발견들은 무엇으로 해결됐나" 를 나중에
  // 되물을 수 있다(spec_drift 지적이 코드 커밋으로 닫혔다면 그건 이상 신호다).
  spec_change: { kind: 'spec_change', status: 'fixed' },
  dismissed: { kind: 'dismissed', status: 'dismissed' },
  // `wont_fix` 는 처분 이름이 없다 — 유예(deferred)로 기록하고 상태만 wont_fix 다.
  // 이 둘을 가르는 이유는 `resolution_kind` 가 **왜**를, `finding_status` 가 **무엇**을
  // 담기 때문이다(database.md §2.7 두 enum).
  wont_fix: { kind: 'deferred', status: 'wont_fix' },
};

@Injectable()
export class ReviewTools implements NervToolProvider {
  constructor(private readonly reviews: ReviewService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_review_submit',
      tier: 'A2',
      phase: 'P2',
      summaryKey: 'mcp.tool.after_review',
      scope: 'review:submit',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          base_sha: { type: 'string' },
          head_sha: { type: 'string' },
          changeset: { type: 'array', items: { type: 'string' } },
          kind: { type: 'string', enum: ['code', 'consistency', 'spec_coverage', 'merge'] },
          task_id: { type: 'string' },
          reviewer: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
            required: ['role'],
          },
          summary: { type: 'string' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
                title: { type: 'string' },
                body: { type: 'string' },
                suggestion: { type: 'string' },
                category: { type: 'string' },
                file: { type: 'string' },
                line: { type: 'integer' },
                symbol: { type: 'string' },
                requirement_id: { type: 'string' },
                spec_version_id: { type: 'string' },
                // **어디에 대한 지적인가** — 지적한 쪽이 가장 잘 안다. 안 주면 서버가
                // 출처로 유추하고 그 사실을 남긴다(REQ-API-073)
                area: {
                  type: 'string',
                  enum: ['codebase', 'spec', 'task', 'process'],
                  description: 'mcp.arg.finding_area',
                },
              },
              required: ['severity', 'title'],
            },
          },
          payload_ref: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['branch', 'base_sha', 'head_sha', 'reviewer'],
      },
      handler: async (input, ctx) => {
        const reviewer = (input['reviewer'] ?? {}) as { role?: string; risk?: string };
        const result = await this.reviews.submit({
          projectId: ctx.projectId,
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          isAgent: ctx.principal.isAgent,
          branch: String(input['branch'] ?? ''),
          baseSha: String(input['base_sha'] ?? ''),
          headSha: String(input['head_sha'] ?? ''),
          changeset: asStrings(input['changeset']),
          kind: (typeof input['kind'] === 'string' ? input['kind'] : 'code') as 'code',
          taskId: typeof input['task_id'] === 'string' ? input['task_id'] : null,
          reviewer: {
            role: String(reviewer.role ?? ''),
            risk: (reviewer.risk ?? null) as 'low' | null,
          },
          summaryMd: typeof input['summary'] === 'string' ? input['summary'] : null,
          findings: asFindings(input['findings']),
          payloadRef: typeof input['payload_ref'] === 'string' ? input['payload_ref'] : null,
        });
        return {
          ...result,
          // 다음 행동은 **열린 것이 있느냐**가 정한다 — 없으면 리뷰는 끝이다(§2.1 원칙 5)
          next_actions: result.carried_over.length > 0 ? ['nerv_finding_resolve'] : [],
        };
      },
    },
    {
      name: 'nerv_finding_resolve',
      // 카탈로그 티어는 A2 다. **critical → dismissed/wont_fix 만 A3 로 올라간다**
      // (agent-integration §2.3) — 그 판정은 입력을 봐야 알 수 있으므로 정적 티어가
      // 아니라 서비스가 승인 큐로 보낸다(NERV_APPROVAL_REQUIRED).
      tier: 'A2',
      phase: 'P2',
      summaryKey: 'mcp.tool.after_fix',
      scope: 'review:resolve',
      inputSchema: {
        type: 'object',
        properties: {
          finding_id: { type: 'string' },
          resolution: {
            type: 'string',
            enum: ['fixed', 'spec_change', 'dismissed', 'wont_fix'],
          },
          commit_sha: { type: 'string', description: 'mcp.arg.commit_sha' },
          // 스펙을 고쳐 해결했을 때의 증거 — `nerv_spec_draft_upsert` 응답의 버전 id
          spec_version_id: { type: 'string', description: 'mcp.arg.resolution_spec_version' },
          change_request_id: { type: 'string' },
          rationale: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['finding_id', 'resolution', 'rationale'],
      },
      handler: async (input, ctx) => {
        const asked = String(input['resolution'] ?? '');
        const mapped = RESOLUTION[asked] ?? RESOLUTION['dismissed']!;
        const result = await this.reviews.resolve({
          projectId: ctx.projectId,
          findingId: String(input['finding_id'] ?? ''),
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          isAgent: ctx.principal.isAgent,
          kind: mapped.kind,
          status: mapped.status,
          rationale: String(input['rationale'] ?? ''),
          commitSha: typeof input['commit_sha'] === 'string' ? input['commit_sha'] : null,
          changeRequestId:
            typeof input['change_request_id'] === 'string' ? input['change_request_id'] : null,
          specVersionId:
            typeof input['spec_version_id'] === 'string' ? input['spec_version_id'] : null,
        });
        return {
          ...result,
          next_actions: result.open_remaining > 0 ? ['nerv_finding_resolve'] : ['nerv_task_update'],
        };
      },
    },
  ];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asFindings(value: unknown): SubmitFinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const f = raw as Record<string, unknown>;
    return {
      severity: (f['severity'] ?? 'info') as 'info',
      title: String(f['title'] ?? ''),
      body_md: typeof f['body'] === 'string' ? f['body'] : null,
      suggestion_md: typeof f['suggestion'] === 'string' ? f['suggestion'] : null,
      category: typeof f['category'] === 'string' ? f['category'] : null,
      file: typeof f['file'] === 'string' ? f['file'] : null,
      line: typeof f['line'] === 'number' ? f['line'] : null,
      symbol: typeof f['symbol'] === 'string' ? f['symbol'] : null,
      requirement_id: typeof f['requirement_id'] === 'string' ? f['requirement_id'] : null,
      spec_version_id: typeof f['spec_version_id'] === 'string' ? f['spec_version_id'] : null,
      area: AREAS.includes(String(f['area'])) ? (f['area'] as SubmitFinding['area']) : null,
    };
  });
}
