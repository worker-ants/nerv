// NERV_* 에러 코드 ↔ HTTP 상태 매핑 — 정본: docs/04-mvp/api.md §1.4
//
// 에러 본문은 MCP 표면과 **같은 봉투**를 쓴다(agent-integration §2.7). REST 전용 코드를
// 신설하지 않는다. `next_actions` 는 MCP 표면에서 채워지는 필드이고 REST 는 빈 배열이다.
// 구조화 에러의 MCP 쪽 완성(next_actions 산출)은 E03-S04 소관이다.

import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { DEFAULT_LOCALE, NERV_ERROR, negotiateLocale, renderMessage } from '@nerv/schema';
import type { Locale, Message, NervErrorCode } from '@nerv/schema';
import { dbConstraintError } from './db-error.js';

/**
 * 도메인·표면이 던지는 NERV 에러. code 가 곧 HTTP 상태를 정한다(아래 매핑).
 *
 * 두 번째 인자가 문장이 아니라 **`Message`(키 + 값)** 인 것이 i18n 의 요점이다. 에러를 던지는
 * 곳은 도메인 서비스이고 거기서는 요청 로케일을 모른다 — 알아야 한다면 판정과 표현이 한
 * 서비스에 섞이고, 그건 D-05 가 금지하는 것이다. 로케일을 아는 것은 HTTP 표면(아래 필터)뿐이라
 * 문장은 거기서 만든다.
 *
 * `Error.message` 에는 기본 로케일(ko) 렌더링을 담는다 — 로그·스택트레이스가 키만 남으면
 * 사람이 못 읽는다.
 */
export class NervError extends Error {
  constructor(
    readonly code: NervErrorCode,
    readonly descriptor: Message,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(renderMessage(descriptor, DEFAULT_LOCALE));
    this.name = 'NervError';
  }
}

/**
 * 아직 담당 스토리가 채우지 않은 자리.
 * 골격(E01-S02)이 남기는 표시이며, 각 스토리가 구현으로 대체하면 사라진다.
 * NERV_* 코드가 아니다 — 계약(api.md §1.4)에 없는 상태라 501 로 내보내고 봉투에 코드를 싣지 않는다.
 */
export class NotImplementedYetError extends Error {
  constructor(
    readonly story: string,
    what: string,
  ) {
    super(`${what} — ${story} 에서 구현한다`);
    this.name = 'NotImplementedYetError';
  }
}

