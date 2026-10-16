// 게이트 정책 — 판정할 수 없을 때의 격상 기준 · 보존 기간 (2026-10-15 · 사람 결정 · REQ-WEB-318)
//
// 2026-10-15 전까지 두 값은 볼 수만 있었고(`retention` 은 화면 어디에도 없었다), 문장은 결정과 다르게 "티어를
// 올립니다" 라 적었다. admin 은 같은 폼에서 고치고, 범위 밖이면 그 자리에서 이유를 본다 — 서버와 같은 스키마다.
// admin 이 아니면 지금 값을 읽기 전용으로 본다.

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
    gate_policy: { failopen: { escalate_count: 3, window_hours: 24 } },
    retention: { activity_days: 90, prompt_blob_ttl_days: 30 },
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

async function field(testId: string): Promise<HTMLInputElement> {
  const input = (await screen.findByTestId(testId)) as HTMLInputElement;
  return input;
}

const saveButton = async (): Promise<HTMLButtonElement> =>
  (await screen.findByRole('button', { name: '저장' })) as HTMLButtonElement;

describe('판정할 수 없을 때 — 격상 기준 (REQ-WEB-318)', () => {
  it('지금 값으로 시작하고, 문장은 티어가 아니라 알림과 배너를 말한다', async () => {
    renderGates();
    const count = await field('gates-failopen-count');
    await waitFor(() => expect(count.value).toBe('3'));
    expect((await field('gates-failopen-hours')).value).toBe('24');
    const body = (await screen.findByTestId('gates-failopen-body')).textContent ?? '';
    expect(body).toContain('24시간 안에 3번 이상 쌓이면 격상합니다');
    expect(body).toContain('admin에게 중요 알림');
    expect(body).not.toContain('티어');
    // 보기 전용이라는 말은 없어졌다
    expect(screen.queryByText(/보기 전용/)).toBeNull();
  });

  it('admin 이 고쳐 저장하면 정책에 담아 보내고, 보존 기간은 고치지 않았으니 보내지 않는다', async () => {
    renderGates();
    const count = await field('gates-failopen-count');
    await waitFor(() => expect(count.disabled).toBe(false));
    fireEvent.change(count, { target: { value: '5' } });
    fireEvent.change(await field('gates-failopen-hours'), { target: { value: '48' } });
    expect((await screen.findByTestId('gates-failopen-body')).textContent).toContain(
      '48시간 안에 5번 이상',
    );
    expect((await screen.findByTestId('gates-unsaved')).textContent).toContain(
      '격상 기준 24시간 안에 3번 → 48시간 안에 5번',
    );
    const save = await saveButton();
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toMatch(/\/projects\/sudoku$/);
    const policy = sent[0]?.body['gate_policy'] as Record<string, unknown>;
    expect(policy['failopen']).toEqual({ escalate_count: 5, window_hours: 48 });
    expect(sent[0]?.body).not.toHaveProperty('retention');
  });

  it('1 이상의 정수가 아니면 그 자리에서 이유를 보이고 저장하지 않는다', async () => {
    renderGates();
    const count = await field('gates-failopen-count');
    await waitFor(() => expect(count.disabled).toBe(false));
    fireEvent.change(count, { target: { value: '0' } });
    expect(await screen.findByTestId('gates-failopen-invalid')).toBeDefined();
    expect(count.getAttribute('aria-invalid')).toBe('true');
    expect((await saveButton()).disabled).toBe(true);
    fireEvent.change(count, { target: { value: '2.5' } });
    expect((await saveButton()).disabled).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe('보존 기간 (REQ-WEB-318)', () => {
  it('늘리면 묻지 않고 보존 기간만 보낸다 — 게이트 정책은 보내지 않는다', async () => {
    renderGates();
    const activity = await field('gates-retention-activity');
    await waitFor(() => expect(activity.value).toBe('90'));
    expect((await field('gates-retention-blob')).value).toBe('30');
    fireEvent.change(activity, { target: { value: '120' } });
    expect((await screen.findByTestId('gates-unsaved')).textContent).toContain(
      '활동 원문 보존 90일 → 120일',
    );
    const save = await saveButton();
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      retention: { activity_days: 120, prompt_blob_ttl_days: 30 },
    });
  });

  it('줄이면 지워진다는 것을 한 번 더 묻는다', async () => {
    renderGates();
    const blob = await field('gates-retention-blob');
    await waitFor(() => expect(blob.disabled).toBe(false));
    fireEvent.change(blob, { target: { value: '7' } });
    fireEvent.click(await screen.findByTestId('gates-save'));
    expect(await screen.findByText(/보존 기간이 줄어듭니다/)).toBeDefined();
    expect(sent).toEqual([]);
  });

  it('범위 밖이면 이유를 보이고 저장하지 않는다', async () => {
    renderGates();
    const activity = await field('gates-retention-activity');
    await waitFor(() => expect(activity.disabled).toBe(false));
    fireEvent.change(activity, { target: { value: '' } });
    expect(await screen.findByTestId('gates-retention-invalid')).toBeDefined();
    expect((await saveButton()).disabled).toBe(true);
  });
});

describe('admin 이 아니면 읽기 전용 (REQ-WEB-318)', () => {
  it('지금 값을 보이되 칸은 잠긴다', async () => {
    me = membership(['planner']);
    renderGates();
    const count = await field('gates-failopen-count');
    await waitFor(() => expect(count.value).toBe('3'));
    for (const id of [
      'gates-failopen-count',
      'gates-failopen-hours',
      'gates-retention-activity',
      'gates-retention-blob',
    ]) {
      expect((await field(id)).disabled).toBe(true);
    }
    expect((await field('gates-retention-activity')).value).toBe('90');
  });
});
