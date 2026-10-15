// 이메일 바꾸기 — 인증 스택에 없는 보장을 메우는 자리 (2026-10-15 · 사람 결정 · 정본: docs/04-mvp/api.md REQ-API-310)
//
// 문은 인증 스택의 것이다(`/api/auth/change-email` → 옛 주소의 승인 → 새 주소의 확인). 이 파일은 그 문이 하지
// 않는 일만 한다 — 대기 중인 요청을 **한 줄**로 적어 링크를 한 번만 쓰이게 하고, 사람마다 시도를 센다.
//
// **저장은 `auth_verification` 이다.** 인증 스택의 재설정 토큰(`reset-password:<토큰>`)이 사는 표이고, 여기 적는 것도
// 같은 부류(만료가 있는 인증 상태)다 — 도메인 표를 새로 만들지 않는다(4.3 §2.16). 이름표 둘:
//   `change-email:<사용자 id>`          — 대기 중인 요청 하나. 값은 JSON(새 주소 · 단계 · 지금 살아 있는 링크의 지문)
//   `change-email-attempt:<사용자 id>`  — 시도 하나에 한 줄, 1분 뒤 만료(사람마다 세는 한도)
//
// **순수 모듈이다.** `better-auth.ts` 가 Nest 밖이라(그 파일 머리 주석) 풀을 받아 쓴다.

import { createHash } from 'node:crypto';
import { EMAIL_VERIFY_TTL_MINUTES, RATE_LIMIT_SIGN_IN_PER_MIN, newId } from '@nerv/schema';
import type pg from 'pg';

/** 옛 주소의 승인을 기다린다 · 새 주소의 확인을 기다린다 */
export type EmailChangeStage = 'approve' | 'confirm';

export interface PendingEmailChange {
  newEmail: string;
  stage: EmailChangeStage;
  /** 지금 살아 있는 링크 토큰의 SHA-256 — 원문은 메일에만 있다 */
  tokenDigest: string;
  expiresAt: Date;
}

/** 시도를 세는 창(초) — 로그인 한도와 같은 1분이다 */
const ATTEMPT_WINDOW_SECONDS = 60;

export function pendingIdentifier(userId: string): string {
  return `change-email:${userId}`;
}

function attemptIdentifier(userId: string): string {
  return `change-email-attempt:${userId}`;
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 저장한 값을 읽는다 — 모양이 다르면 없는 것으로 친다(손으로 고친 줄이 링크를 살리지 않게) */
export function parsePending(value: string, expiresAt: Date): PendingEmailChange | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const stage = parsed['stage'];
    if (
      typeof parsed['new_email'] !== 'string' ||
      typeof parsed['token'] !== 'string' ||
      (stage !== 'approve' && stage !== 'confirm')
    ) {
      return null;
    }
    return { newEmail: parsed['new_email'], stage, tokenDigest: parsed['token'], expiresAt };
  } catch {
    return null;
  }
}

