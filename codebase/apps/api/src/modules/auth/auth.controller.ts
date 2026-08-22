// REST — 조직 · 프로젝트 · 멤버 · 토큰 (S8) — docs/04-mvp/api.md §2.1
import { Controller, Get, Post } from '@nestjs/common';
import { NotImplementedYetError } from '../../common/nerv-exception.filter.js';
import { AuthService } from './auth.service.js';

@Controller('api/v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** EP-AUTH-01 */
  @Get('me')
  me(): never {
    throw new NotImplementedYetError('E03-S02', 'GET /api/v1/me');
  }

  /** EP-ORG-01 */
  @Get('orgs')
  orgs(): never {
    throw new NotImplementedYetError('E03-S02', 'GET /api/v1/orgs');
  }

  /** EP-TOK-02 — 원문은 이 응답에서 한 번만 나간다 */
  @Post('me/tokens')
  issueToken(): never {
    throw new NotImplementedYetError('E03-S02', 'PAT 발급 엔드포인트');
  }
}
