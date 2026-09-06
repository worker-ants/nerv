// md 미러 — GET /api/projects/{p}/specs/{id}.md · /api/projects/{p}/llms.txt (api.md §2.8)
//
// `/api/v1` 이 아니라 `/api` 다 — 버전 없는 **읽기 전용 표현 경로**이고, 계약이 아니라
// 파일처럼 다뤄지길 의도한 것이다(URL 이 곧 문서 주소가 된다).
//
// 표면은 번역만 한다: 렌더링은 SpecService 가 하고 여기서는 content-type 만 정한다.

import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { SpecService } from './spec.service.js';

@Controller('api/projects/:proj')
@UseGuards(ProjectAccessGuard)
export class MirrorController {
  constructor(private readonly specs: SpecService) {}

  /** EP-MIR-02 — 트리 색인. 에이전트의 첫 지도다 */
  @RequireScope('spec:read')
  @Get('llms.txt')
  @Header('content-type', 'text/plain; charset=utf-8')
  llms(@Req() req: ProjectRequest): Promise<string> {
    return this.specs.llmsTxt({
      projectId: projectOf(req),
      projectName: String(req.params?.['proj'] ?? 'project'),
    });
  }

  /** EP-MIR-01 — 스펙 한 편. `.md` 확장자는 경로의 일부다 */
  @RequireScope('spec:read')
  @Get('specs/:spec.md')
  @Header('content-type', 'text/markdown; charset=utf-8')
  spec(
    @Req() req: ProjectRequest,
    @Param('spec') spec: string,
    @Query('version') version?: string,
  ): Promise<string> {
    return this.specs.mirrorMarkdown({
      projectId: projectOf(req),
      specKey: spec,
      versionNo: version === undefined || version === 'approved' ? null : Number(version),
    });
  }
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
