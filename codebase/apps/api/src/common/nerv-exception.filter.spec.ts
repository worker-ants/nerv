// NERV_* ↔ HTTP 상태 매핑 — 정본: docs/04-mvp/api.md §1.4
// 매핑이 틀어지면 에이전트의 에러 대응 규약(agent-integration §2.7)이 통째로 어긋난다.

import { describe, expect, it } from 'vitest';
import { msg, NERV_ERROR, NERV_ERROR_CODES } from '@nerv/schema';
import type { ArgumentsHost } from '@nestjs/common';
import { NervError, NervExceptionFilter, statusFor } from './nerv-exception.filter.js';
import type { NervErrorBody } from './nerv-exception.filter.js';

describe('statusFor — api.md §1.4 매핑표', () => {
  it.each([
    [NERV_ERROR.UNAUTHENTICATED, 401],
    [NERV_ERROR.FORBIDDEN, 403],
    [NERV_ERROR.CONFLICT_SCOPE, 409],
    [NERV_ERROR.LEASE_EXPIRED, 409],
    [NERV_ERROR.DRAFT_LEASED, 409],
    [NERV_ERROR.APPROVAL_REQUIRED, 202],
    [NERV_ERROR.HUMAN_ONLY, 403],
    [NERV_ERROR.RATE_LIMIT, 429],
    [NERV_ERROR.UNAVAILABLE, 503],
  ])('%s → %i', (code, status) => {
    expect(statusFor(code, {})).toBe(status);
  });

  it('NERV_PRECONDITION 은 두 갈래다 — zod 위반은 400, 그 밖은 409', () => {
    expect(statusFor(NERV_ERROR.PRECONDITION, { issues: [] })).toBe(400);
    expect(statusFor(NERV_ERROR.PRECONDITION, { kind: 'base_version' })).toBe(409);
  });

  it('코드 10종 전부가 매핑을 갖는다', () => {
    expect(NERV_ERROR_CODES).toHaveLength(10);
    for (const code of NERV_ERROR_CODES) {
      expect(typeof statusFor(code, {})).toBe('number');
    }
  });
});

describe('봉투의 message 는 요청 로케일로 만든다', () => {
  /** 필터가 보는 만큼만 흉내 낸다 — 헤더와 응답 두 가지다 */
  function catchWith(acceptLanguage: string | string[] | undefined, error: unknown) {
    let sent: NervErrorBody | undefined;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'accept-language': acceptLanguage } }),
        getResponse: () => ({
          status: () => ({
            send: (payload: unknown) => {
              sent = payload as NervErrorBody;
            },
          }),
          header: () => undefined,
        }),
      }),
    } as unknown as ArgumentsHost;
    new NervExceptionFilter().catch(error, host);
    return sent;
  }

  const error = new NervError(
    NERV_ERROR.PRECONDITION,
    msg('error.task.not_ready', { status: 'backlog' }),
  );

  it('Accept-Language 가 없으면 기본 로케일(ko)', () => {
    expect(catchWith(undefined, error)?.message).toBe('작업이 ready 가 아닙니다(backlog).');
  });

  it('en 을 요청하면 영어 문장이 나간다', () => {
    expect(catchWith('en-US,en;q=0.9', error)?.message).toBe('The task is not ready (backlog).');
  });

  it('모르는 언어는 기본 로케일로 떨어진다 — 협상 실패가 500 이 되면 안 된다', () => {
    expect(catchWith('fr-FR', error)?.message).toBe('작업이 ready 가 아닙니다(backlog).');
  });

  it('중복 헤더(배열)도 읽는다 — Fastify 가 그렇게 준다', () => {
    expect(catchWith(['en'], error)?.message).toBe('The task is not ready (backlog).');
  });

  it('코드와 details 는 로케일과 무관하다 — 기계가 읽는 것은 번역하지 않는다', () => {
    const ko = catchWith('ko', error);
    const en = catchWith('en', error);
    expect(en?.code).toBe(ko?.code);
    expect(en?.details).toEqual(ko?.details);
  });
});
