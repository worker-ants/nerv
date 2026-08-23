// MCP — nerv_spec_* 7종 (docs/04-mvp/codebase.md §2.3 · api.md §4)
//
// 도구는 REST 컨트롤러와 **같은 SpecService 인스턴스**를 주입받는다 — 그것이 D-05 의 실물이고
// E01-S02 의 수용 기준이다. 입력 zod 검증·idempotency_key 공통 처리는 ToolRegistry 위에서
// E03-S01·E03-S04 가 얹는다.

import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { SearchService } from './search.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecService } from './spec.service.js';

@Injectable()
export class SpecTools implements NervToolProvider {
  constructor(
    private readonly specs: SpecService,
    private readonly searches: SearchService,
    private readonly comments: SpecCommentService,
  ) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_spec_tree',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.spec_explore',
      scope: 'spec:read',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          root: { type: 'string' },
          depth: { type: 'integer' },
        },
      },
      handler: async (_input, ctx) => ({
        nodes: await this.specs.tree({ projectId: ctx.projectId }),
      }),
    },
    {
      name: 'nerv_spec_search',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.gather_context',
      scope: 'spec:read',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          limit: { type: 'integer' },
          references: { type: 'string' },
        },
        required: ['q'],
      },
      // 검색 방식은 서버 내부 판정이다 — MCP 도 REST 와 같은 파이프라인·같은 순위다(§2.2b).
      handler: async (input, ctx) =>
        this.searches.search({
          projectId: ctx.projectId,
          query: String(input['q'] ?? ''),
          ...(typeof input['limit'] === 'number' ? { limit: input['limit'] } : {}),
          ...(typeof input['references'] === 'string' ? { references: input['references'] } : {}),
        }),
    },
    {
      name: 'nerv_spec_get',
      tier: 'A1',
      phase: 'P0',
      summaryKey: 'mcp.tool.before_impl',
      scope: 'spec:read',
      inputSchema: {
        type: 'object',
        properties: {
          spec_id: { type: 'string' },
          version: { type: 'integer' },
          baseline: { type: 'string' },
        },
        required: ['spec_id'],
      },
      handler: async (input, ctx) =>
        this.specs.get({
          projectId: ctx.projectId,
          specKey: String(input['spec_id'] ?? ''),
          versionNo: typeof input['version'] === 'number' ? input['version'] : null,
        }),
    },
    {
      name: 'nerv_spec_draft_upsert',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.draft_spec',
      scope: 'spec:draft',
      inputSchema: {
        type: 'object',
        properties: {
          spec_id: { type: 'string' },
          body_md: { type: 'string' },
          base_version: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['body_md'],
      },
      handler: async (input, ctx) =>
        this.specs.draftUpsert({
          projectId: ctx.projectId,
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          bodyMd: String(input['body_md'] ?? ''),
          ...(typeof input['spec_id'] === 'string' ? { specId: input['spec_id'] } : {}),
          ...(typeof input['base_version'] === 'string'
            ? { baseVersionId: input['base_version'] }
            : {}),
        }),
    },
    {
      name: 'nerv_spec_submit_review',
      tier: 'A3',
      phase: 'P1',
      summaryKey: 'mcp.tool.request_review',
      scope: 'spec:draft',
      inputSchema: {
        type: 'object',
        properties: { spec_version_id: { type: 'string' }, idempotency_key: { type: 'string' } },
        required: ['spec_version_id'],
      },
      handler: async (input, ctx) =>
        this.specs.submitReview({
          projectId: ctx.projectId,
          specVersionId: String(input['spec_version_id'] ?? ''),
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
        }),
    },
    {
      name: 'nerv_spec_check',
      tier: 'A1',
      phase: 'P1',
      summaryKey: 'mcp.tool.after_draft',
      scope: 'spec:read',
      inputSchema: {
        type: 'object',
        properties: { spec_version_id: { type: 'string' } },
        required: ['spec_version_id'],
      },
      handler: async (input, ctx) =>
        this.specs.check({
          projectId: ctx.projectId,
          specVersionId: String(input['spec_version_id'] ?? ''),
        }),
    },
    {
      name: 'nerv_spec_comment_resolve',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.after_comment',
      scope: 'spec:draft',
      inputSchema: {
        type: 'object',
        properties: {
          comment_id: { type: 'string' },
          resolution_note: { type: 'string' },
          idempotency_key: { type: 'string' },
        },
        required: ['comment_id'],
      },
      handler: async (input, ctx) =>
        this.comments.resolve({
          projectId: ctx.projectId,
          commentId: String(input['comment_id'] ?? ''),
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId ?? null,
          resolutionNote:
            typeof input['resolution_note'] === 'string' ? input['resolution_note'] : null,
        }),
    },
  ];
}
