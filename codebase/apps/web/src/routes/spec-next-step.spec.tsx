// 보는 버전 하나 · 다음 할 일 한 줄 — REQ-WEB-214 · REQ-API-182 (2026-09-24 · UI/UX 검토 P09a)
//
// `?v=4` 로 초안을 열어도 머리의 배지·버전·사전 검토·[검토 요청]·코멘트는 승인본(v3)을 가리켰고,
// [검토 요청]은 본문 맨 끝에 이유 없이 잠겨 있었다. 승인본을 보는 사람은 새 초안이 있다는 것을
// 몰랐고, 검토 중인 문서를 연 사람은 결재가 어디서 기다리는지 몰랐다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

type Row = Record<string, unknown>;

const BASE: Row = {
  spec_id: 's-1',
  key: 'SPC-X',
  title: '위젯 상태',
  type: 'feature',
  project_id: 'p-1',
  body_md: '# 위젯 상태\n\n본문',
  requirements: [],
  recheck: { count: 0, specs: [] },
};

const APPROVED: Row = {
  ...BASE,
  version_id: 'v-3',
  version_no: 3,
  doc_status: 'approved',
  approved_by_name: '서연',
  approved_at: '2026-09-22T00:00:00Z',
  pending_approval_id: null,
};

let v4: Row;
let checkVerdict: Row;
let posted: string[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  posted = [];
  v4 = {
    ...BASE,
    version_id: 'v-4',
    version_no: 4,
    doc_status: 'in_review',
    pending_approval_id: 'ap-9',
  };
  checkVerdict = { verdict: 'warning', findings: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const u = String(url).replace(/^.*\/api\/v1/, '');
      const path = u.split('?')[0]!;
      if (init?.method === 'POST') {
        posted.push(path);
        return ok({ status: 'in_review', approval_id: 'ap-10', web_url: '/inbox?focus=ap-10' });
      }
      if (path === '/me') {
        return ok({
          id: 'u-1',
          display_name: '지민',
          memberships: [
            {
              org_slug: 'default',
              org_name: 'Default',
              project_slug: 'clemvion',
              roles: ['planner'],
            },
          ],
        });
      }
      if (/^\/orgs\/[^/]+\/projects$/.test(path)) {
        return ok([{ id: 'p-1', slug: 'clemvion', name: 'clemvion' }]);
      }
      if (path === '/projects/clemvion')
        return ok({ id: 'p-1', slug: 'clemvion', name: 'clemvion' });
      if (path.endsWith('/check')) return ok(checkVerdict);
      if (path.endsWith('/versions')) {
        return ok({
          items: [
            { id: 'v-4', version_no: 4, status: String(v4['doc_status']) },
            { id: 'v-3', version_no: 3, status: 'approved' },
          ],
          total: 2,
        });
      }
      if (path.endsWith('/comments')) {
        return ok({
          items: [
            { id: 'c-1', status: 'open', anchor: 'intro', body_md: '이것' },
            { id: 'c-2', status: 'open', anchor: 'intro', body_md: '저것' },
            { id: 'c-3', status: 'resolved', anchor: 'intro', body_md: '끝' },
          ],
        });
      }
      if (path === '/projects/clemvion/specs/SPC-X') return ok(u.includes('v=4') ? v4 : APPROVED);
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

const params = (history: ReturnType<typeof createMemoryHistory>): URLSearchParams =>
  new URLSearchParams(history.location.search);

describe('보는 버전이 머리·다음 할 일을 정한다', () => {
  it('?v=4 로 열면 머리의 배지와 버전이 v4 의 것이고, 검토 중이면 받은 요청의 그 카드로 간다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?v=4');
    const next = await screen.findByTestId('spec-next');
    await waitFor(() => expect(next.getAttribute('data-status')).toBe('in_review'));
    expect(screen.getByTestId('spec-version').textContent).toBe('v4');
    expect(within(next).getByTestId('spec-next-inbox').getAttribute('href')).toBe(
      '/inbox?focus=ap-9',
    );
  });

  it('승인본이면 [작업 만들기]가 그 버전에서 파생하는 폼을 연다', async () => {
    renderAt('/p/clemvion/specs/SPC-X');
    const next = await screen.findByTestId('spec-next');
    await waitFor(() => expect(next.getAttribute('data-status')).toBe('approved'));
    const href = within(next).getByTestId('spec-next-derive').getAttribute('href') ?? '';
    expect(href.startsWith('/p/clemvion/tasks?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('from_spec')).toBe('SPC-X');
    expect(q.get('from_version')).toBe('v-3');
  });

  it('승인본을 보는데 더 새 초안이 있으면 그렇다고 말하고 그리로 데려간다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-X');
    const banner = await screen.findByTestId('spec-newer-version');
    expect(banner.textContent).toContain('v4');
    fireEvent.click(within(banner).getByTestId('spec-newer-open'));
    await waitFor(() => expect(params(history).get('v')).toBe('4'));
    await waitFor(() => expect(screen.getByTestId('spec-version').textContent).toBe('v4'));
  });

  it('`?v=` 가 기본 버전을 가리키면 평소 화면이다 — 지난 버전 보기로 읽지 않는다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?v=3');
    await screen.findByTestId('spec-next');
    expect(screen.queryByTestId('version-view-banner')).toBeNull();
    expect(screen.getByTestId('body-tab-viewer')).toBeTruthy();
  });
});

