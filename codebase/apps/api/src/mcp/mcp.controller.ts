// POST /mcp — Streamable HTTP 단일 엔드포인트 (docs/04-mvp/api.md §1.1 · §4)
//
// 표면은 번역만 한다(REQ-CB-003) — 도구 본체는 modules/**/*.tools.ts 에 있고 판정은 도메인
// 서비스가 내린다. 프로토콜(신·구 리비전 병행 협상, tools-first)은 E03-S01, 구조화 에러의
// next_actions 는 E03-S04 소관이다.

import { Controller, Post } from '@nestjs/common';
import { NotImplementedYetError } from '../common/nerv-exception.filter.js';
import { ToolRegistry } from './tool-registry.js';

// REQ-CB-013 의 Origin 검증은 McpOriginGuard 가 **전역 가드**로 수행한다(main.ts) —
// 인증(AuthGuard)보다 먼저 돌아야 하기 때문이다. 컨트롤러 스코프로 달면 순서가 뒤집힌다.
@Controller('mcp')
export class McpController {
  constructor(private readonly registry: ToolRegistry) {}

  @Post()
  handle(): never {
    throw new NotImplementedYetError('E03-S01', 'MCP Streamable HTTP 게이트웨이');
  }

  /** 골격 검증용 — 수집된 카탈로그를 노출한다. 프로토콜 응답이 아니다. */
  catalog(): readonly string[] {
    return this.registry.list().map((t) => t.name);
  }
}
