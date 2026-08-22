// REST — tree · get · 버전 · draft · check · submit · 코멘트 · baselines · manifest
// 정본: docs/04-mvp/api.md §2.2 · §2.2b
//
// 표면은 번역만 한다(REQ-CB-003) — 인증 컨텍스트 추출, zod 검증, 서비스 호출, 응답 포맷.
// 상태 전이 규칙·게이트 판정은 SpecService 한 곳에 있다.

import { Controller, Get, Param, Post, Put } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { BaselineService } from './baseline.service.js';
import { SpecCommentService } from './spec-comment.service.js';
import { SpecService } from './spec.service.js';

@Controller('api/v1/projects/:proj')
export class SpecController {
  constructor(
    private readonly specs: SpecService,
    private readonly comments: SpecCommentService,
    private readonly baselines: BaselineService,
  ) {}

  /** EP-SPEC-01 */
  @Get('specs')
  tree(@Param('proj') _proj: string): never {
    return this.specs.tree();
  }

  /** EP-SPEC-02 */
  @Get('specs/search')
  search(): never {
    return this.specs.search();
  }

  /** EP-SPEC-03 */
  @Get('specs/:spec')
  get(@Param('spec') _spec: string): never {
    return this.specs.get();
  }

  /** EP-SPEC-07·08 */
  @Put('specs/:spec/draft')
  draftUpsert(): never {
    return this.specs.draftUpsert();
  }

  /** EP-SPEC-09 */
  @Post('specs/:spec/check')
  check(): never {
    return this.specs.check();
  }

  /** EP-SPEC-10 */
  @Post('specs/:spec/submit')
  submit(): never {
    return this.specs.submitReview();
  }

  /** EP-SPEC-12 */
  @Post('baselines')
  createBaseline(): never {
    return this.baselines.create();
  }

  /** 아키텍처 §2.4 인용 경로 — 버전 프리픽스 없이 고정(api.md §1.2·§2.8) */
  @Get('specs/:spec.md')
  mirror(): never {
    throw new NotImplementedYetError('E09-S01', 'markdown 미러');
  }
}
