// 게이트 정책 탭의 리뷰 컷오버 단계 — 2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-WEB-331
//
// 프로젝트가 병행 운영 표(roadmap §7.4)의 어느 줄에 있는지 admin 이 고른다. 바꾸면 서버가 그 시각부터 2주 관측을 다시 센다 — 같은
// 값을 다시 고르면 바뀐 것이 아니다. 정책 · 보존 기간과 같은 [저장]으로 보내되 바뀐 칸만 보낸다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const membership = (roles: string[]): unknown => ({
  id: 'u-1',
  display_name: '관리자',
  memberships: [
    { org_slug: 'default', org_name: 'Default', project_slug: null, project_name: null, roles },
  ],
});

let me: unknown = membership(['admin']);
let stored: Record<string, unknown> = {};
let sent: { method: string; url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nerv.last-org', 'default');
  localStorage.setItem('nerv.last-project.default', 'sudoku');
  sent = [];
  me = membership(['admin']);
  stored = {
    gate_policy: {},
    retention: {},
    review_sot: 'git',
    review_sot_since: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        sent.push({ method, url: path, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      const json = /\/orgs\/[^/]+\/projects/.test(path)
        ? [{ id: 'p-2', slug: 'sudoku', name: '스도쿠' }]
        : /\/projects\/sudoku$/.test(path)
          ? { id: 'p-2', slug: 'sudoku', name: '스도쿠', ...stored }
          : path.endsWith('/me')
            ? me
            : path.endsWith('/members')
              ? []
              : { items: [], memberships: [], count: 0, summary: {} };
      return { ok: true, status: 200, json: async () => json };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderGates(): void {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings/gates?project=sudoku'] }),
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

const saveButton = async (): Promise<HTMLButtonElement> =>
  (await screen.findByRole('button', { name: '저장' })) as HTMLButtonElement;

describe('리뷰 컷오버 단계 (REQ-WEB-331)', () => {
  it('지금 단계와 그 뜻을 보이고, 바꾸면 전후를 보인 뒤 그 칸만 보낸다', async () => {
    renderGates();
    const select = (await screen.findByTestId('gates-sot-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('git');
    const hint = await screen.findByTestId('gates-sot-hint');
    expect(hint.textContent).toContain('로컬 훅이 판정하고 NERV는 비교만 기록합니다.');
    expect(hint.textContent).toContain('아직 바꾼 적이 없습니다.');
    fireEvent.change(select, { target: { value: 'dual' } });
    expect((await screen.findByTestId('gates-sot-hint')).textContent).toContain(
      '관측 창이 저장한 시각부터 다시 시작합니다',
    );
    expect((await screen.findByTestId('gates-unsaved')).textContent).toContain(
      '리뷰 컷오버 컷오버 전(git) → M1 이중화',
    );
    const save = await saveButton();
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.body).toEqual({ review_sot: 'dual' });
  });

  it('바꾼 시각을 보이고, 같은 값으로 되돌리면 저장할 것이 없다', async () => {
    stored = {
      ...stored,
      review_sot: 'dual',
      review_sot_since: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    };
    renderGates();
    const select = (await screen.findByTestId('gates-sot-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('dual'));
    expect((await screen.findByTestId('gates-sot-hint')).textContent).toContain(
      '2일 전에 바꿨습니다. 2주 관측은 이 시각부터 셉니다.',
    );
    fireEvent.change(select, { target: { value: 'nerv' } });
    fireEvent.change(select, { target: { value: 'dual' } });
    expect((await saveButton()).disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it('admin 이 아니면 지금 단계를 보이되 고를 수 없다', async () => {
    me = membership(['planner']);
    stored = { ...stored, review_sot: 'nerv' };
    renderGates();
    const select = (await screen.findByTestId('gates-sot-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('nerv'));
    expect(select.disabled).toBe(true);
  });
});
