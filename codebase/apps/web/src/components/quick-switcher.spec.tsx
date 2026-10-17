// E08-S09 — 전역 퀵 스위처 ⌘K (screens.md §1.3a · REQ-WEB-040)

import { LocaleProvider } from '../lib/i18n.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinTargetOf, pinToHit, readList, rememberVisit } from './quick-switcher.js';
import { routeTree } from '../routeTree.gen';
import { RealtimeProvider } from '../lib/realtime.js';
import { resetThemeForTesting } from '../lib/theme.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], summary: {}, memberships: [], count: 0 }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('최근 방문은 로컬 상태다 (§1.3a — 핀은 서버에 있다 · 2026-10-16)', () => {
  const hit = {
    key: 'SPC-CWC-007',
    title: '웹챗 위젯',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
  };

  it('방문을 기억하고 중복을 앞으로 당긴다', () => {
    rememberVisit(hit);
    rememberVisit({ ...hit, key: 'SPC-CWC-012', title: '세션 복원' });
    rememberVisit(hit);
    expect(readList('nerv.quickswitcher.recent').map((h) => h.key)).toEqual([
      'SPC-CWC-007',
      'SPC-CWC-012',
    ]);
  });

  it('핀은 문서 단위다 — 요구사항 · 헤딩으로 찾은 줄은 그 문서를 고정하고, 서버 줄은 앵커 없이 돌아온다', () => {
    expect(pinTargetOf({ ...hit, kind: 'requirement', anchor: 'REQ-CWC-001' })).toBe('spec');
    expect(pinTargetOf({ ...hit, kind: 'task' })).toBe('task');
    expect(pinTargetOf({ ...hit, kind: 'change_request' })).toBe('change_request');
    expect(pinTargetOf(hit)).toBe('spec');
    expect(
      pinToHit({
        id: 'p1',
        target_type: 'task',
        key: 'CLV-T-AAAAAA',
        title: '작업',
        type: 'ready',
        doc_status: null,
        project_slug: 'clemvion',
        project_name: 'Clemvion',
        org_slug: 'default',
      }),
    ).toMatchObject({ pin_id: 'p1', kind: 'task', key: 'CLV-T-AAAAAA', anchor: null });
  });

  it('localStorage 가 막힌 환경에서도 던지지 않는다', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('access denied');
    };
    expect(readList('nerv.quickswitcher.recent')).toEqual([]);
    Storage.prototype.getItem = original;
  });
});

