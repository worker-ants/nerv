// L1 — 쿼터의 산수와 주체 판정 (api.md §1.8 · REQ-API-012)
//
// 실제 Valkey 는 여기서 쓰지 않는다. 이 계층이 답해야 하는 것은 "몇 번째부터 막느냐" 와
// "누구의 창에 세느냐" 이고, 둘 다 저장소가 죽어도 같아야 한다(폴백 카운터).

import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_INGEST_PER_MIN,
  RATE_LIMIT_PAT_PER_MIN,
  RATE_LIMIT_WEB_PER_MIN,
} from '@nerv/schema';
import { RateLimitService, RATE_WINDOW_SECONDS } from './rate-limit.service.js';
import { subjectOf } from './rate-limit.guard.js';
import type { ValkeyService } from '../modules/event/valkey.service.js';

/** Valkey 가 없을 때의 폴백 경로를 태운다 — null 은 "못 셌다" 다. */
const offline = { incrementWindow: async () => null } as unknown as ValkeyService;

const principal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId: 'u1',
  tokenId: null,
  ...over,
});

describe('쿼터 — 한도와 창', () => {
  it('한도까지는 통과하고 그 다음이 429다', async () => {
    const limiter = new RateLimitService(offline);
    const subject = { kind: 'pat', id: 'tok-1' } as const;
    const now = 1_800_000_000_000;

    for (let i = 0; i < RATE_LIMIT_PAT_PER_MIN; i += 1) {
      const decision = await limiter.hit(subject, now);
      expect(decision.allowed).toBe(true);
    }
    const over = await limiter.hit(subject, now);
    expect(over.allowed).toBe(false);
    expect(over.limit).toBe(RATE_LIMIT_PAT_PER_MIN);
    // 0 초를 주면 클라이언트가 곧장 다음 429 로 돌아온다
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.retryAfterSeconds).toBeLessThanOrEqual(RATE_WINDOW_SECONDS);
  });

  it('창이 바뀌면 다시 센다 — 고정 창이다', async () => {
    const limiter = new RateLimitService(offline);
    const subject = { kind: 'ingest', id: 'tok-1/s-1' } as const;
    const now = 1_800_000_000_000;

    for (let i = 0; i <= RATE_LIMIT_INGEST_PER_MIN; i += 1) await limiter.hit(subject, now);
    expect((await limiter.hit(subject, now)).allowed).toBe(false);

    const nextWindow = now + RATE_WINDOW_SECONDS * 1000;
    expect((await limiter.hit(subject, nextWindow)).allowed).toBe(true);
  });

  it('주체가 다르면 창도 다르다 — 한 토큰이 남의 창을 소진하지 않는다', async () => {
    const limiter = new RateLimitService(offline);
    const now = 1_800_000_000_000;
    for (let i = 0; i <= RATE_LIMIT_PAT_PER_MIN; i += 1) {
      await limiter.hit({ kind: 'pat', id: 'tok-1' }, now);
    }
    expect((await limiter.hit({ kind: 'pat', id: 'tok-1' }, now)).allowed).toBe(false);
    expect((await limiter.hit({ kind: 'pat', id: 'tok-2' }, now)).allowed).toBe(true);
    // 같은 id 라도 종류가 다르면 다른 창이다(한도 값이 다르므로)
    expect((await limiter.hit({ kind: 'web', id: 'tok-1' }, now)).allowed).toBe(true);
  });

  it('웹 세션 한도가 PAT 보다 넓다 — 쿼리 무효화 버스트를 흡수한다', () => {
    expect(RATE_LIMIT_WEB_PER_MIN).toBeGreaterThan(RATE_LIMIT_PAT_PER_MIN);
  });
});

describe('쿼터 — 주체 판정', () => {
  it('PAT 은 토큰당, 세션 쿠키는 사용자당이다', () => {
    expect(subjectOf({ url: '/api/v1/projects/p', nervPrincipal: principal() as never })).toEqual({
      kind: 'web',
      id: 'u1',
    });
    expect(
      subjectOf({ url: '/mcp', nervPrincipal: principal({ tokenId: 'tok-9' }) as never }),
    ).toEqual({ kind: 'pat', id: 'tok-9' });
  });

  it('`/api/v1` 과 `/mcp` 는 같은 풀이다 — 토큰이 주체이므로 표면을 나누지 않는다', () => {
    const p = principal({ tokenId: 'tok-9' }) as never;
    expect(subjectOf({ url: '/api/v1/specs', nervPrincipal: p })).toEqual(
      subjectOf({ url: '/mcp', nervPrincipal: p }),
    );
  });

  it('ingest 는 세션당이되 토큰 안에서 가른다 — 훅 본문은 비신뢰 입력이다', () => {
    const p = principal({ tokenId: 'tok-9' }) as never;
    expect(
      subjectOf({ url: '/ingest/hooks/tool', nervPrincipal: p, body: { session_id: 'sess-a' } }),
    ).toEqual({ kind: 'ingest', id: 'tok-9/sess-a' });
    // 남의 세션 id 를 적어도 자기 토큰의 창에 센다
    expect(
      subjectOf({ url: '/ingest/hooks/tool', nervPrincipal: principal({ tokenId: 'tok-1' }) as never, body: { session_id: 'sess-a' } }),
    ).toEqual({ kind: 'ingest', id: 'tok-1/sess-a' });
  });

  it('SSE·WS 연결은 쿼터 대상이 아니다 — §1.8 마지막 줄', () => {
    const p = principal({ tokenId: 'tok-9' }) as never;
    expect(subjectOf({ url: '/sse/projects/p', nervPrincipal: p })).toBeNull();
    expect(subjectOf({ url: '/ws', nervPrincipal: p })).toBeNull();
  });

  it('인증되지 않은 요청은 세지 않는다 — 주체가 없다', () => {
    expect(subjectOf({ url: '/api/v1/projects/p' })).toBeNull();
  });

  it('쿼리스트링은 경로 판정을 바꾸지 않는다', () => {
    const p = principal({ tokenId: 'tok-9' }) as never;
    expect(subjectOf({ url: '/sse/projects/p?since=1', nervPrincipal: p })).toBeNull();
  });
});
