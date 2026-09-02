// `Idempotency-Key` 헤더 처리 — 정본: docs/04-mvp/api.md §1.5
//
// **상태를 바꾸는 REST 요청 전부**가 이 헤더를 받는다(§1.5). 헤더가 없으면 그냥 지난다 —
// 재시도 안전성은 그때 클라이언트 책임이라고 문서가 적었다.
//
// 가드가 아니라 인터셉터인 이유: 재생은 **응답을 만드는 일**이라 핸들러를 건너뛰고 값을
// 돌려줘야 하고, 그럴 수 있는 것은 인터셉터뿐이다. 가드는 통과/거절만 말한다.

import { Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import { IdempotencyService, REPLAYED_HEADER } from './idempotency.service.js';
import type { Principal } from '../modules/auth/auth.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface IdempotentRequest {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  nervPrincipal?: Principal;
}

interface Replyable {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
}

/**
 * 주체 — **자격증명이 단위다**. 같은 사람이라도 토큰이 다르면 다른 주체다:
 * 두 에이전트가 각자의 토큰으로 같은 키를 만들 수 있고, 그때 서로의 응답을 재생하면
 * 하지도 않은 일의 결과를 받는다.
 */
export function subjectOfPrincipal(principal: Principal): string {
  return principal.tokenId === null ? `user:${principal.userId}` : `token:${principal.tokenId}`;
}

export function keyOf(req: IdempotentRequest): string | null {
  if (!MUTATING.has((req.method ?? '').toUpperCase())) return null;
  const raw = req.headers?.['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<IdempotentRequest>();
    const principal = req.nervPrincipal;
    const key = keyOf(req);
    if (key === null || principal === undefined) return next.handle();

    const subject = subjectOfPrincipal(principal);
    const route = `${(req.method ?? '').toUpperCase()} ${pathOf(req)}`;
    const fingerprint = IdempotencyService.fingerprint({ route, body: req.body });
    const res = context.switchToHttp().getResponse<Replyable>();

    return from(this.store.begin({ subject, key, fingerprint })).pipe(
      switchMap((outcome) => {
        if (outcome.replay !== null) {
          // 상태까지 같아야 재생이다 — 201 로 만들어진 것이 200 으로 돌아오면
          // 클라이언트의 분기가 달라진다.
          res.header(REPLAYED_HEADER, 'true');
          res.status(outcome.replay.statusCode);
          return of(outcome.replay.body);
        }
        // **응답보다 먼저 적는다.** 적기를 기다리지 않고 내보내면, 빠른 재시도가
        // completed_at 이 아직 NULL 인 행을 보고 "처리 중"(④)을 받는다 — 첫 요청이 이미
        // 끝났는데도. 재생이 되어야 할 자리에서 409 가 나가는 것은 계약 위반이다.
        return next.handle().pipe(
          switchMap((body: unknown) =>
            from(
              this.store.complete({ subject, key, statusCode: statusOf(res), body: body ?? null }),
            ).pipe(map(() => body)),
          ),
          // 실패는 박제하지 않는다 — 자리를 비워야 재시도가 다시 실행된다.
          // 비우기를 기다린 뒤에 에러를 흘린다: 클라이언트가 429 를 받자마자 재시도하는데
          // 그때까지 자리가 남아 있으면 그 재시도가 "처리 중" 을 받는다.
          catchError((error: unknown) =>
            from(this.store.abandon({ subject, key })).pipe(
              switchMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }
}

function pathOf(req: IdempotentRequest): string {
  const raw = req.originalUrl ?? req.url ?? '';
  const query = raw.indexOf('?');
  return query === -1 ? raw : raw.slice(0, query);
}

/** Fastify 의 reply 는 `statusCode` 를 들고 있다. 없으면 200 이 기본이다. */
function statusOf(res: Replyable): number {
  const code = (res as { statusCode?: unknown }).statusCode;
  return typeof code === 'number' ? code : 200;
}