describe('⌘K 로 열리고 Esc 로 닫힌다 — 전 라우트 공통', () => {
  function renderApp(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  it('키보드로 열리고 키보드로 닫힌다', async () => {
    renderApp();
    // 셸이 마운트된 뒤에 눌러야 한다 — 라우트 로딩이 끝나기 전에는 리스너가 없다
    await screen.findByText('NERV');
    expect(screen.queryByTestId('quick-switcher')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByTestId('quick-switcher');
    expect(dialog).toBeDefined();

    fireEvent.keyDown(screen.getByPlaceholderText(/번호 붙여넣기/), { key: 'Escape' });
    expect(screen.queryByTestId('quick-switcher')).toBeNull();
  });

  it('빈 입력에서는 최근 방문을 보여준다 — 방금 보던 것이 대개 다음 목적지다', async () => {
    rememberVisit({
      key: 'SPC-CWC-007',
      title: '웹챗 위젯',
      type: 'feature',
      doc_status: 'draft',
      anchor: null,
      // 기록은 **어느 프로젝트의 것인지** 안다(REQ-WEB-223) — 모르는 옛 기록은 읽지 않는다
      project_slug: 'clemvion',
    });
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByTestId('quick-switcher');
    expect(screen.getByText('웹챗 위젯')).toBeDefined();
  });
});

/**
 * 핀 UI(2026-09-05 감사 · 05) — **2026-10-16 부터 서버에 있다**(사람 결정 D5 · REQ-WEB-329).
 *
 * `togglePin` 과 그 테스트는 처음부터 있었는데 **화면에서 부르는 곳이 0건**이었다 — 매뉴얼은 "핀으로 고정하면 목록 위에
 * 남습니다" 라고 적고 있었고, 판정과 저장은 있는데 누를 자리가 없었다. 141편짜리 트리에서 매일 여는 대여섯은 최근 방문으로
 * 대체되지 않는다. 그 핀이 브라우저에만 있어 기기를 바꾸면 사라졌다 — 이제 서버(EP-NTF-13 ~ 16)가 든다.
 */
describe('핀 — 자주 가는 곳은 밀려나지 않는다 (05 · REQ-WEB-329)', () => {
  let serverPins: Record<string, unknown>[];
  let calls: { method: string; path: string; body: unknown }[];

  beforeEach(() => {
    serverPins = [];
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const path = String(url)
          .replace(/^.*\/api\/v1/, '')
          .split('?')[0]!;
        const method = init?.method ?? 'GET';
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        calls.push({ method, path, body });
        if (path === '/me/pins' && method === 'GET') {
          return { ok: true, status: 200, json: async () => ({ items: serverPins }) };
        }
        if (path === '/me/pins' && method === 'PUT') {
          const b = body as { target: string; project: string };
          serverPins = [
            {
              id: `pin-${b.target}`,
              target_type: 'spec',
              key: b.target,
              title: b.target,
              type: 'feature',
              doc_status: 'approved',
              project_slug: b.project,
              project_name: b.project,
              org_slug: 'default',
            },
            ...serverPins,
          ];
          return { ok: true, status: 200, json: async () => ({ created: true }) };
        }
        if (path.startsWith('/me/pins/') && method === 'DELETE') {
          const id = decodeURIComponent(path.slice('/me/pins/'.length));
          serverPins = serverPins.filter((p) => p['id'] !== id);
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        if (path === '/me/pins/import') {
          return { ok: true, status: 201, json: async () => ({ imported: 1, skipped: [] }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], summary: {}, memberships: [], count: 0 }),
        };
      }),
    );
  });

  function renderApp(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  const older = {
    key: 'SPC-OLD',
    title: '오래된 것',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
    project_slug: 'clemvion',
  };
  const daily = {
    key: 'SPC-DAILY',
    title: '매일 여는 것',
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
    project_slug: 'clemvion',
  };
  const serverPin = (key: string, title: string): Record<string, unknown> => ({
    id: `pin-${key}`,
    target_type: 'spec',
    key,
    title,
    type: 'feature',
    doc_status: 'approved',
    project_slug: 'clemvion',
    project_name: 'clemvion',
    org_slug: 'default',
  });

  it('줄마다 고정 단추가 있고, 누르면 서버에 고정하고 눌린 상태가 화면에 남는다', async () => {
    rememberVisit(daily);
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');

    const pin = await screen.findByTestId('switcher-pin-SPC-DAILY');
    expect(pin.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(pin);
    await waitFor(() => {
      expect(screen.getByTestId('switcher-pin-SPC-DAILY').getAttribute('aria-pressed')).toBe(
        'true',
      );
    });
    // 저장은 서버다 — 다른 기기에서도 같은 핀이다. 브라우저에는 남기지 않는다
    expect(calls).toContainEqual({
      method: 'PUT',
      path: '/me/pins',
      body: { project: 'clemvion', target_type: 'spec', target: 'SPC-DAILY' },
    });
    expect(readList('nerv.quickswitcher.pins')).toEqual([]);
  });

  it('고정한 것이 최근 방문보다 위에 선다 — 그러라고 고정하는 것이다', async () => {
    // 최근 목록에서는 daily 가 아래다(older 를 나중에 방문했으므로)
    rememberVisit(daily);
    rememberVisit(older);
    serverPins = [serverPin('SPC-DAILY', '매일 여는 것')];

    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const dialog = await screen.findByTestId('quick-switcher');

    await waitFor(() => {
      const titles = [...dialog.querySelectorAll('[role="option"]')].map(
        (o) => o.textContent ?? '',
      );
      expect(titles[0]).toContain('매일 여는 것');
      expect(titles[1]).toContain('오래된 것');
    });
  });

  it('한 번 더 누르면 풀린다 — 켜는 길과 끄는 길이 같은 자리다', async () => {
    rememberVisit(daily);
    serverPins = [serverPin('SPC-DAILY', '매일 여는 것')];
    renderApp();
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');

    await waitFor(() =>
      expect(screen.getByTestId('switcher-pin-SPC-DAILY').getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
    fireEvent.click(screen.getByTestId('switcher-pin-SPC-DAILY'));
    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/me/pins/pin-SPC-DAILY',
        body: undefined,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('switcher-pin-SPC-DAILY').getAttribute('aria-pressed')).toBe(
        'false',
      ),
    );
  });

  it('브라우저에 남은 옛 핀은 처음 한 번 서버로 옮기고, 응답을 받은 뒤에 지운다', async () => {
    localStorage.setItem(
      'nerv.quickswitcher.pins',
      JSON.stringify([
        { ...daily, kind: 'spec', org_slug: 'default' },
        { ...older, kind: 'requirement', anchor: 'REQ-OLD-001' },
        // 프로젝트를 모르는 옛 기록은 갈 곳을 몰라 원래도 보이지 않았다 — 옮기지 않는다
        { key: 'OLD-1', title: '옛 기록', type: 'feature', doc_status: null, anchor: null },
      ]),
    );
    renderApp();
    await screen.findByText('NERV');
    await waitFor(() => expect(readList('nerv.quickswitcher.pins')).toEqual([]));
    const imported = calls.filter((c) => c.path === '/me/pins/import');
    expect(imported).toHaveLength(1);
    expect(imported[0]!.body).toEqual({
      items: [
        { project: 'clemvion', org: 'default', target_type: 'spec', target: 'SPC-DAILY' },
        { project: 'clemvion', target_type: 'spec', target: 'SPC-OLD' },
      ],
    });
  });

  it('옮기지 못하면 지우지 않는다 — 잃지 않게', async () => {
    localStorage.setItem('nerv.quickswitcher.pins', JSON.stringify([{ ...daily, kind: 'spec' }]));
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).includes('/me/pins/import')) throw new TypeError('network down');
        return (original as typeof fetch)(url as string, init);
      }),
    );
    renderApp();
    await screen.findByText('NERV');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readList('nerv.quickswitcher.pins').map((h) => h.key)).toEqual(['SPC-DAILY']);
  });
});

