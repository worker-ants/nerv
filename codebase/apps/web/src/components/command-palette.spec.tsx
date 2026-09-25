// ⌘K 명령 팔레트 — 화면·프로젝트·문서로 간다 — REQ-WEB-223 (2026-09-25 · UI/UX 검토 P11a)
//
// 헤더에 입력창처럼 늘 서 있는 "검색 ⌘K" 는 한 프로젝트의 스펙·작업 키만 찾았다 — 홈·받은 요청에서 열면
// "프로젝트를 고르라" 고만 했고 "받은 요청"·"토큰"·다른 프로젝트 이름을 쳐도 아무것도 나오지 않았다(NAV-11).
// 최근·고정 목록은 어느 프로젝트의 것인지 잊어 엉뚱한 프로젝트 경로로 열리거나 아무 일도 하지 않았다(NAV-04).
// 목록은 listbox 가 아니었고, Tab 이 뒤의 페이지로 샜으며, 닫아도 포커스가 돌아오지 않았다(NAV-12).

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { routeTree } from '../routeTree.gen';
import { readList, rememberVisit, togglePin } from './quick-switcher.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

type Row = Record<string, unknown>;

let searchHits: Row[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  searchHits = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            { org_slug: 'default', org_name: 'Default', project_slug: null, roles: ['admin'] },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([
          { id: 'p-1', slug: 'clemvion', name: 'Clemvion' },
          { id: 'p-2', slug: 'sudoku', name: 'Sudoku' },
        ]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'Clemvion' });
      if (path.endsWith('/specs/search')) return ok({ items: searchHits });
      if (path === '/projects/clemvion/specs/SPC-X') {
        return ok({
          spec_id: 's-1',
          key: 'SPC-X',
          title: '위젯 상태',
          type: 'feature',
          version_id: 'v-1',
          version_no: 1,
          doc_status: 'draft',
          body_md: '# 위젯 상태\n\n본문',
          requirements: [],
          recheck: { count: 0, specs: [] },
        });
      }
      return ok({ items: [], next_cursor: null, total: 0, memberships: [], count: 0, summary: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): ReturnType<typeof createMemoryHistory> {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history });
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
  return history;
}

async function openPalette(): Promise<HTMLElement> {
  await screen.findByText('NERV');
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  return screen.findByTestId('quick-switcher');
}

/** 팔레트의 입력 — 보드의 `<select>` 도 combobox 라 팔레트 안에서 찾는다 */
const input = (): HTMLInputElement =>
  within(screen.getByTestId('quick-switcher')).getByRole('combobox') as HTMLInputElement;
const type = (text: string): void => {
  fireEvent.change(input(), { target: { value: text } });
};

describe('프로젝트 밖에서도 화면·프로젝트로 간다 (NAV-11)', () => {
  it('받은 요청에서 "토큰" 을 치면 설정의 토큰 탭으로 간다', async () => {
    const history = renderAt('/inbox');
    await openPalette();
    type('토큰');
    const options = await within(screen.getByTestId('quick-switcher')).findAllByRole('option');
    expect(options[0]!.textContent).toContain('에이전트 토큰');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(history.location.pathname).toBe('/settings/tokens'));
  });

  it('다른 프로젝트 이름을 치면 그 프로젝트로 간다', async () => {
    const history = renderAt('/inbox');
    const palette = await openPalette();
    type('sudoku');
    // 사이드바의 프로젝트 목록에도 같은 이름이 있다 — 창 안의 것을 누른다
    fireEvent.click(await within(palette).findByText('Sudoku'));
    await waitFor(() => expect(history.location.pathname).toBe('/p/sudoku'));
  });

  it('빈 입력이면 이동·프로젝트 무리가 선다 — "고르라" 고만 하지 않는다', async () => {
    renderAt('/inbox');
    const palette = await openPalette();
    expect(within(palette).getByTestId('switcher-group-go')).toBeDefined();
    await waitFor(() =>
      expect(within(palette).getByTestId('switcher-group-projects')).toBeDefined(),
    );
  });

  it('프로젝트 안이면 그 프로젝트의 화면 무리가 먼저다', async () => {
    const history = renderAt('/p/clemvion/tasks');
    await openPalette();
    type('리뷰');
    await waitFor(() =>
      expect(
        within(screen.getByTestId('quick-switcher')).getAllByRole('option')[0]!.textContent,
      ).toContain('리뷰'),
    );
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/reviews'));
  });
});

