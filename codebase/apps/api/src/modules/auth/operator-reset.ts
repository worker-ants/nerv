// 운영자 비밀번호 재설정 링크 — 메일을 보내지 않는 배치의 길 (2026-10-15 · 사람 결정 · 정본: docs/04-mvp/codebase.md §5.2 ·
// REQ-CB-061)
//
// 메일이 꺼진 배치에서는 재설정 요청이 400 `RESET_PASSWORD_DISABLED` 이고 화면은 "서버 운영자에게 문의" 를 말한다
// (api.md REQ-API-187). 그 운영자가 쓰는 것이 이 함수다 — 셸과 DB 에 들어갈 수 있는 사람이 api 이미지 안에서
// `node dist/reset-link.js <이메일>` 로 부른다. **새 HTTP 경로도 새 역할도 없다.**
//
// **인증 스택의 재설정 문을 그대로 쓴다.** 메일로 받는 링크와 같은 검증 행(`reset-password:<토큰>` · 값은 사용자 id ·
// 60분)을 인증 스택의 저장 계층으로 만들고, 같은 모양의 링크(`resetPasswordLink`)를 돌려준다. 그 뒤는 메일로 받은
// 링크와 똑같다 — 사람이 화면의 `/reset-password` 에서 비밀번호를 직접 정하고, 토큰은 한 번뿐이며, 정하면 그 사람의
// 모든 세션이 끊긴다. 인증 스택의 거절은 **요청** 쪽(`sendResetPassword` 가 없을 때)에만 있어서 이 길은 메일 없이 돈다.
// 운영자는 비밀번호를 보지도 정하지도 않는다.

import { PASSWORD_RESET_TTL_MINUTES } from '@nerv/schema';
import { generateId } from 'better-auth';
import type pg from 'pg';
import { apiUrlFromEnv, webUrlFromEnv } from '../../common/origins.js';
import { resetPasswordLink } from '../mail/verify-link.js';
import { createBetterAuth } from './better-auth.js';

export interface IssuedResetLink {
  userId: string;
  url: string;
  expiresAt: Date;
}

/**
 * 그 이메일의 계정에 재설정 링크 하나를 만든다. 계정이 없으면 null 이다 — 운영자에게는 숨길 까닭이 없다(계정이 있는지
 * 숨기는 것은 로그인 화면의 일이고, 이 함수를 부르는 사람은 이미 DB 를 볼 수 있다).
 */
export async function issueResetLink(
  pool: pg.Pool,
  email: string,
  now: Date = new Date(),
): Promise<IssuedResetLink | null> {
  const context = await createBetterAuth(pool).$context;
  const found = await context.internalAdapter.findUserByEmail(email.trim().toLowerCase());
  if (found === null) return null;
  // 토큰의 모양도 인증 스택이 재설정 메일에 쓰는 것과 같다(24자)
  const token = generateId(24);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: found.user.id,
    expiresAt,
  });
  return {
    userId: found.user.id,
    url: resetPasswordLink({ api: apiUrlFromEnv(), web: webUrlFromEnv(), token }),
    expiresAt,
  };
}
