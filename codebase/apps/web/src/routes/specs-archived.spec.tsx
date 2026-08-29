// 전수의 경계 — 보관 보기와 복구 (screens.md §2.4b · REQ-WEB-105)
//
// 보관한 문서는 **어느 목록에도 없었다**: 토글도 배너도 복구 버튼도 화면에 없어서,
// 메타 다이얼로그로 보관하고 나면 웹만 쓰는 사람에게는 되돌릴 길이 없었다(실측 2026-08-29).
// 그래서 이 파일이 보는 것은 화면의 모양이 아니라 **경로가 살아 있는가**다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

/** 무엇을 요청했는지가 검사 대상이다 — 토글은 화면이 아니라 질의를 바꾼다 */
let asked: string[] = [];
let posted: string[] = [];

const LIVE = {
  id: 's1',
  key: 'SPC-LIVE',
  title: '살아 있는 문서',
  type: 'feature',
  parent_id: null,
  doc_status: 'approved',
  version_no: 1,
  archived_at: null,
};
const GONE = {
  ...LIVE,
  id: 's2',
  key: 'SPC-GONE',
  title: '보관된 문서',
  archived_at: '2026-08-29T00:00:00Z',
};

beforeEach(() => {
  localStorage.clear();
  asked = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (init?.method === 'POST') posted.push(u);
      const on = u.includes('include_archived=true');
      if (u.includes('/specs/tree')) {
        asked.push(u);
        return { ok: true, status: 200, json: async () => (on ? [LIVE, GONE] : [LIVE]) };
      }
      if (u.includes('/specs/graph')) {
        asked.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => ({ nodes: on ? [LIVE, GONE] : [LIVE], edges: [] }),
        };
      }
      if (u.includes('/specs/SPC-GONE')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            spec_id: 's2',
            key: 'SPC-GONE',
            title: '보관된 문서',
            type: 'feature',
            project_id: 'p1',
            version_id: 'v2',
            version_no: 1,
            doc_status: 'approved',
            body_md: '# 보관',
            archived_at: '2026-08-29T00:00:00Z',
            requirements: [],
            tasks: [],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'p1',
          items: [],
          memberships: [{ org_slug: 'default', project_slug: 'clemvion', roles: ['planner'] }],
          count: 0,
          summary: {},
        }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderAt(path: string): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
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
}

describe('보관 보기 (REQ-WEB-105)', () => {
  it('기본은 꺼져 있다 — 보관은 목록에서 빠지는 것이 그 뜻이다', async () => {
    await renderAt('/p/clemvion/specs');
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.every((u) => u.includes('include_archived=false'))).toBe(true);
  });

  it('켜면 목록이 보관까지 담고, 보관한 줄은 표식으로 갈린다', async () => {
    await renderAt('/p/clemvion/specs');
    await screen.findAllByText('살아 있는 문서');
    fireEvent.click(screen.getByTestId('show-archived'));

    await waitFor(() => expect(screen.getAllByText('보관된 문서').length).toBeGreaterThan(0));
    expect(screen.getAllByText('보관됨').length).toBeGreaterThan(0);
  });

  it('켠 상태는 주소에 남는다 — 링크로 건네면 같은 목록을 본다', async () => {
    await renderAt('/p/clemvion/specs?archived=true');
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.some((u) => u.includes('include_archived=true'))).toBe(true);
  });
});

describe('복구는 문서 안에 있다 (REQ-WEB-105)', () => {
  it('보관된 문서를 열면 배너가 그 사실을 먼저 말한다', async () => {
    await renderAt('/p/clemvion/specs/SPC-GONE');
    expect(await screen.findByTestId('archived-banner')).toBeTruthy();
  });

  it('[복구]가 EP-SPEC-17 을 부른다 — 목록에서 빠진 문서라 이 자리가 유일한 손잡이다', async () => {
    await renderAt('/p/clemvion/specs/SPC-GONE');
    fireEvent.click(await screen.findByTestId('spec-restore'));
    await waitFor(() =>
      expect(posted.some((u) => u.endsWith('/specs/SPC-GONE/restore'))).toBe(true),
    );
  });
});
