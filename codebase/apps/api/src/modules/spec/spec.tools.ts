// MCP — nerv_spec_* 7종 (docs/04-mvp/codebase.md §2.3 · api.md §4)
//
// 도구는 REST 컨트롤러와 **같은 SpecService 인스턴스**를 주입받는다 — 그것이 D-05 의 실물이고
// E01-S02 의 수용 기준이다. 입력 zod 검증·idempotency_key 공통 처리는 ToolRegistry 위에서
// E03-S01·E03-S04 가 얹는다.

import { Injectable } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { SearchService } from './search.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecService } from './spec.service.js';
import { SpecRelationService } from './spec-relation.service.js';
import { AttachmentService } from './attachment.service.js';
import type { SpecGraphEdge, SpecTreeNode } from './spec.service.js';

@Injectable()
export class SpecTools implements NervToolProvider {
  constructor(
    private readonly specs: SpecService,
    private readonly searches: SearchService,
    private readonly comments: SpecCommentService,
    private readonly relations: SpecRelationService,
    private readonly attachments: AttachmentService,
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
          // **상대 문서의 지문** — 관계를 더할 때는 필수다(§1.4h). 읽지 않고 선언한 관계는
          // 그래프에 거짓을 심는다. 지울 때는 요구하지 않는다.
          base_hash: { type: 'string', description: 'mcp.arg.relation_base_hash' },
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
          ...(typeof input['base_hash'] === 'string' ? { baseHash: input['base_hash'] } : {}),
        }),
    },
    {
      /**
       * **에이전트도 시안을 올린다**(2026-09-01 사람 결정 · REQ-API-071).
       *
       * **두 단계인 이유**: MCP 응답에 수백 KB base64 를 실으면 그 세션의 컨텍스트 예산이
       * 그것으로 찬다. 자리를 받아 스토리지에 직접 올리고(`PUT`), 올렸다고 말한다 —
       * 서버는 **말만 듣지 않고 실제로 확인한 뒤** 확정한다: 링크가 깨진 시안은 시안이
       * 없는 것보다 나쁘다(사람이 그것을 찾아 헤맨다).
       */
      name: 'nerv_spec_attach',
      tier: 'A2',
      phase: 'P1',
      summaryKey: 'mcp.tool.attach',
      scope: 'spec:draft',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          spec_id: { type: 'string', description: 'spec key (SPC-…) or UUID' },
          filename: { type: 'string' },
          content_type: {
            type: 'string',
            enum: [
              'image/png',
              'image/jpeg',
              'image/gif',
              'image/webp',
              'image/svg+xml',
              'application/pdf',
            ],
          },
          // 두 단계의 둘째 — 올린 뒤 이것만 실어 다시 부른다
          attachment_id: { type: 'string', description: 'mcp.arg.attachment_id' },
          session_id: { type: 'string', description: 'mcp.arg.session_id' },
        },
        // `required` 로는 "첫 단계냐 둘째 단계냐" 를 적을 수 없다 — 핸들러가 가른다
        required: [],
      },
      handler: async (input, ctx) => {
        const attachmentId = input['attachment_id'];
        if (typeof attachmentId === 'string' && attachmentId !== '') {
          return this.attachments.commit({ projectId: ctx.projectId, attachmentId });
        }
        const specKey = String(input['spec_id'] ?? '');
        const filename = String(input['filename'] ?? '');
        const contentType = String(input['content_type'] ?? '');
        if (specKey === '' || filename === '' || contentType === '') {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
            kind: 'invalid_input',
            missing: [
              ...(specKey === '' ? ['spec_id'] : []),
              ...(filename === '' ? ['filename'] : []),
              ...(contentType === '' ? ['content_type'] : []),
            ],
          });
        }
        return this.attachments.presign({
          projectId: ctx.projectId,
          specKey,
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          filename,
          contentType,
        });
      },
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
          // 곁들여 실을 것 — `requirements` 는 늘 실리므로 여기서는 나머지만 고른다
          include: { type: 'array' },
        },
        required: ['spec_id'],
      },
      handler: async (input, ctx) =>
        this.specs.get({
          projectId: ctx.projectId,
          specKey: String(input['spec_id'] ?? ''),
          versionNo: typeof input['version'] === 'number' ? input['version'] : null,
          include: Array.isArray(input['include']) ? (input['include'] as string[]) : null,
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
          // **이름이 둘이다.** 카탈로그(3.4 §2.3)·REST·웹은 `body_markdown` 을 쓰는데 이
          // 도구만 `body_md` 였다 — 스킬 문장대로 부른 호출은 본문이 빈 문자열이 되어
          // **문서를 지우면서 성공**했다(실측 2026-08-30). 둘 다 받고, 적는 이름은 하나로 한다.
          body_markdown: { type: 'string', description: 'mcp.arg.body_markdown' },
          body_md: { type: 'string', description: 'mcp.arg.body_markdown' },
          // **기존 문서를 고칠 때는 필수다.** `nerv_spec_get` 응답의 `content_hash` 를
          // 그대로 돌려주면 서버가 "그 사이 아무도 안 바꿨다"를 확인한다(§1.4g)
          base_hash: { type: 'string', description: 'mcp.arg.base_hash' },
          // **무엇을 왜 바꿨나.** 카탈로그·스킬이 처음부터 지시하던 입력인데 스키마에
          // 없어서 에이전트가 한 번도 싣지 않았다(실측 30/30) — 도구는 스키마를 읽는다.
          change_summary: { type: 'string', description: 'mcp.arg.change_summary' },
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
              required: ['to', 'kind', 'base_hash'],
              properties: {
                to: { type: 'string', description: 'spec key (SPC-…) or UUID' },
                kind: {
                  type: 'string',
                  enum: ['refines', 'depends_on', 'duplicates', 'supersedes'],
                },
                // **상대 문서의 지문**도 필수다 — 본문을 안 고치고 관계만 바꾸는 저장이
                // 허용되는 만큼, 그 경로가 검사 없는 뒷문이 되면 안 된다(§1.4h)
                base_hash: { type: 'string', description: 'mcp.arg.relation_base_hash' },
              },
            },
          },
          // **남의 리스를 뺏는다**(§1.4h). 죽은 세션이 쥔 리스를 30분 기다리지 않게 하는
          // 탈출구다 — 뺏어도 본문은 `base_hash` 가 지킨다.
          takeover: { type: 'boolean', default: false, description: 'mcp.arg.takeover' },
        },
        // `required` 로는 "둘 중 하나"를 적을 수 없다 — 그 판정은 핸들러가 한다
        required: [],
      },
      handler: async (input, ctx) => {
        const body = input['body_markdown'] ?? input['body_md'];
        if (typeof body !== 'string') {
          throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
            kind: 'invalid_input',
            missing: ['body_markdown'],
          });
        }
        return this.specs.draftUpsert({
          projectId: ctx.projectId,
          roles: ctx.principal.roles,
          userId: ctx.principal.userId,
          sessionId: ctx.sessionId,
          bodyMd: body,
          ...(typeof input['change_summary'] === 'string' && input['change_summary'].trim() !== ''
            ? { changeSummary: input['change_summary'] }
            : {}),
          ...(typeof input['spec_id'] === 'string' ? { specId: input['spec_id'] } : {}),
          ...(typeof input['base_hash'] === 'string' ? { baseHash: input['base_hash'] } : {}),
          ...(typeof input['key'] === 'string' ? { key: input['key'] } : {}),
          ...(typeof input['title'] === 'string' ? { title: input['title'] } : {}),
          ...(typeof input['type'] === 'string' ? { type: input['type'] } : {}),
          ...(typeof input['parent_id'] === 'string' ? { parentId: input['parent_id'] } : {}),
          ...(input['takeover'] === true ? { takeover: true } : {}),
          ...(Array.isArray(input['relations'])
            ? {
                relations: (input['relations'] as Record<string, unknown>[]).map((r) => ({
                  to: String(r['to'] ?? ''),
                  kind: String(r['kind'] ?? ''),
                  ...(typeof r['base_hash'] === 'string' ? { baseHash: r['base_hash'] } : {}),
                })),
              }
            : {}),
        });
      },
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
          // 서비스는 처음부터 받고 열도 있었다 — 도구 스키마만 빠져 있었다(REQ-API-081)
          resolved_in_version_id: { type: 'string' },
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
          resolvedInVersionId:
            typeof input['resolved_in_version_id'] === 'string'
              ? input['resolved_in_version_id']
              : null,
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
