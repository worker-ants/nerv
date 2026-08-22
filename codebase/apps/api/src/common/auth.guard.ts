// 인증 2경로 판별 — 정본: docs/04-mvp/api.md §1.3
//
//   ① 웹 세션  : better-auth 세션 쿠키(HttpOnly·SameSite=Lax) — 브라우저 SPA
//   ② PAT      : Authorization: Bearer <token> — 에이전트(MCP)·CI·외부 연동·md 미러
//                쿼리스트링 전달은 금지다.
//
// **검증기 배선은 E03-S02(PAT 발급·검증) 소관**이다. 이 골격은 자격증명의 형태만 식별하고
// 검증기가 없으면 통과시키지 않는다 — 미구현 상태의 기본값은 열림이 아니라 닫힘이다.
// @Public() 이 붙은 라우트만 자격증명 없이 지난다.

import { Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NERV_ERROR } from '@nerv/schema';
import { AuthService } from '../modules/auth/auth.service.js';
import type { Principal } from '../modules/auth/auth.service.js';
import { NervError } from './nerv-exception.filter.js';

export const IS_PUBLIC_KEY = 'nerv:public';

/** 무인증 허용 라우트 표시. 남용 금지 — 인프라·비계약 엔드포인트에만 쓴다. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export type CredentialKind = 'session' | 'pat';

export interface AuthContext {
  kind: CredentialKind;
  /** 원문 자격증명. 검증은 E03-S02 의 AuthService 가 한다 — 여기서 신뢰하지 않는다. */
  credential: string;
}

/** 요청에서 자격증명의 형태만 뽑는다. 검증하지 않는다. */
export function extractCredential(headers: Record<string, string | undefined>): AuthContext | null {
  const authorization = headers['authorization'];
  if (authorization !== undefined && authorization.startsWith('Bearer ')) {
    const credential = authorization.slice('Bearer '.length).trim();
    if (credential !== '') return { kind: 'pat', credential };
  }
  const cookie = headers['cookie'];
  if (cookie !== undefined && cookie.includes('better-auth.session_token=')) {
    return { kind: 'session', credential: cookie };
  }
  return null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      nervAuth?: AuthContext;
      nervPrincipal?: Principal;
    }>();
    const auth = extractCredential(req.headers);
    if (auth === null) {
      throw new NervError(NERV_ERROR.UNAUTHENTICATED, '자격증명이 없습니다.', { kind: 'missing' });
    }
    req.nervAuth = auth;
    req.nervPrincipal = await this.auth.verify(auth);
    return true;
  }
}