async function inTx<T>(
  pool: pg.Pool,
  lockKey: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 같은 사람의 두 요청이 동시에 와도 한 줄만 남게 차례로 처리한다 — 다른 사람끼리는 막지 않는다
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 요청을 적는다 — **그 사람의 대기 중인 요청을 갈아 끼운다.** 앞 요청의 링크는 이 순간 쓸 수 없게 된다(가장 새 요청
 * 하나만 산다). 단계가 넘어갈 때(옛 주소가 승인하면 새 주소로 확인 메일이 간다)도 이 함수로 새 링크의 지문을 적는다 —
 * 그러면 승인 링크는 다시 쓰이지 않는다. 수명은 링크와 같은 `EMAIL_VERIFY_TTL_MINUTES` 다.
 */
export async function recordPending(
  pool: pg.Pool,
  input: { userId: string; newEmail: string; stage: EmailChangeStage; token: string },
): Promise<void> {
  const identifier = pendingIdentifier(input.userId);
  await inTx(pool, identifier, async (client) => {
    // 끝났거나 버려진 요청의 줄이 남지 않게, 만료된 이메일 바꾸기 줄을 함께 치운다(표가 작아 훑어도 싸다)
    await client.query(
      `DELETE FROM auth_verification
        WHERE identifier = $1
           OR (identifier LIKE 'change-email%' AND expires_at <= now())`,
      [identifier],
    );
    await client.query(
      `INSERT INTO auth_verification (id, identifier, value, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [
        newId(),
        identifier,
        JSON.stringify({
          new_email: input.newEmail.toLowerCase(),
          stage: input.stage,
          token: tokenDigest(input.token),
        }),
        EMAIL_VERIFY_TTL_MINUTES,
      ],
    );
  });
}

/** 대기 중인 요청 — 만료됐으면 없는 것이다 */
export async function readPending(
  pool: pg.Pool,
  userId: string,
): Promise<PendingEmailChange | null> {
  const { rows } = await pool.query<{ value: string; expires_at: Date }>(
    `SELECT value, expires_at FROM auth_verification
      WHERE identifier = $1 AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [pendingIdentifier(userId)],
  );
  const row = rows[0];
  return row === undefined ? null : parsePending(row.value, row.expires_at);
}

/**
 * 링크가 지금 살아 있는 그 링크인가 — 같은 사람 · 같은 새 주소 · 같은 단계 · 같은 토큰이어야 한다. 인증 스택의 토큰은
 * 서명만 보는 JWT 라 수명(60분) 안에서는 몇 번이고 다시 쓸 수 있다 — 이 대조가 그것을 **한 번**으로 줄인다.
 */
export function matchesPending(
  pending: PendingEmailChange | null,
  input: { newEmail: string; stage: EmailChangeStage; token: string },
): boolean {
  return (
    pending !== null &&
    pending.stage === input.stage &&
    pending.newEmail === input.newEmail.toLowerCase() &&
    pending.tokenDigest === tokenDigest(input.token)
  );
}

/**
 * 끝난 요청을 지운다 — 지운 줄이 있으면 참이다. 같은 링크가 동시에 두 번 열려도 마무리(다른 로그인 끊기 · 옛 주소로
 * 알림)는 한 번만 한다.
 */
export async function consumePending(
  pool: pg.Pool,
  input: { userId: string; newEmail: string; token: string },
): Promise<boolean> {
  const { rows } = await pool.query<{ value: string; expires_at: Date }>(
    `DELETE FROM auth_verification
      WHERE identifier = $1
        AND value::jsonb ->> 'stage' = 'confirm'
        AND value::jsonb ->> 'new_email' = $2
        AND value::jsonb ->> 'token' = $3
      RETURNING value, expires_at`,
    [pendingIdentifier(input.userId), input.newEmail.toLowerCase(), tokenDigest(input.token)],
  );
  return rows.length > 0;
}

/** 요청을 버린다 — 새 주소를 다른 계정이 먼저 차지한 경우처럼 끝까지 갈 수 없을 때 */
export async function dropPending(pool: pg.Pool, userId: string): Promise<void> {
  await pool.query(`DELETE FROM auth_verification WHERE identifier = $1`, [
    pendingIdentifier(userId),
  ]);
}

/**
 * 사람마다 시도를 센다 — 1분에 `RATE_LIMIT_SIGN_IN_PER_MIN` 번까지(로그인 · 비밀번호 바꾸기와 같은 값). 인증 스택의 한도는
 * IP 로만 세서, 세션을 훔친 사람이 주소를 바꿔 가며 지금 비밀번호를 맞혀 보는 것을 막지 못한다. 넘었으면 거짓이다.
 * 세는 것은 시도다 — 비밀번호가 틀린 시도도 센다.
 */
export async function hitAttempt(pool: pg.Pool, userId: string): Promise<boolean> {
  const identifier = attemptIdentifier(userId);
  return inTx(pool, identifier, async (client) => {
    await client.query(
      `DELETE FROM auth_verification WHERE identifier = $1 AND expires_at <= now()`,
      [identifier],
    );
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_verification WHERE identifier = $1`,
      [identifier],
    );
    if ((rows[0]?.n ?? 0) >= RATE_LIMIT_SIGN_IN_PER_MIN) return false;
    await client.query(
      `INSERT INTO auth_verification (id, identifier, value, expires_at)
       VALUES ($1, $2, '1', now() + make_interval(secs => $3))`,
      [newId(), identifier, ATTEMPT_WINDOW_SECONDS],
    );
    return true;
  });
}
