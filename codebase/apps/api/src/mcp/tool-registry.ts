// MCP 도구 레지스트리 — modules/**/*.tools.ts 수집 (docs/04-mvp/codebase.md §2.2)
//
// 도구는 자기 모듈에 산다. 레지스트리는 그것을 **이름으로 찾는 색인**일 뿐이고, 도구 본체는
// 도메인 서비스를 DI 로 받는다 — 그래서 REST 컨트롤러와 MCP 도구가 같은 서비스 인스턴스를
// 거친다(D-05 · REQ-CB-003). zod 입력 검증·idempotency_key 공통 처리와 Streamable HTTP
// 프로토콜은 E03-S01·E03-S04 가 이 레지스트리 위에 얹는다.

import type { MessageKey } from '@nerv/schema';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { AgentScope } from '@nerv/schema';
import type { ToolContext } from './tool-context.js';

/** 도구 위험 티어 A1~A4 — 스펙 게이트 티어 T0~T3 과는 다른 축이다(scope.md §4.2). */
export type ToolTier = 'A1' | 'A2' | 'A3' | 'A4';

export interface NervToolDefinition {
  /** 카탈로그 이름 — 정본: docs/03-proposal/agent-integration.md §2.3 */
  readonly name: string;
  readonly tier: ToolTier;
  readonly phase: 'P0' | 'P1';
  /** 한 줄 설명(카탈로그의 호출 시점) */
  /**
   * 언제 이 도구를 쓰는가 — MCP `tools/list` 의 description 이 된다.
   *
   * 문장이 아니라 **키**인 이유는 이 정의가 정적 객체이기 때문이다. 문장을 박아 두면
   * 요청 로케일이 무엇이든 같은 말이 나간다 — 문장은 로케일을 아는 컨트롤러가 만든다.
   *
   * 네임스페이스로 좁히는 이유: 이 자리의 문구에는 자리표시자가 없어야 한다(도구 설명은
   * 값을 받지 않는다). `mcp.tool.*` 로 제한하면 그 사실이 타입으로 지켜진다.
   */
  readonly summaryKey: MessageKey & `mcp.tool.${string}`;
  /** 필요 권한 — agent-integration §2.3 "필요 권한" 열과 1:1. 게이트웨이가 호출 전에 검사한다 */
  readonly scope: AgentScope;
  /** 입력 JSON Schema — MCP tools/list 가 그대로 노출한다 */
  readonly inputSchema: Record<string, unknown>;
  readonly handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** `*.tools.ts` 가 구현하는 계약. 레지스트리는 이 모양만 보고 수집한다. */
export interface NervToolProvider {
  readonly tools: readonly NervToolDefinition[];
}

function isToolProvider(value: unknown): value is NervToolProvider {
  if (value === null || typeof value !== 'object') return false;
  const tools = (value as { tools?: unknown }).tools;
  return (
    Array.isArray(tools) && tools.every((t) => typeof (t as NervToolDefinition).name === 'string')
  );
}

@Injectable()
export class ToolRegistry implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly byName = new Map<string, NervToolDefinition>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!isToolProvider(instance)) continue;
      for (const tool of instance.tools) this.register(tool);
    }
    this.logger.log(`MCP 도구 ${this.byName.size}종 수집`);
  }

  private register(tool: NervToolDefinition): void {
    const existing = this.byName.get(tool.name);
    if (existing !== undefined) {
      throw new Error(`MCP 도구 이름 충돌: ${tool.name} — 카탈로그 이름은 유일해야 한다`);
    }
    this.byName.set(tool.name, tool);
  }

  get(name: string): NervToolDefinition | undefined {
    return this.byName.get(name);
  }

  list(): readonly NervToolDefinition[] {
    return [...this.byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get size(): number {
    return this.byName.size;
  }
}
