// 긴 문서를 읽는다 — REQ-WEB-215 (2026-09-24 · UI/UX 검토 P09b · SPEC-05 · SPEC-X1 · SPEC-X3 · SPEC-14 · OBS-04)
//
// 50,685px 짜리 스펙을 읽는 사람에게 절 사이를 오갈 수단이 스크롤바뿐이었다. `…#3` 링크는 문서 머리에
// 떨어졌고, 사전 검토·코멘트의 앵커는 글자였으며, 본문의 스펙 링크는 앱 전체를 다시 적재했다. 좁은
// 화면에서 레일은 본문 뒤 수십 화면 아래에 있었고, 레일 탭은 보조기기에 탭으로 읽히지 않았다.

import { headingSlug } from '@nerv/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropLeadingTitle, headingIndex, markdownHeadings } from '../lib/spec-anchors.js';
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

const BODY = [
  '# 위젯 상태',
  '',
  '## 개요',
  '',
  '[옆 문서](/p/clemvion/specs/SPC-Y) 와 [바깥](https://example.com/x)',
  '',
  '## 3. 게임플레이',
  '',
  '```md',
  '## 코드 안의 헤딩은 헤딩이 아니다',
  '```',
  '',
  '### 3.1 규칙',
  '',
  '본문',
].join('\n');

let spec: Row;
let checkVerdict: Row;
let scrolled: Element[];

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

beforeEach(() => {
  localStorage.clear();
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  spec = {
    spec_id: 's-1',
    key: 'SPC-X',
    title: '위젯 상태',
    type: 'feature',
    project_id: 'p-1',
    version_id: 'v-1',
    version_no: 1,
    doc_status: 'draft',
    body_md: BODY,
    requirements: [],
    recheck: { count: 0, specs: [] },
  };
  checkVerdict = { verdict: 'warning', findings: [] };
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
      if (path.endsWith('/comments')) {
        return ok({ items: [{ id: 'c-1', status: 'open', anchor: '개요', body_md: '여기' }] });
      }
      if (path === '/projects/clemvion/specs/SPC-X') return ok(spec);
      if (path === '/projects/clemvion/specs/SPC-Y')
        return ok({ ...spec, key: 'SPC-Y', title: '옆' });
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

const headingEls = (): HTMLElement[] =>
  Array.from(
    screen.getByTestId('editor-content').querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
  );

describe('헤딩 규칙 — 서버와 같은 slug, 코드 안은 헤딩이 아니다', () => {
  it('md 의 헤딩을 순서대로 읽는다', () => {
    expect(markdownHeadings(BODY).map((h) => h.text)).toEqual([
      '위젯 상태',
      '개요',
      '3. 게임플레이',
      '3.1 규칙',
    ]);
    expect(markdownHeadings(BODY)[2]!.slug).toBe(headingSlug('3. 게임플레이'));
  });

  it('숫자 앵커는 절 번호다 — `#3` 은 "3." 으로 시작하는 헤딩', () => {
    const headings = markdownHeadings(BODY);
    expect(headingIndex(headings, '3')).toBe(2);
    expect(headingIndex(headings, '§3.1')).toBe(3);
    expect(headingIndex(headings, encodeURIComponent('개요'))).toBe(1);
    expect(headingIndex(headings, '없는-절')).toBe(-1);
  });

  it('본문 첫 줄의 같은 제목은 뷰어에서만 뺀다 — 다르면 그대로', () => {
    expect(dropLeadingTitle(BODY, '위젯 상태').startsWith('\n## 개요')).toBe(true);
    expect(dropLeadingTitle(BODY, '다른 제목')).toBe(BODY);
  });
});

describe('긴 문서를 오간다', () => {
  it('제목이 두 번 서지 않는다 — 뷰어에는 본문의 `# 제목` 이 없고, 소스에는 있다', async () => {
    renderAt('/p/clemvion/specs/SPC-X');
    await waitFor(() => expect(headingEls().length).toBeGreaterThan(0));
    expect(headingEls().map((h) => h.textContent)).not.toContain('위젯 상태');
    fireEvent.click(screen.getByTestId('body-tab-source'));
    expect((await screen.findByTestId('source-view')).textContent).toContain('# 위젯 상태');
  });

  it('목차에서 절을 고르면 그 헤딩으로 가고 주소에 남는다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-X');
    await waitFor(() => expect(headingEls().length).toBe(3));
    fireEvent.click(await screen.findByTestId('spec-toc'));
    fireEvent.click(within(screen.getByTestId('spec-toc-list')).getByText('3. 게임플레이'));
    await waitFor(() =>
      expect(decodeURIComponent(history.location.hash.replace(/^#/, ''))).toBe(
        headingSlug('3. 게임플레이'),
      ),
    );
    expect(scrolled).toContain(headingEls()[1]);
  });

  it('들어오는 `#3` 이 그 절로 데려간다', async () => {
    renderAt('/p/clemvion/specs/SPC-X#3');
    await waitFor(() => expect(headingEls().length).toBe(3));
    await waitFor(() => expect(scrolled).toContain(headingEls()[1]));
  });

  it('코멘트 앵커는 그 헤딩으로 간다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    await waitFor(() => expect(headingEls().length).toBe(3));
    fireEvent.click(await screen.findByTestId('comment-anchor'));
    await waitFor(() => expect(scrolled).toContain(headingEls()[0]));
  });

  it('사전 검토의 앵커는 그 헤딩으로, 요구사항 ref 는 요구사항 탭으로', async () => {
    checkVerdict = {
      verdict: 'warning',
      findings: [
        { checker: 'cross-spec', severity: 'warning', anchor: '3-게임플레이', message: '어긋남' },
        {
          checker: 'requirement-shape',
          severity: 'warning',
          anchor: 'REQ-CWC-001',
          message: '형식',
        },
      ],
    };
    const history = renderAt('/p/clemvion/specs/SPC-X');
    await waitFor(() => expect(headingEls().length).toBe(3));
    const anchors = await screen.findAllByTestId('check-anchor');
    fireEvent.click(anchors[0]!);
    await waitFor(() => expect(scrolled).toContain(headingEls()[1]));
    fireEvent.click(anchors[1]!);
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('rail')).toBe('requirements'),
    );
  });

  it('본문의 앱 링크는 앱 안에서 옮기고, 바깥 링크는 새 탭이다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-X');
    const inner = await screen.findByText('옆 문서');
    expect(screen.getByText('바깥').closest('a')?.getAttribute('target')).toBe('_blank');
    fireEvent.click(inner);
    await waitFor(() => expect(history.location.pathname).toBe('/p/clemvion/specs/SPC-Y'));
  });

  it('소스의 줄은 번호로 가리킨다 — `?body=source#L3`', async () => {
    renderAt('/p/clemvion/specs/SPC-X?body=source#L3');
    await screen.findByTestId('source-view');
    await waitFor(() => expect(scrolled).toContain(document.getElementById('L3')));
    // 번호는 글자가 아니다 — 복사·textContent 에 섞이지 않는다
    expect(screen.getByTestId('source-view').textContent?.startsWith('# 위젯 상태')).toBe(true);
  });
});