/** api.md §1.4 매핑표. NERV_PRECONDITION 은 400/409 두 갈래라 details.kind 로 가른다. */
const STATUS: Record<NervErrorCode, number> = {
  [NERV_ERROR.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [NERV_ERROR.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [NERV_ERROR.PRECONDITION]: HttpStatus.CONFLICT,
  [NERV_ERROR.CONFLICT_SCOPE]: HttpStatus.CONFLICT,
  [NERV_ERROR.LEASE_EXPIRED]: HttpStatus.CONFLICT,
  [NERV_ERROR.DRAFT_LEASED]: HttpStatus.CONFLICT,
  [NERV_ERROR.APPROVAL_REQUIRED]: HttpStatus.ACCEPTED,
  [NERV_ERROR.HUMAN_ONLY]: HttpStatus.FORBIDDEN,
  [NERV_ERROR.RATE_LIMIT]: HttpStatus.TOO_MANY_REQUESTS,
  [NERV_ERROR.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
};

/**
 * 입력의 **모양**이 틀린 것은 400, 그 밖의 전제조건 위반은 409(api.md §1.4).
 *
 * zod 위반이 원래의 400 이고, DB 무결성 위반 중 셋이 같은 성질이다(§1.4a): 빠뜨린 값 ·
 * 허용되지 않는 값 · 너무 긴 값. 반대로 중복 값과 없는 참조는 **모양이 아니라 상태** 라
 * 409 다 — 같은 요청이 다른 시점에는 성공한다.
 */
const BAD_REQUEST_KINDS = new Set(['not_null_violation', 'check_violation', 'too_long']);

export function statusFor(code: NervErrorCode, details: Record<string, unknown>): number {
  if (code !== NERV_ERROR.PRECONDITION) return STATUS[code];
  if ('issues' in details) return HttpStatus.BAD_REQUEST;
  if (BAD_REQUEST_KINDS.has(String(details['kind']))) return HttpStatus.BAD_REQUEST;
  return STATUS[code];
}

export interface NervErrorBody {
  ok: false;
  code: NervErrorCode | null;
  message: string;
  details: Record<string, unknown>;
  retry_after_s: number | null;
  next_actions: string[];
}

@Catch()
export class NervExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(NervExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // 로케일은 요청에서 온다 — 서비스는 몰랐고, 여기서만 안다
    const req = host.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const locale = negotiateLocale(headerOf(req?.headers, 'accept-language'));
    const { status, body } = this.translate(exception, locale);
    const res = host.switchToHttp().getResponse<{
      status(code: number): { send(payload: unknown): void };
      header(name: string, value: string): void;
    }>();
    if (body.retry_after_s !== null) res.header('Retry-After', String(body.retry_after_s));
    res.status(status).send(body);
  }

  private translate(exception: unknown, locale: Locale): { status: number; body: NervErrorBody } {
    if (exception instanceof NervError) {
      return {
        status: statusFor(exception.code, exception.details),
        body: {
          ok: false,
          code: exception.code,
          message: renderMessage(exception.descriptor, locale),
          details: exception.details,
          retry_after_s: exception.retryAfterSeconds,
          next_actions: [],
        },
      };
    }

    if (exception instanceof NotImplementedYetError) {
      return {
        status: HttpStatus.NOT_IMPLEMENTED,
        body: {
          ok: false,
          code: null,
          message: exception.message,
          details: { story: exception.story },
          retry_after_s: null,
          next_actions: [],
        },
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: {
          ok: false,
          code: null,
          message: exception.message,
          details: {},
          retry_after_s: null,
          next_actions: [],
        },
      };
    }

    // DB 무결성 위반은 **서버의 잘못이 아니다** — 무엇이 왜 막혔는지 말한다(§1.4a).
    // 이 갈래가 없으면 "같은 키로 프로젝트 만들기"가 internal error 로 보인다(사람 보고).
    const constraint = dbConstraintError(exception);
    if (constraint !== null) {
      return {
        status: statusFor(constraint.code, constraint.details),
        body: {
          ok: false,
          code: constraint.code,
          message: renderMessage(constraint.descriptor, locale),
          details: constraint.details,
          retry_after_s: null,
          next_actions: [],
        },
      };
    }

    this.logger.error(
      // eslint-disable-next-line no-restricted-syntax -- 운영자용 로그(REQ-CB-022)
      '처리되지 않은 예외',
      diagnostic(exception),
    );
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        ok: false,
        code: null,
        message: 'internal error',
        details: {},
        retry_after_s: null,
        next_actions: [],
      },
    };
  }
}

/** 헤더 한 개를 문자열로 — Fastify 는 중복 헤더를 배열로 준다 */
function headerOf(headers: Record<string, unknown> | undefined, name: string): string | null {
  const raw = headers?.[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

/**
 * 로그에 남길 진단 문자열 — **원인 사슬을 끝까지 편다**(2026-08-24 신설).
 *
 * `error.stack` 만 찍으면 감싸는 예외가 원인을 삼킨다. 실제로 그랬다: drizzle 이
 * 드라이버 오류를 `DrizzleQueryError` 로 감싸는데 그 `message` 는 **SQL 전문**이고
 * 진짜 이유는 `cause` 에 있다 — 로그에는 쿼리만 남고 "왜 실패했는지"가 없었다.
 * 쿼리는 psql 에서 멀쩡히 도는 것이라 로그만 보고는 아무것도 알 수 없다.
 *
 * 사슬을 도는 것은 다섯 겹까지다. 순환 참조는 `seen` 이 막는다.
 */
export function diagnostic(exception: unknown): string {
  if (!(exception instanceof Error)) return String(exception);
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = exception;
  for (let depth = 0; depth < 5 && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    parts.push(
      depth === 0
        ? (current.stack ?? current.message)
        : `caused by: ${current.stack ?? current.message}`,
    );
    current = (current as { cause?: unknown }).cause;
  }
  if (current !== undefined && current !== null && !(current instanceof Error)) {
    parts.push(`caused by: ${describe(current)}`);
  }
  return parts.join('\n');
}

/** Error 가 아닌 원인 — `[object Object]` 로 뭉개면 남긴 의미가 없다(pg 는 code 를 객체로 단다). */
function describe(value: unknown): string {
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