/**
 * **명령 무리**(2026-09-28 · REQ-WEB-266). 가는 곳이 아니라 하는 일이다 — 언어·테마를 바꾸려면
 * 사용자 메뉴를 열어야 했고, 새 스펙을 시작하는 명령은 빈 트리의 시작 카드에만 있었다.
 */
describe('명령 무리 (REQ-WEB-266)', () => {
  function stubRoles(roles: string[]): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        const path = String(url);
        const json = path.includes('/me')
          ? {
              id: 'u-1',
              display_name: '지민',
              memberships: [
                { org_slug: 'default', org_name: 'default', project_slug: 'clemvion', roles },
              ],
            }
          : { items: [], summary: {}, memberships: [], count: 0 };
        return { ok: true, status: 200, json: async () => json };
      }),
    );
  }

  function renderApp(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/p/clemvion/tasks'] }),
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider client={client}>
          <RealtimeProvider>
            <RouterProvider router={router} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  }

  const input = (): HTMLElement =>
    within(screen.getByTestId('quick-switcher')).getByRole('combobox');

  async function openSwitcher(): Promise<void> {
    await screen.findByText('NERV');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');
  }

  afterEach(() => {
    resetThemeForTesting();
    localStorage.clear();
  });

  it('초안을 쓸 수 있는 사람은 새 스펙 시작 명령을 복사한다', async () => {
    stubRoles(['designer']);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp();
    await openSwitcher();
    const option = await screen.findByText('새 스펙 시작 명령 복사');
    fireEvent.click(option);
    expect(writeText).toHaveBeenCalledWith('claude "/nerv:spec new"');
    // 명령은 창을 닫는다 — 어디로 가지 않는다
    expect(screen.queryByTestId('quick-switcher')).toBeNull();
  });

  it('viewer 에게는 새 스펙 명령이 없다 — 할 수 없는 일을 내밀지 않는다', async () => {
    stubRoles(['viewer']);
    renderApp();
    await openSwitcher();
    await waitFor(() => expect(screen.getByTestId('switcher-group-commands')).toBeTruthy());
    expect(screen.queryByText('새 스펙 시작 명령 복사')).toBeNull();
  });

  it('치면 거르고 Enter 로 테마를 바꾼다 — 지금 테마는 보이지 않는다', async () => {
    stubRoles(['viewer']);
    renderApp();
    await openSwitcher();
    fireEvent.change(input(), { target: { value: '테마' } });
    const group = await screen.findByTestId('switcher-group-commands');
    // 기본은 시스템이다 — 고를 것은 밝게·어둡게 둘이다
    expect(group.textContent).toContain('테마: 어둡게');
    expect(group.textContent).not.toContain('테마: 시스템');
    fireEvent.change(input(), { target: { value: '어둡게' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('언어를 바꾸면 화면 말이 바로 바뀐다', async () => {
    stubRoles(['viewer']);
    renderApp();
    await openSwitcher();
    fireEvent.click(await screen.findByText('언어: English'));
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});
