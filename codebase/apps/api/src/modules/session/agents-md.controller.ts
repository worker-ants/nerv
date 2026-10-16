// REST — 프로젝트의 AGENTS.md (EP-PRJ-06 · api.md §2.1 · REQ-API-326 · 2026-10-16 · 사람 결정 ①)
//
// 표면은 번역만 한다(REQ-CB-003): 본문과 규약 버전은 AgentsMdService 가 만들고 여기서는 content-type 과 헤더만 정한다.
// 부르는 쪽은 사람의 기계에서 도는 `nerv-init` 이다 — 에이전트 토큰(`spec:read`)으로 받아 저장소 AGENTS.md 의 구역만 바꾼다.

import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { AgentsMdService } from './agents-md.service.js';

/** 어댑터 타입을 직접 들이지 않는다 — `mirror.controller.ts` 의 `RawReply` 와 같은 규율이다 */
interface RawReply {
  header(name: string, value: string): unknown;
}

@Controller('api/v1/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class AgentsMdController {
  constructor(private readonly agentsMd: AgentsMdService) {}

  /**
   * EP-PRJ-06 — 본문은 `text/markdown`, 규약 버전은 헤더에도 담는다(본문의 출처 줄과 같은 값).
   *
   * **content-type 은 본문을 만든 뒤에 건다**(`mirror.controller.ts` 와 같은 까닭) — 라우트 데코레이터로 걸면 오류 봉투에도
   * `text/markdown` 이 붙어 Fastify 가 보내지 못한다. 규약이 바뀌면 같은 주소가 다른 본문을 주므로 캐시에 남기지 않는다.
   */
  @RequireScope('spec:read')
  @Get('agents-md')
  async agentsMdOf(
    @Req() req: ProjectRequest,
    @Res({ passthrough: true }) reply: RawReply,
  ): Promise<string> {
    const out = await this.agentsMd.render(req.nervProjectId ?? '');
    void reply.header('content-type', 'text/markdown; charset=utf-8');
    void reply.header('x-nerv-conventions-version', out.version);
    void reply.header('cache-control', 'private, no-cache');
    return out.markdown;
  }
}