describe('최근·고정은 어느 프로젝트의 것인지 안다 (NAV-04)', () => {
  const hit = (key: string, project: string): Parameters<typeof rememberVisit>[0] => ({
    key,
    title: `문서 ${key}`,
    type: 'feature',
    doc_status: 'approved',
    anchor: null,
    kind: 'spec',
    project_slug: project,
    project_name: project,
    org_slug: 'default',
  });

  it('다른 프로젝트에서 고정한 문서는 그 프로젝트로 연다', async () => {
    togglePin(hit('SUD-A', 'sudoku'));
    const history = renderAt('/p/clemvion/tasks');
    await openPalette();
    fireEvent.click(await screen.findByText('문서 SUD-A'));
    await waitFor(() => expect(history.location.pathname).toBe('/p/sudoku/specs/SUD-A'));
  });

  it('홈에서 눌러도 간다 — 창만 닫히지 않는다', async () => {
    rememberVisit(hit('SPC-X', 'clemvion'));
    const history = renderAt('/');
    await openPalette();
    fireEvent.click(await screen.findByText('문서 SPC-X'));
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/specs/SPC-X'));
  });

  it('프로젝트를 모르는 옛 기록과 다른 조직의 기록은 보이지 않는다', async () => {
    rememberVisit({
      key: 'OLD-1',
      title: '옛 기록',
      type: 'feature',
      doc_status: null,
      anchor: null,
    });
    rememberVisit({ ...hit('ORG-2', 'other'), org_slug: 'other-org' });
    renderAt('/inbox');
    await openPalette();
    expect(screen.queryByText('옛 기록')).toBeNull();
    expect(screen.queryByText('문서 ORG-2')).toBeNull();
  });

  it('요구사항은 요구사항 탭으로, 헤딩 앵커는 그 절로 간다', async () => {
    searchHits = [
      {
        key: 'SPC-X',
        title: '요구사항 줄',
        type: 'feature',
        doc_status: null,
        anchor: 'REQ-X-1',
        kind: 'requirement',
      },
      {
        key: 'SPC-X',
        title: '헤딩 줄',
        type: 'feature',
        doc_status: null,
        anchor: '개요',
        kind: 'spec',
      },
    ];
    const history = renderAt('/p/clemvion/tasks');
    await openPalette();
    type('SPC');
    fireEvent.click(await screen.findByText('요구사항 줄'));
    await waitFor(() => expect(history.location.search).toContain('rail=requirements'));
    // 고른 것은 그 프로젝트의 기록이 된다
    expect(readList('nerv.quickswitcher.recent')[0]).toMatchObject({
      key: 'SPC-X',
      project_slug: 'clemvion',
    });

    await openPalette();
    type('SPC');
    fireEvent.click(await screen.findByText('헤딩 줄'));
    await waitFor(() =>
      expect(decodeURIComponent(history.location.hash.replace(/^#/, ''))).toBe('개요'),
    );
  });

  it('스펙 상세를 열면 그것이 최근에 남는다 — ⌘K 로 고른 것만이 아니다', async () => {
    renderAt('/p/clemvion/specs/SPC-X');
    await waitFor(() =>
      expect(readList('nerv.quickswitcher.recent')[0]).toMatchObject({
        key: 'SPC-X',
        title: '위젯 상태',
        project_slug: 'clemvion',
      }),
    );
  });
});

describe('키보드와 보조기기 (NAV-12)', () => {
  it('입력은 combobox, 목록은 listbox — 고른 줄을 activedescendant 로 가리킨다', async () => {
    renderAt('/inbox');
    await openPalette();
    const box = input();
    expect(screen.getByRole('listbox')).toBeDefined();
    const first = box.getAttribute('aria-activedescendant');
    expect(document.getElementById(first!)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    await waitFor(() => expect(box.getAttribute('aria-activedescendant')).not.toBe(first));
    expect(
      document
        .getElementById(box.getAttribute('aria-activedescendant')!)
        ?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('닫으면 연 자리로 포커스가 돌아가고, 고정 단추에서도 Esc 가 닫는다', async () => {
    rememberVisit({
      key: 'SPC-X',
      title: '문서 SPC-X',
      type: 'feature',
      doc_status: null,
      anchor: null,
      project_slug: 'clemvion',
    });
    renderAt('/inbox');
    await screen.findByText('NERV');
    const opener = screen.getByRole('button', { name: '검색' });
    opener.focus();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByTestId('quick-switcher');
    const pin = await screen.findByTestId('switcher-pin-SPC-X');
    pin.focus();
    fireEvent.keyDown(pin, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('quick-switcher')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('Tab 은 대화상자 안을 돈다 — 뒤의 페이지로 새지 않는다', async () => {
    rememberVisit({
      key: 'SPC-X',
      title: '문서 SPC-X',
      type: 'feature',
      doc_status: null,
      anchor: null,
      project_slug: 'clemvion',
    });
    renderAt('/inbox');
    await openPalette();
    const pin = await screen.findByTestId('switcher-pin-SPC-X');
    pin.focus();
    fireEvent.keyDown(pin, { key: 'Tab' });
    expect(document.activeElement).toBe(input());
  });
});
