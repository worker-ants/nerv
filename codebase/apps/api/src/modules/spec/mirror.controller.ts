// md 미러 — GET /api/projects/{p}/specs/{id}.md · /api/projects/{p}/llms.txt (api.md §2.8)
//
// `/api/v1` 이 아니라 `/api` 다 — 버전 없는 **읽기 전용 표현 경로**이고, 계약이 아니라
// 파일처럼 다뤄지길 의도한 것이다(URL 이 곧 문서 주소가 된다).
//
// 표면은 번역만 한다: 렌더링은 SpecService 가 하고 여기서는 content-type 만 정한다.

import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { intParam } from '../../common/query-vocab.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { SpecService } from './spec.service.js';

/**
 * 어댑터 타입을 직접 들이지 않는다 — `plugin.controller.ts` 의 `RawReply` 와 같은 규율이다.
 */
interface RawReply {
  header(name: string, value: string): unknown;
}

/**
 * **content-type 은 응답을 만든 뒤에 건다**(2026-09-28 · REQ-API-236). 라우트 데코레이터(`@Header`)로
 * 걸면 핸들러가 던진 오류에도 `text/markdown` 이 붙어, 오류 봉투(JSON 객체)를 Fastify 가 보내지
 * 못하고 500 "invalid payload type" 이 됐다 — 없는 버전 · 없는 키 · `?version=abc` 가 모두 500 이었다.
 * `plugin.controller.ts` 가 같은 결함을 먼저 겪고 고친 방식이다.
 */
@Controller('api/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class MirrorController {
  constructor(private readonly specs: SpecService) {}

  /** EP-MIR-02 — 트리 색인. 에이전트의 첫 지도다 */
  @RequireScope('spec:read')
  @Get('llms.txt')
  async llms(
    @Req() req: ProjectRequest,
    @Res({ passthrough: true }) reply: RawReply,
  ): Promise<string> {
    const text = await this.specs.llmsTxt({
      projectId: projectOf(req),
      projectName: String(req.params?.['proj'] ?? 'project'),
    });
    void reply.header('content-type', 'text/plain; charset=utf-8');
    return text;
  }

  /** EP-MIR-01 — 스펙 한 편. `.md` 확장자는 경로의 일부다 */
  @RequireScope('spec:read')
  @Get('specs/:spec.md')
  async spec(
    @Req() req: ProjectRequest,
    @Res({ passthrough: true }) reply: RawReply,
    @Param('spec') spec: string,
    @Query('version') version?: string,
  ): Promise<string> {
    const markdown = await this.specs.mirrorMarkdown({
      projectId: projectOf(req),
      specKey: spec,
      // 숫자가 아니면 400 이다 — `Number('abc')` 가 SQL 까지 가서 22P02 로 죽던 자리다
      versionNo: version === undefined || version === 'approved' ? null : versionOf(version),
    });
    void reply.header('content-type', 'text/markdown; charset=utf-8');
    return markdown;
  }
}

/** `?version=` — 1 이상의 정수만 받는다(0 · 음수는 모양이 틀린 것이다) */
function versionOf(raw: string): number | null {
  const value = intParam(raw, 'version');
  if (value !== null && value < 1) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.mcp.invalid_input'), {
      kind: 'invalid_input',
      field: 'version',
      unknown: [raw],
      allowed: ['approved', 'integer >= 1'],
    });
  }
  return value;
}

function projectOf(req: ProjectRequest): string {
  const projectId = req.nervProjectId;
  if (projectId === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.project.unresolved'), {
      kind: 'unresolved_project',
    });
  }
  return projectId;
}
