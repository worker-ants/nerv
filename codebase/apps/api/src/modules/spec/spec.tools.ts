// MCP — nerv_spec_* 7종 (docs/04-mvp/codebase.md §2.3 · api.md §4)
//
// 도구는 REST 컨트롤러와 **같은 SpecService 인스턴스**를 주입받는다 — 그것이 D-05 의 실물이고
// E01-S02 의 수용 기준이다. 입력 zod 검증·idempotency_key 공통 처리는 ToolRegistry 위에서
// E03-S01·E03-S04 가 얹는다.

import { Injectable } from '@nestjs/common';
import type { NervToolDefinition, NervToolProvider } from '../../mcp/tool-registry.js';
import { SpecService } from './spec.service.js';

@Injectable()
export class SpecTools implements NervToolProvider {
  constructor(private readonly specs: SpecService) {}

  readonly tools: readonly NervToolDefinition[] = [
    {
      name: 'nerv_spec_tree',
      tier: 'A1',
      phase: 'P0',
      summary: '스펙 탐색 시작',
      handler: async () => this.specs.tree(),
    },
    {
      name: 'nerv_spec_search',
      tier: 'A1',
      phase: 'P0',
      summary: '컨텍스트 수집·중복 확인',
      handler: async () => this.specs.search(),
    },
    {
      name: 'nerv_spec_get',
      tier: 'A1',
      phase: 'P0',
      summary: '구현 착수 전, 리뷰 전',
      handler: async () => this.specs.get(),
    },
    {
      name: 'nerv_spec_draft_upsert',
      tier: 'A2',
      phase: 'P1',
      summary: '스펙 초안 작성·CR 제안',
      handler: async () => this.specs.draftUpsert(),
    },
    {
      name: 'nerv_spec_submit_review',
      tier: 'A3',
      phase: 'P1',
      summary: '초안 완료 후 사람 검토 요청',
      handler: async () => this.specs.submitReview(),
    },
    {
      name: 'nerv_spec_check',
      tier: 'A1',
      phase: 'P1',
      summary: '초안 저장 후·제출 전 아무 때나',
      handler: async () => this.specs.check(),
    },
    {
      name: 'nerv_spec_comment_resolve',
      tier: 'A2',
      phase: 'P1',
      summary: '코멘트 반영 직후',
      handler: async () => this.specs.resolveComment(),
    },
  ];
}