describe('레일 — 탭으로 읽히고, 좁으면 그리로 내려 준다', () => {
  it('레일 탭은 tablist 이고 지금 탭을 aria-selected 로 말하며, 화살표로 옮긴다', async () => {
    const history = renderAt('/p/clemvion/specs/SPC-X');
    const list = await screen.findByTestId('rail-tabs');
    expect(list.getAttribute('role')).toBe('tablist');
    const relations = screen.getByTestId('rail-tab-relations');
    expect(relations.getAttribute('role')).toBe('tab');
    expect(relations.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('rail-body').getAttribute('role')).toBe('tabpanel');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(new URLSearchParams(history.location.search).get('rail')).toBe('requirements'),
    );
  });

  it('1열에서 `?rail=` 로 들어오면 레일로 내려 준다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=comments');
    const tabs = await screen.findByTestId('rail-tabs');
    await waitFor(() => expect(scrolled).toContain(tabs.closest('aside')));
  });

  it('한 번도 승인되지 않은 초안의 요구사항 탭은 왜 비었는지와 줄의 형식을 말한다', async () => {
    renderAt('/p/clemvion/specs/SPC-X?rail=requirements');
    const empty = await screen.findByTestId('requirements-empty');
    expect(empty.textContent).toContain('승인된 적이 없습니다');
    expect(empty.textContent).toContain('THE SYSTEM SHALL');
  });
});
