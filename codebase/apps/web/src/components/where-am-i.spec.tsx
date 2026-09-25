// 깊은 화면에서 "지금 어디인가" (2026-09-25 — 사람 결정 D1 · UI/UX 검토 NAV-13 · REQ-WEB-228)
//
// 탭 제목과 헤더는 셸이 경로만 보고 정해서, 스펙 세 편을 탭으로 열어 두면 셋 다 "스펙 · clemvion · default"
// 였고 헤더도 "스펙" 에서 멈췄다. 스펙 상세 머리는 상태·키·타입·버전만 말하고 트리의 어디인지 말하지 않았다 —
// 좁은 화면에서는 트리 열이 띠 뒤에 접혀 위치를 알 길이 없었다.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@nerv/schema';
import { LocaleProvider } from '../lib/i18n.js';
import { RealtimeProvider } from '../lib/realtime.js';
import { documentTitle } from '../lib/document-title.js';
import { routeTree } from '../routeTree.gen';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

const NODES = [
  {
    id: 'r',
    key: 'SPC-R',
    title: '채널',
    type: 'area',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'a',
    key: 'SPC-A',
    title: '웹챗',
    type: 'area',
    parent_id: 'r',
    doc_status: 'approved',
    version_no: 1,
  },
  {
    id: 'b',
    key: 'SPC-B',
    title: '위젯 임베드',
    type: 'feature',
    parent_id: 'a',
    doc_status: 'approved',
    version_no: 1,
  },
];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/specs/tree')) return ok(NODES);
      const spec = /\/projects\/demo\/specs\/(SPC-[A-Z]+)(?:\?|$)/.exec(u);
      if (spec !== null) {
        const node = NODES.find((n) => n.key === spec[1]);
        // 실제 서버처럼 `project_id` 를 싣지 않는다(EP-SPEC-03) — 이 값에 기대던 화면이 조용히 비어 있었다
        return ok({
          ...node,
          doc_status: 'approved',
          version_no: 1,
          versions: [],
          body_md: '',
        });
      }
      if (/\/projects\/demo\/tasks\/DEMO-T-1/.test(u))
        return ok({
          id: 't-1',
          key: 'DEMO-T-1',
          title: '세션 복원',
          status: 'ready',
          evidence: [],
          claims: [],
          dependencies: [],
          reviews: [],
        });
      if (/\/projects\/demo\/tasks\?/.test(u)) return ok({ items: [], next_cursor: null });
      if (/\/orgs\/[^/]+\/projects/.test(u)) return ok([{ id: 'p-1', slug: 'demo', name: 'Demo' }]);
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function mount(path: string) {
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
  return router;
}

const t = createTranslator('ko');
const scope = { orgName: 'NERV', projectName: 'Demo' };

describe('탭 제목의 상세 조각 (REQ-WEB-228 · REQ-WEB-194 개정)', () => {
  it('상세가 맨 앞이고 조직은 그대로 끝이다', () => {
    expect(
      documentTitle(t, '/p/demo/specs/SPC-B', scope, { key: 'SPC-B', title: '위젯 임베드' }),
    ).toBe('SPC-B 위젯 임베드 · 스펙 · Demo · NERV — NERV');
  });

  it('제목을 아직 모르면 키만 — 키와 같은 제목은 한 번만', () => {
    expect(documentTitle(t, '/p/demo/tasks/DEMO-T-1', scope, { key: 'DEMO-T-1' })).toBe(
      'DEMO-T-1 · 작업 · Demo · NERV — NERV',
    );
    expect(documentTitle(t, '/p/demo/specs/X', scope, { key: 'X', title: 'X' })).toBe(
      'X · 스펙 · Demo · NERV — NERV',
    );
  });

  it('상세 주소가 아니면 싣지 않는다 — 비우지 못한 조각이 목록의 제목을 바꾸지 않게', () => {
    expect(documentTitle(t, '/p/demo/specs', scope, { key: 'SPC-B', title: '위젯 임베드' })).toBe(
      '스펙 · Demo · NERV — NERV',
    );
  });
});

describe('셸이 상세를 말한다 — 탭 제목 · 헤더 끝', () => {
  it('스펙 상세 — 탭은 그 문서의 키와 제목, 헤더 끝은 키이고 화면 이름은 목록으로 가는 길이다', async () => {
    mount('/p/demo/specs/SPC-B');
    await waitFor(() =>
      expect(document.title).toBe('SPC-B 위젯 임베드 · 스펙 · Demo · NERV — NERV'),
    );
    const crumbs = screen.getByRole('navigation', { name: '지금 위치' });
    const here = within(crumbs).getByTestId('crumb-detail');
    expect(here.textContent).toBe('SPC-B');
    expect(here.getAttribute('aria-current')).toBe('page');
    const list = within(crumbs).getByTestId('crumb-screen');
    expect(list.tagName).toBe('A');
    expect(list.getAttribute('href')).toBe('/p/demo/specs');
    expect(list.getAttribute('aria-current')).toBeNull();
  });

  it('떠나면 비운다 — 목록으로 돌아오면 탭도 헤더도 목록의 것이다', async () => {
    const router = mount('/p/demo/specs/SPC-B');
    await waitFor(() => expect(document.title).toContain('SPC-B'));
    await act(() => router.navigate({ to: '/p/$proj/specs', params: { proj: 'demo' } }));
    await waitFor(() => expect(document.title).toBe('스펙 · Demo · NERV — NERV'));
    expect(screen.queryByTestId('crumb-detail')).toBeNull();
    expect(screen.getByTestId('crumb-screen').getAttribute('aria-current')).toBe('page');
  });

  it('작업 상세도 같다', async () => {
    mount('/p/demo/tasks/DEMO-T-1');
    await waitFor(() =>
      expect(document.title).toBe('DEMO-T-1 세션 복원 · 작업 · Demo · NERV — NERV'),
    );
    expect(screen.getByTestId('crumb-screen').getAttribute('href')).toBe('/p/demo/tasks');
  });
});

describe('상세의 프로젝트 축 — 문서 응답에는 project_id 가 없다 (2026-09-25 실측)', () => {
  it('요구사항 탭의 파생 작업이 그 문서로 거른 목록을 부른다 — 예전에는 한 번도 부르지 않았다', async () => {
    mount('/p/demo/specs/SPC-B?rail=requirements');
    await waitFor(() =>
      expect(
        (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([url]) =>
          /\/projects\/demo\/tasks\?.*spec=SPC-B/.test(String(url)),
        ),
      ).toBe(true),
    );
  });
});

describe('스펙 상세의 상위 경로 (NAV-13 ②)', () => {
  it('뿌리부터 부모까지 — 조상마다 그 문서로 가는 링크다', async () => {
    mount('/p/demo/specs/SPC-B');
    const path = await screen.findByTestId('spec-ancestors');
    expect(path.getAttribute('aria-label')).toBe('상위 문서');
    const links = within(path).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['채널', '웹챗']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/p/demo/specs/SPC-R',
      '/p/demo/specs/SPC-A',
    ]);
  });

  it('뿌리 문서에는 서지 않는다', async () => {
    mount('/p/demo/specs/SPC-R');
    await waitFor(() => expect(document.title).toContain('SPC-R'));
    await screen.findByTestId('spec-title');
    expect(screen.queryByTestId('spec-ancestors')).toBeNull();
  });
});