describe('초안이면 [검토 요청]이 머리에 있다', () => {
  it('보는 초안을 제출하고, 토스트가 받은 요청의 그 카드로 데려간다', async () => {
    v4 = { ...v4, doc_status: 'draft', pending_approval_id: null };
    renderAt('/p/clemvion/specs/SPC-X?v=4');
    const submit = await screen.findByTestId('submit-review');
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    fireEvent.click(await screen.findByTestId('impact-confirm'));
    // **승인본이 아니라 보는 초안**(v-4)을 제출한다 — 예전에는 기본 버전으로 나갔다
    await waitFor(() => expect(posted).toContain('/projects/clemvion/spec-versions/v-4/submit'));
    const toastLink = await screen.findByText(/받은 요청에서 열기/, { selector: 'a' });
    expect(toastLink.getAttribute('href')).toBe('/inbox?focus=ap-10');
  });

  it('사전 검토에 block 이 있으면 잠긴 이유를 곁에서 말한다 — 판정은 번역해 적는다', async () => {
    v4 = { ...v4, doc_status: 'draft', pending_approval_id: null };
    checkVerdict = {
      verdict: 'block',
      findings: [
        { checker: 'requirement-shape', severity: 'block', anchor: 'intro', message: '형식' },
        { checker: 'links', severity: 'block', anchor: null, message: '링크' },
      ],
    };
    renderAt('/p/clemvion/specs/SPC-X?v=4');
    await waitFor(() =>
      expect((screen.getByTestId('submit-review') as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.getByTestId('submit-blocked').textContent).toContain('2건');
    expect(screen.getByTestId('check-findings').textContent).toContain('차단');
    expect(screen.getByTestId('check-findings').textContent).not.toContain('block');
  });
});

describe('곁의 칩과 넘기기', () => {
  it('열린 코멘트 수를 말하고 누르면 코멘트 탭이 열린다 — 해결된 것은 세지 않는다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-X');
    const chip = await screen.findByTestId('spec-next-comments');
    expect(chip.textContent).toContain('2');
    fireEvent.click(chip);
    await waitFor(() => expect(params(history).get('rail')).toBe('comments'));
  });

  it('터미널 명령은 한 벌이다 — 본문 끝의 복사 없는 사본을 걷었고, 설치 장으로 가는 길이 있다', async () => {
    renderAt('/p/clemvion/specs/SPC-X');
    await screen.findByTestId('handoff-command');
    const copies = document.body.textContent?.match(/\/nerv:spec edit SPC-X/g) ?? [];
    expect(copies).toHaveLength(1);
    expect(screen.getByTestId('handoff-install').getAttribute('href')).toBe('/help/install');
  });
});
