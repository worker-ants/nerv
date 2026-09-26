// 상태 표현은 한 벌이다 (2026-09-25 · UI/UX 검토 SYS-07 · REQ-WEB-236)
//
// 같은 상태가 자리마다 다른 색이었다 — 세션 요약 줄의 `stale` 점은 회색인데 바로 옆 세션 카드의 배지는 빨강이었고,
// 스펙 트리의 좁은 열은 초안을 노랑 · 검토 중을 파랑 · 폐기를 회색 점으로 그렸다(같은 트리의 표 배지는 회색 ·
// 호박 · 빨강). 점 색표를 각자 들고 있었기 때문이다. 표지(막는 중 · 정족수 · 우선순위)는 배지를 픽셀까지 손으로
// 베낀 알약이 다섯이었고, 같은 "막는 중" 이 홈과 받은 요청에서 크기가 달랐다.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';
import { SessionSummaryStrip } from '../features/session-monitor/session-board.js';
import { StatusBadge } from './status-badge.js';
import {
  SESSION_TOKEN,
  SPEC_VERSION_TOKEN,
  STATUS_DOT,
  TASK_TOKEN,
  statusDot,
} from './status-token.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('점은 엔티티 → 토큰 → 점 한 길이다', () => {
  it('stale 은 빨강이다 — 세션 카드의 배지와 같은 토큰(ui-wireframes 가 적색으로 정했다)', () => {
    expect(statusDot(SESSION_TOKEN, 'stale')).toBe('bg-status-danger');
    render(
      <LocaleProvider locale="ko">
        <SessionSummaryStrip summary={{ active: 2, stale: 1 }} />
      </LocaleProvider>,
    );
    const stale = screen.getByTestId('session-filter-stale');
    expect(stale.querySelector('[aria-hidden="true"]')?.className).toContain('bg-status-danger');
    const active = screen.getByTestId('session-filter-active');
    expect(active.querySelector('[aria-hidden="true"]')?.className).toContain(
      STATUS_DOT[SESSION_TOKEN.active],
    );
  });

  it('레인·문서의 점도 배지와 같은 토큰이다 — 매핑 밖의 값은 idle 의 점', () => {
    for (const [lane, token] of Object.entries(TASK_TOKEN)) {
      expect(statusDot(TASK_TOKEN, lane)).toBe(STATUS_DOT[token]);
    }
    expect(statusDot(SPEC_VERSION_TOKEN, 'draft')).toBe(STATUS_DOT.idle);
    expect(statusDot(SPEC_VERSION_TOKEN, 'in_review')).toBe(STATUS_DOT.waiting);
    expect(statusDot(SPEC_VERSION_TOKEN, 'deprecated')).toBe(STATUS_DOT.danger);
    expect(statusDot(SPEC_VERSION_TOKEN, 'no-such-state')).toBe(STATUS_DOT.idle);
  });
});

describe('스펙 트리의 좁은 열도 같은 점이다', () => {
  it('초안·검토 중·폐기의 점이 표 변형의 배지와 같은 토큰이다 — 승인됨은 점이 없다', async () => {
    const node = (key: string, docStatus: string) => ({
      id: key,
      key,
      title: key,
      type: 'feature',
      parent_id: null,
      doc_status: docStatus,
      version_no: 1,
    });
    const nodes = [
      node('SPC-A', 'approved'),
      node('SPC-D', 'draft'),
      node('SPC-R', 'in_review'),
      node('SPC-X', 'deprecated'),
    ];
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes('/specs/tree')) return ok(nodes);
        if (/\/specs\/SPC-A(\?|$)/.test(u)) return ok({ ...nodes[0], versions: [], body_md: '' });
        if (/\/orgs\/[^/]+\/projects/.test(u))
          return ok([{ id: 'p-1', slug: 'demo', name: 'Demo' }]);
        if (/\/projects\/demo$/.test(u))
          return ok({ id: 'p-1', slug: 'demo', key: 'DEMO', name: 'Demo' });
        if (u.endsWith('/me'))
          return ok({
            id: 'u-1',
            display_name: '지민',
            memberships: [
              { org_slug: 'nerv', org_name: 'NERV', project_slug: null, roles: ['admin'] },
            ],
          });
        return ok({ items: [], summary: {}, next_cursor: null, memberships: [], count: 0 });
      }),
    );
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/demo/specs/SPC-A'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RealtimeProvider>
            <RouterProvider router={router as never} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    const panel = await screen.findByTestId('spec-column-panel');
    await waitFor(() => expect(panel.querySelector('[data-dot="draft"]')).not.toBeNull());
    const dot = (status: string) => panel.querySelector(`[data-dot="${status}"]`)?.className ?? '';
    expect(dot('draft')).toContain(STATUS_DOT[SPEC_VERSION_TOKEN.draft]);
    expect(dot('in_review')).toContain(STATUS_DOT[SPEC_VERSION_TOKEN.in_review]);
    expect(dot('deprecated')).toContain(STATUS_DOT[SPEC_VERSION_TOKEN.deprecated]);
    expect(panel.querySelector('[data-dot="approved"]')).toBeNull();
  });
});

describe('표지도 상태 배지 한 부품이다', () => {
  it('점 없이 · 뜻 있는 기호로 · 촘촘하게 — 글자와 색은 같다', () => {
    render(
      <>
        <StatusBadge data-testid="plain" token="waiting" mark={null} label="막는 중" />
        <StatusBadge data-testid="arrow" token="waiting" mark="↑" label="기준이 지나감" />
        <StatusBadge data-testid="dense" token="danger" mark={null} size="sm" label="P0" />
      </>,
    );
    const plain = screen.getByTestId('plain');
    expect(plain.textContent).toBe('막는 중');
    expect(plain.getAttribute('data-badge')).toBe('waiting');
    expect(screen.getByTestId('arrow').textContent).toBe('↑기준이 지나감');
    const dense = screen.getByTestId('dense');
    expect(dense.textContent).toBe('P0');
    expect(dense.className).toContain('px-1.5');
    expect(dense.className).toContain('bg-status-danger-soft');
  });
});

/** `apps/web/src` 의 컴포넌트 파일 전부 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [p] : [];
  });
}

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('다시 갈라지지 않는다 — 소스를 센다', () => {
  it('점 색(진한 상태색)을 따로 든 표가 없다 — status-token.ts 의 STATUS_DOT 하나다', () => {
    // `'bg-status-<tone>'` 을 값으로 드는 객체 줄(`키: 'bg-status-…',`)이 점 색표의 모양이다
    const offenders = sources(SRC)
      .filter((file) => !file.endsWith('status-token.ts'))
      .filter((file) =>
        /^\s*[\w'"]+:\s*'bg-status-(idle-text|action|waiting|agent|progress|ok|done|danger)',/m.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('상태 배지를 손으로 베낀 알약이 없다 — 배지의 모양은 status-badge.tsx 에만 있다', () => {
    // 표지는 배지의 모양 줄이다 — 2026-09-26 척도로 접은 뒤의 것(모서리 · 글자 · 행간 · 굵기)과 그 전의 것(반 픽셀) 둘 다
    const pill =
      /rounded-nerv-sm[^"'`]*text-2xs[^"'`]*leading-normal[^"'`]*font-medium|rounded-\[5px\][^"'`]*px-2[^"'`]*py-\[2\.5px\]/;
    const offenders = sources(SRC)
      .filter((file) => !file.endsWith('status-badge.tsx'))
      .filter((file) => pill.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
