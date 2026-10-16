// S3 워치 단추 — 문서와 영역 (2026-10-16 · 사람 결정 D5 · REQ-WEB-328 · screens.md §2.4)
//
// 알림 카탈로그(spec-workflow §6.3)는 승인 · 거절 · 코멘트를 「워처」에게도 보낸다고 적었는데 워치할 자리가 없었다. 문서 화면의
// 단추는 지금 상태를 보이고 누르면 건다. **영역 문서면 영역 워치다** — 그 아래 문서와 작업의 알림까지 받는다는 것을 이름이 적는다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ko } from '@nerv/schema';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { routeTree } from '../../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

let specType = 'feature';
let watchRows: Record<string, unknown>[] = [];
let sent: { path: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  localStorage.clear();
  specType = 'feature';
  watchRows = [];
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET')
        sent.push({
          path,
          method,
          body: init?.body === undefined ? undefined : JSON.parse(init.body),
        });
      const json = path.includes('/me/watches')
        ? method === 'GET'
          ? { items: watchRows }
          : { ok: true }
        : path.includes('/relations')
          ? { items: [] }
          : path.includes('/specs/SPC-AREA')
            ? {
                id: 's-1',
                key: 'SPC-AREA',
                title: '웹챗 영역',
                project_id: 'p-1',
                type: specType,
                doc_status: 'approved',
                version_id: 'v-1',
                version_no: 1,
                body_md: '# 웹챗 영역\n',
                content_hash: 'h1',
              }
            : path.includes('/projects')
              ? [{ id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion' }]
              : path.includes('/me')
                ? {
                    id: 'u-1',
                    display_name: '지민',
                    memberships: [
                      {
                        org_slug: 'default',
                        org_name: 'default',
                        project_slug: 'clemvion',
                        roles: ['qa'],
                      },
                    ],
                  }
                : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderSpec(): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/specs/SPC-AREA'] }),
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
  await waitFor(() => expect(screen.getByTestId('spec-title')).toBeTruthy());
}

describe('워치 단추 (REQ-WEB-328)', () => {
  it('영역 문서는 영역 워치다 — 누르면 영역으로 건다', async () => {
    specType = 'area';
    await renderSpec();
    const button = await screen.findByTestId('watch-toggle');
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('false'));
    expect(button.textContent).toContain(ko['watch.off_area']);
    expect(button.getAttribute('title')).toBe(ko['watch.hint_area']);
    fireEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      body: { project: 'clemvion', target_type: 'area', target: 'SPC-AREA' },
    });
  });

  it('이미 워치한 문서는 눌린 채로 보이고, 누르면 그 워치를 푼다', async () => {
    watchRows = [{ id: 'w-1', target_type: 'spec', key: 'SPC-AREA', target_id: 's-1' }];
    await renderSpec();
    const button = await screen.findByTestId('watch-toggle');
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect(button.textContent).toContain(ko['watch.on']);
    fireEvent.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: 'DELETE' });
    expect(sent[0]?.path).toContain('/me/watches/w-1');
  });
});
