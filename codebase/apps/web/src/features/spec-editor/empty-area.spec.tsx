// 본문 없는 묶음 노드 — S3 (screens.md §2.4 · REQ-WEB-068)
//
// 임포터는 디렉터리마다 area 노드를 만드는데, 원본에 `_product-overview.md` 가 없으면
// 본문이 없다(4.7 §2.2 — clemvion 실측 area 16개 중 9개가 그렇다). 그냥 비워 두면
// 사람은 "내용이 사라졌다"로 읽는다 — 실제로 그 질문을 받았다(2026-08-24).

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function stub(detail: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      const json = /\/specs\/[^/?]+(\?|$)/.test(path)
        ? detail
        : path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '규아',
              memberships: [
                {
                  org_slug: 'nerv',
                  project_slug: 'clemvion',
                  roles: ['viewer'],
                  project_id: 'p-1',
                },
              ],
            }
          : path.includes('/projects/clemvion')
            ? { id: 'p-1', slug: 'clemvion', key: 'CLV', name: 'clemvion', org_slug: 'nerv' }
            : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
}

async function renderSpec(): Promise<void> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/p/clemvion/specs/4-nodes-1-logic'] }),
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
  // **제목이 뜰 때까지 기다린다** — 키는 라우트 파라미터라 로드 전에도 보인다.
  // 그것으로 기다리면 본문이 아직 안 온 상태를 검사하게 된다(실측으로 걸렸다).
  await waitFor(() => expect(screen.getAllByText(/로직 노드/).length).toBeGreaterThan(0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const AREA = {
  id: 's-1',
  key: '4-nodes-1-logic',
  title: '로직 노드',
  type: 'area',
  body_md: '',
  version_no: 1,
  status: 'approved',
};

describe('본문 없는 area 노드 (REQ-WEB-068)', () => {
  beforeEach(() => localStorage.clear());

  it('빈 화면 대신 무엇이고 어디로 가면 되는지 말한다', async () => {
    stub(AREA);
    await renderSpec();
    const note = screen.getByTestId('spec-empty-body').textContent ?? '';
    expect(note).toContain('디렉터리를 묶는 노드');
    // 원본에 개요 문서가 없다는 사실까지 말해야 "사라진 것"과 구별된다
    expect(note).toContain('_product-overview.md');
  });

  it('area 가 아닌데 비었으면 다른 말을 한다 — 이건 실제로 빈 문서다', async () => {
    stub({ ...AREA, type: 'feature' });
    await renderSpec();
    expect(screen.getByTestId('spec-empty-body').textContent).toContain('본문이 비어 있습니다');
  });

  it('본문이 있으면 안내를 띄우지 않는다', async () => {
    stub({ ...AREA, body_md: '# 로직 노드\n\n본문이 있다.' });
    await renderSpec();
    expect(screen.queryByTestId('spec-empty-body')).toBeNull();
  });
});
