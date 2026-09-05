// REST — preflight · specs · tasks · links · map (EP-IMP-01~05)
//
// 권한이 이 표면의 전부다: **admin AND `import:write`**(api.md §1.3·§2.10). 전이 검사 우회가
// 여기서만 열리므로 두 조건이 AND 로 걸린다 — 역할만으로도, 권한만으로도 지나갈 수 없다.
// `import:write` 는 도구 대응이 없는 유일한 REST 전용 권한이고, 이관이 끝나면 폐기하는 것이
// 기본 운용이다(EP-TOK-03).
//
// 이 표면이 하지 않는 것: 원본 파일 접근, 프로파일 해석, 리포트 생성, 매니페스트 보관.
// 그래서 파일 업로드도 git 자격증명도 없다 — 서버는 이미 판정된 입력만 받는다.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import {
  importLinkBatchInputSchema,
  importReviewBatchInputSchema,
  importPreflightInputSchema,
  importSpecBatchInputSchema,
  importTaskBatchInputSchema,
} from '@nerv/schema';
import type { ImportBatchResult, ImportPreflightResult } from '@nerv/schema';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireRoleAndScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { NervError } from '../../common/nerv-exception.filter.js';
import { AuthService } from '../auth/auth.service.js';
import { ImportService } from './import.service.js';

@Controller('api/v1/projects/:proj/import')
@UseGuards(ProjectAccessGuard)
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly auth: AuthService,
  ) {}

  /** EP-IMP-01 — 자연 키 충돌 사전 판정. 서버 쓰기 0. */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Post('preflight')
  async preflight(
    @Req() req: ProjectRequest,
    @Body() body: unknown,
  ): Promise<ImportPreflightResult> {
    const actor = this.authorize(req);
    return this.imports.preflight(actor, parse(importPreflightInputSchema, body));
  }

  /** EP-IMP-02 */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Post('specs')
  async specs(@Req() req: ProjectRequest, @Body() body: unknown): Promise<ImportBatchResult> {
    const actor = this.authorize(req);
    return this.imports.applySpecs(actor, parse(importSpecBatchInputSchema, body));
  }

  /** EP-IMP-03 */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Post('tasks')
  async tasks(@Req() req: ProjectRequest, @Body() body: unknown): Promise<ImportBatchResult> {
    const actor = this.authorize(req);
    return this.imports.applyTasks(actor, parse(importTaskBatchInputSchema, body));
  }

  /** EP-IMP-04 */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Post('links')
  async links(@Req() req: ProjectRequest, @Body() body: unknown): Promise<ImportBatchResult> {
    const actor = this.authorize(req);
    return this.imports.applyLinks(actor, parse(importLinkBatchInputSchema, body));
  }

  /** EP-IMP-06 — 리뷰 세션(FR-09). 도구 경로와 같은 ReviewService 를 거친다(D-05) */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Post('reviews')
  async reviews(@Req() req: ProjectRequest, @Body() body: unknown): Promise<ImportBatchResult> {
    const actor = this.authorize(req);
    return this.imports.applyReviews(actor, parse(importReviewBatchInputSchema, body));
  }

  /** EP-IMP-05 — 자연 키 → UUID 맵 */
  @RequireRoleAndScope(['admin'], 'import:write')
  @Get('map')
  async map(@Req() req: ProjectRequest): Promise<{ items: Record<string, unknown>[] }> {
    return this.imports.map(this.authorize(req));
  }

  /**
   * admin **AND** import:write. 둘 중 하나만으로는 지나갈 수 없다(REQ-API-017).
   * 권한·역할이 부족하면 403 이고 **레코드를 만들지 않는다** — 부작용 뒤의 거부는 거부가 아니다.
   */
  private authorize(req: ProjectRequest): { userId: string; projectId: string } {
    const principal = req.nervPrincipal;
    const projectId = req.nervProjectId;
    if (principal === undefined || projectId === undefined) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, msg('error.auth.missing'), {
        kind: 'missing',
      });
    }
    // 겸직이면 하나라도 admin 이면 통과다 — 역할은 합집합이다(0003_multi_role)
    if (!(req.nervRoles ?? []).includes('admin')) {
      throw new NervError(NERV_ERROR.FORBIDDEN, msg('error.auth.admin_only_import'), {
        kind: 'role_required',
        required: 'admin',
        granted: req.nervRoles ?? [],
      });
    }
    this.auth.assertScope(principal, 'import:write');
    return { userId: principal.userId, projectId };
  }
}

/** zod 검증 — 표면이 하는 일은 번역이고, 그 번역의 정확성이 이 한 줄이다(REQ-CB-003). */
function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success || result.data === undefined) {
    throw new NervError(NERV_ERROR.PRECONDITION, msg('error.request.schema'), {
      issues: result.error,
    });
  }
  return result.data;
}
