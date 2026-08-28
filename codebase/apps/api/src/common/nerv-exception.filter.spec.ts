// NERV_* ↔ HTTP 상태 매핑 — 정본: docs/04-mvp/api.md §1.4
// 매핑이 틀어지면 에이전트의 에러 대응 규약(agent-integration §2.7)이 통째로 어긋난다.

import { describe, expect, it } from 'vitest';
import { msg, NERV_ERROR, NERV_ERROR_CODES } from '@nerv/schema';
import type { ArgumentsHost } from '@nestjs/common';
import { diagnostic, NervError, NervExceptionFilter, statusFor } from './nerv-exception.filter.js';
import { dbConstraintError } from './db-error.js';
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

describe('원인 사슬 — 감싸는 예외가 이유를 삼키지 않는다 (2026-08-24)', () => {
  it('cause 를 끝까지 편다', () => {
    // 실측: drizzle 은 드라이버 오류를 감싸면서 message 에 **SQL 전문**을 넣는다.
    // stack 만 찍으면 로그에 쿼리만 남고 "왜 실패했는지"가 사라진다 — 그 쿼리는
    // psql 에서 멀쩡히 도는 것이라 로그만 보고는 아무것도 알 수 없었다.
    const root = new Error('connection terminated unexpectedly');
    const wrapped = new Error('Failed query: SELECT ...', { cause: root });
    const text = diagnostic(wrapped);
    expect(text).toContain('Failed query');
    expect(text).toContain('caused by');
    expect(text).toContain('connection terminated unexpectedly');
  });

  it('사슬이 순환해도 멈춘다', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => diagnostic(a)).not.toThrow();
  });

  it('Error 가 아닌 것도 문자열로 남긴다 — 삼키는 것보다 낫다', () => {
    expect(diagnostic('그냥 문자열')).toBe('그냥 문자열');
    expect(diagnostic(new Error('겉', { cause: { code: '57P01' } }))).toContain('57P01');
  });
});

// 2026-08-28 사람 보고 — 같은 키로 프로젝트를 만들면 "internal server error" 만 보였다.
// 무결성 위반은 **서버의 잘못이 아니다**: 어느 필드가 왜 막혔는지 말해야 사람이 고칠 수 있다.
describe('DB 무결성 위반은 이유가 된다 (§1.4a)', () => {
  /** drizzle 은 드라이버 오류를 감싼다 — 맨 위만 보면 SQL 전문뿐이라 사슬을 편다 */
  const wrapped = (pg: Record<string, unknown>): Error =>
    Object.assign(new Error('Failed query: insert into "project" ...'), { cause: pg });

  const unique = {
    code: '23505',
    constraint: 'project_org_key_uq',
    detail: 'Key (org_id, key)=(01a0…, nerv) already exists.',
    table: 'project',
  };

  it('중복 값은 409 이고 **어느 필드**인지 말한다', () => {
    const error = dbConstraintError(wrapped(unique));
    expect(error).not.toBeNull();
    expect(error?.code).toBe(NERV_ERROR.PRECONDITION);
    expect(error?.details['kind']).toBe('unique_violation');
    expect(error?.details['fields']).toEqual(['org_id', 'key']);
    expect(error?.details['constraint']).toBe('project_org_key_uq');
    expect(statusFor(error!.code, error!.details)).toBe(409);
    // 사람에게는 **고를 수 있는 값**만 부른다 — org_id 는 지금 있는 조직이지 입력이 아니다
    expect(error?.message).toContain('key');
    expect(error?.message).not.toContain('org_id');
  });

  it('값은 싣지 않는다 — detail 에 있는 충돌 값이 새어 나가면 안 된다', () => {
    const error = dbConstraintError(wrapped(unique));
    expect(JSON.stringify(error?.details)).not.toContain('nerv');
    expect(error?.message).not.toContain('nerv');
  });

  it('빠뜨린 값·허용되지 않는 값·너무 긴 값은 400 — 입력의 **모양**이 틀린 것이다', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ code: '23502', column: 'name', table: 'project' }, 'not_null_violation'],
      [{ code: '23514', constraint: 'task_status_ck', table: 'task' }, 'check_violation'],
      [{ code: '22001', table: 'spec' }, 'too_long'],
    ];
    for (const [pg, kind] of cases) {
      const error = dbConstraintError(wrapped(pg));
      expect(error?.details['kind']).toBe(kind);
      expect(statusFor(error!.code, error!.details)).toBe(400);
    }
  });

  it('없는 참조는 409 — 모양이 아니라 상태다(다른 시점에는 성공한다)', () => {
    const error = dbConstraintError(
      wrapped({
        code: '23503',
        constraint: 'task_spec_id_fk',
        detail: 'Key (spec_id)=(01a0…) is not present in table "spec".',
      }),
    );
    expect(error?.details['kind']).toBe('foreign_key_violation');
    expect(error?.details['fields']).toEqual(['spec_id']);
    expect(statusFor(error!.code, error!.details)).toBe(409);
  });

  it('서버 로케일 때문에 detail 을 못 읽어도 제약 이름은 남긴다', () => {
    const error = dbConstraintError(
      wrapped({ code: '23505', constraint: 'project_org_key_uq', detail: '중복 키 …' }),
    );
    expect(error?.details['fields']).toEqual([]);
    expect(error?.details['constraint']).toBe('project_org_key_uq');
  });

  it('**모르는 오류는 그대로 500 이다** — 서버 결함을 사용자 잘못으로 둔갑시키지 않는다', () => {
    expect(dbConstraintError(new Error('boom'))).toBeNull();
    expect(dbConstraintError(wrapped({ code: '42P01' }))).toBeNull(); // 없는 테이블 = 우리 잘못
  });
});
