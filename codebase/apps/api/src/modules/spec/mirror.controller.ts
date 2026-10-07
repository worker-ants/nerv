// md 미러 — GET /api/projects/{p}/specs/{id}.md · /api/projects/{p}/llms.txt (api.md §2.8)
//
// `/api/v1` 이 아니라 `/api` 다 — 버전 없는 **읽기 전용 표현 경로**이고, 계약이 아니라
// 파일처럼 다뤄지길 의도한 것이다(URL 이 곧 문서 주소가 된다).
//
// 표면은 번역만 한다: 렌더링은 SpecService 가 하고 여기서는 content-type 만 정한다.

import { createHash } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { msg, NERV_ERROR } from '@nerv/schema';
import { NervError } from '../../common/nerv-exception.filter.js';
import { intParam } from '../../common/query-vocab.js';
import { ProjectAccessGuard } from '../../common/project-access.guard.js';
import { RequireScope } from '../../common/route-permission.js';
import type { ProjectRequest } from '../../common/project-access.guard.js';
import { SpecService } from './spec.service.js';
import { SpecExportService } from './spec-export.service.js';

/**
 * 어댑터 타입을 직접 들이지 않는다 — `plugin.controller.ts` 의 `RawReply` 와 같은 규율이다.
 */
interface RawReply {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
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
  constructor(
    private readonly specs: SpecService,
    private readonly exports: SpecExportService,
  ) {}

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

  /**
   * EP-MIR-03 — 프로젝트 스펙 전체를 zip 하나로(2026-09-28 · clemvion 요청 N5 · 사람 결정 D7 · D8 · REQ-API-251).
   * `basis=approved|latest` 또는 `baseline=<이름>`(REQ-API-268) · `layout=flat|tree` · `include=attachments`. 판정 · 경로
   * 규칙은 `SpecExportService` 한 곳이다.
   */
  @RequireScope('spec:read')
  @Get('export.zip')
  async exportZip(
    @Req() req: ProjectRequest,
    @Query('basis') basis?: string,
    @Query('layout') layout?: string,
    @Query('include') include?: string,
    @Query('baseline') baseline?: string,
  ): Promise<StreamableFile> {
    const out = await this.exports.archive({
      projectId: projectOf(req),
      projectSlug: String(req.params?.['proj'] ?? 'project'),
      basis: basis ?? null,
      // 기준선으로도 받는다(2026-10-07 · REQ-API-268) — `basis`와 함께 오면 400이다
      baseline: baseline ?? null,
      layout: layout ?? null,
      include: (include ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    });
    return new StreamableFile(out.stream, {
      type: 'application/zip',
      disposition: `attachment; filename="${out.filename}"`,
    });
  }

  /**
   * EP-MIR-01 — 스펙 한 편. `.md` 확장자는 경로의 일부다.
   *
   * **받은 것과 같으면 본문을 다시 보내지 않는다**(2026-09-28 · 사람 결정 D6 · REQ-API-246). `ETag` 는 응답
   * 바이트 전체의 sha256 이라 frontmatter 만 바뀌어도(제목 · 부모) 달라진다 — 본문 해시는 frontmatter 의
   * `content_hash` 가 따로 맡는다. 304 는 `If-None-Match` 로만 판정한다. 로그인이 있어야 읽는 문서라 공유
   * 캐시에는 남기지 않고(`private`), 쓸 때마다 다시 확인하게 한다(`no-cache`).
   */
  @RequireScope('spec:read')
  @Get('specs/:spec.md')
  async spec(
    @Req() req: ProjectRequest,
    @Res({ passthrough: true }) reply: RawReply,
    @Param('spec') spec: string,
    @Query('version') version?: string,
    @Headers('if-none-match') ifNoneMatch?: string,
    @Query('basis') basis?: string,
    @Query('task') task?: string,
    @Query('baseline') baseline?: string,
  ): Promise<string> {
    const { markdown, updatedAt, readAs } = await this.specs.mirrorDocument({
      projectId: projectOf(req),
      specKey: spec,
      // 숫자가 아니면 400 이다 — `Number('abc')` 가 SQL 까지 가서 22P02 로 죽던 자리다
      versionNo: version === undefined || version === 'approved' ? null : versionOf(version),
      // **작업의 기준으로 · 보기 기준으로 읽는다**(REQ-API-249) — 선택자는 하나만이다(둘이면 400)
      basis: basis ?? null,
      task: task ?? null,
      // **기준선으로도 읽는다**(2026-10-07 · REQ-API-269). 예전에는 이 값을 오류 없이 버리고 승인본을 줬다 —
      // 받은 쪽은 기준선으로 받았다고 믿었다
      baseline: baseline ?? null,
    });
    void reply.header('x-nerv-read-as', readAs);
    const etag = `"sha256-${createHash('sha256').update(markdown, 'utf8').digest('hex')}"`;
    void reply.header('etag', etag);
    if (updatedAt !== null) void reply.header('last-modified', updatedAt.toUTCString());
    void reply.header('cache-control', 'private, no-cache');
    if (etagMatches(ifNoneMatch, etag)) {
      void reply.status(304);
      return '';
    }
    void reply.header('content-type', 'text/markdown; charset=utf-8');
    return markdown;
  }
}

/**
 * `If-None-Match` 가 이 ETag 를 가리키는가 — 목록(`"a", "b"`)과 `*` 를 받고, 약한 비교라 `W/` 는 떼고 견준다
 * (RFC 9110 §13.1.2).
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string): string => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
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
