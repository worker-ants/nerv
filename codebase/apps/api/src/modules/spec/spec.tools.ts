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
import { SpecRelationService } from './spec-relation.service.js';
import type { SpecGraphEdge, SpecTreeNode } from './spec.service.js';

@Injectable()
export class SpecTools implements NervToolProvider {
  constructor(
    private readonly specs: SpecService,
    private readonly searches: SearchService,
    private readonly comments: SpecCommentService,
    private readonly relations: SpecRelationService,
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
          // 관계까지 필요하면 여기서 함께 받는다 — 별도 도구를 만들지 않는 이유는
          // "구조를 달라"는 한 가지 요청이기 때문이다(도구 15종 고정 — scope.md §4.2)
          include_relations: { type: 'boolean', default: false },
          around: { type: 'string', description: 'mcp.arg.around' },
          hops: { type: 'integer', minimum: 1, maximum: 3, default: 1 },
        },
      },
      handler: async (input, ctx) => {
        if (input['include_relations'] !== true) {
          return { nodes: await this.specs.tree({ projectId: ctx.projectId }) };
        }
        const graph = await this.specs.graph({ projectId: ctx.projectId });
        const around = typeof input['around'] === 'string' ? input['around'] : null;
        // 전역 그래프는 141노드·1,253간선이다 — 매번 통째로 실어 보내면 에이전트의
        // 컨텍스트 예산이 그것으로 찬다. 중심을 주면 그 주변만 돌려준다.
        if (around === null) return graph;
        const hops = typeof input['hops'] === 'number' ? input['hops'] : 1;
        return neighborhood(graph, around, hops);
      },
    },
    {
      name: 'nerv_spec_relate',
      tier: 'A2',
      // 쓰기 도구다 — 초안 저장(nerv_spec_draft_upsert)과 같은 P1 등급이다
      phase: 'P1',
      summaryKey: 'mcp.tool.declare_relation',
      // 본문을 고치는 것과 같은 등급이다 — 관계는 그래프의 사실이고, 틀리면 영향 분석이 틀린다
      scope: 'spec:draft',
      inputSchema: {
        type: 'object',
        required: ['from', 'to', 'kind'],
        properties: {
          project: { type: 'string' },
          from: { type: 'string', description: 'spec key (SPC-…) or UUID' },
          to: { type: 'string', description: 'spec key (SPC-…) or UUID' },
          kind: { type: 'string', enum: ['refines', 'depends_on', 'duplicates', 'supersedes'] },
          // 되돌리는 경로를 같은 도구에 둔다 — 잘못 넣은 관계를 지울 수 없으면 아무도 안 넣는다
          remove: { type: 'boolean', default: false },
        },
      },
      handler: async (input, ctx) =>
        this.relations.declare({
          projectId: ctx.projectId,
          fromKey: String(input['from']),
          toKey: String(input['to']),
          kind: String(input['kind']),
          remove: input['remove'] === true,
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
          // 키·UUID 둘 다 받는다(§1.4b) — 도구마다 기준이 다르면 에이전트가 실패로 배운다
          spec_id: { type: 'string', description: 'spec key (SPC-…) or UUID' },
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
          spec_id: {
            type: 'string',
            description: 'existing spec — key (SPC-…) or UUID. omit to create a new one',
          },
          body_md: { type: 'string' },
          base_version: { type: 'string' },
          idempotency_key: { type: 'string' },
          // **생성에 필요한 메타.** 이 넷이 없으면 에이전트는 기존 스펙 이어쓰기만 할 수
          // 있고 새 스펙을 시작하지 못한다 — 실제로 그 상태였다(실측 2026-08-23).
          // 기존 spec_id 지정 호출에서 다른 값이 오면 409 다(REQ-API-021) — 메타 수정은
          // 거버넌스 대상이라 EP-SPEC-15 전담이다(api.md §2.2).
          key: { type: 'string', description: 'new spec only — stable display key' },
          title: { type: 'string', description: 'new spec only' },
          type: {
            type: 'string',
            enum: ['vision', 'area', 'feature', 'design', 'convention', 'adr'],
            description: 'new spec only',
          },
          parent_id: { type: 'string', description: 'new spec only — parent key or UUID' },
          // **선언 관계** — 본문의 링크가 만드는 `references` 와 다른 축이다(§2.2).
          // 정제·선행은 문서를 읽어야 아는 판단이라 문장에 적히지 않으므로 명시해야 남는다.
          // 주지 않으면 건드리지 않고, 빈 배열은 "전부 지워라"다.
          relations: {
            type: 'array',
            description: 'mcp.arg.relations',
            items: {
              type: 'object',
              required: ['to', 'kind'],
              properties: {
                to: { type: 'string', description: 'spec key (SPC-…) or UUID' },
                kind: {
                  type: 'string',
                  enum: ['refines', 'depends_on', 'duplicates', 'supersedes'],
                },
              },
            },
          },
        },
        required: ['body_md'],
      },
      handler: async (input, ctx) =>
        this.specs.draftUpsert({
          projectId: ctx.projectId,
          roles: ctx.principal.roles,
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          bodyMd: String(input['body_md'] ?? ''),
          ...(typeof input['spec_id'] === 'string' ? { specId: input['spec_id'] } : {}),
          ...(typeof input['base_version'] === 'string'
            ? { baseVersionId: input['base_version'] }
            : {}),
          ...(typeof input['key'] === 'string' ? { key: input['key'] } : {}),
          ...(typeof input['title'] === 'string' ? { title: input['title'] } : {}),
          ...(typeof input['type'] === 'string' ? { type: input['type'] } : {}),
          ...(typeof input['parent_id'] === 'string' ? { parentId: input['parent_id'] } : {}),
          ...(Array.isArray(input['relations'])
            ? { relations: input['relations'] as { to: string; kind: string }[] }
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

/**
 * 중심에서 hop 이내의 부분 그래프 — 에이전트에게 전역을 통째로 주지 않기 위한 것이다.
 * 141노드·1,253간선을 매번 실어 보내면 컨텍스트 예산이 그것으로 찬다.
 */
function neighborhood(
  graph: { nodes: SpecTreeNode[]; edges: SpecGraphEdge[] },
  aroundKey: string,
  hops: number,
): { nodes: SpecTreeNode[]; edges: SpecGraphEdge[] } {
  const start = graph.nodes.find((n) => n.key === aroundKey);
  if (start === undefined) return { nodes: [], edges: [] };
  const near = new Set([start.id]);
  for (let i = 0; i < hops; i += 1) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (near.has(edge.from_id) && !near.has(edge.to_id)) next.push(edge.to_id);
      if (near.has(edge.to_id) && !near.has(edge.from_id)) next.push(edge.from_id);
    }
    if (next.length === 0) break;
    for (const id of next) near.add(id);
  }
  return {
    nodes: graph.nodes.filter((n) => near.has(n.id)),
    edges: graph.edges.filter((e) => near.has(e.from_id) && near.has(e.to_id)),
  };
}
