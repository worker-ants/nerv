// 트리 스케일과 검토 요청의 영향 미리보기 — E08-S10 · REQ-WEB-044 · screens.md §2.4
//
// 백로그는 이 스토리의 남은 것을 "`depth` 지연 로드" 라고 적고 있었다. 그 요구는 2026-08-29 에
// REQ-WEB-044 에서 **삭제됐다**(EP-SPEC-01 은 전 계층을 한 응답으로 주고, 규모의 부담은 가상
// 스크롤이 진다). 그러면 두 수용 기준이 남는데, 둘 다 **지키는 검사가 없었다.** 여기서 못 박는다.
//   ① 200편을 넘는 트리는 창 밖을 그리지 않는다 — 최초 페인트가 전체 트리 렌더를 요구하지 않는다
//   ② 검토 요청을 누르면 보내기 **전에** 역참조·파생 Task 영향을 보인다

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

/** 가상 분기 임계(200)를 넉넉히 넘는다 */
const MANY = 250;
function flat(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    key: `doc-${i}`,
    title: `문서 ${i}`,
    type: 'feature',
    parent_id: null,
    doc_status: 'approved',
    version_no: 1,
  }));
}
/** 트리 응답 — 검사마다 크기를 갈아 끼운다 */
let nodes = flat(MANY);

let submitted: string[] = [];

const nativeScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  // jsdom 에는 `scrollIntoView` 가 없다 — 상세로 들어오면 트리가 활성 줄로 옮긴다(REQ-WEB-053).
  // 스텁이 없으면 그 호출이 다음 프레임에 던져 **테스트 밖의 처리되지 않은 오류**가 된다.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  submitted = [];
  nodes = flat(MANY);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
      if (init?.method === 'POST' && u.includes('/submit')) {
        submitted.push(u);
        return ok({ status: 'in_review' });
      }
      if (u.includes('/specs/tree')) return ok(nodes);
      if (u.includes('/relations'))
        return ok({
          items: [
            { direction: 'in', key: 'a', title: 'A' },
            { direction: 'in', key: 'b', title: 'B' },
            { direction: 'out', key: 'c', title: 'C' },
          ],
          total: 3,
        });
      if (u.includes('/check')) return ok({ verdict: 'pass', findings: [] });
      if (/\/specs\/doc-7\?/.test(u))
        return ok({
          key: 'doc-7',
          title: '문서 7',
          type: 'feature',
          doc_status: 'draft',
          version_id: 'sv-7',
          version_no: 2,
          body_md: '# 문서 7',
          tasks: [{ key: 'CLV-T-1' }, { key: 'CLV-T-2' }, { key: 'CLV-T-3' }],
        });
      if (/\/projects\/[^/?]+$/.test(u)) return ok({ id: 'p-1', slug: 'demo', name: 'demo' });
      return ok({ items: [], memberships: [], count: 0, summary: {} });
    }),
  );
});
afterEach(() => {
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  vi.unstubAllGlobals();
  cleanup();
});

function renderAt(path: string): void {
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

describe('200편을 넘는 트리 (REQ-WEB-044)', () => {
  it('창 밖은 그리지 않는다 — 그래도 수는 전부를 말한다', async () => {
    renderAt('/p/demo/specs');
    await waitFor(() => expect(screen.getAllByTestId('spec-tree').length).toBe(2));
    // 전수 목록(뒤) — 사이드바(앞)도 같은 분기를 탄다
    const full = screen.getAllByTestId('spec-tree')[1]!;
    await waitFor(() => expect(full.getAttribute('data-virtualized')).toBe('true'));
    const drawn = within(full).getAllByRole('link').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(MANY);
    expect(within(full).getByTestId('tree-count').textContent).toBe(`표시 ${MANY} / 전체 ${MANY}`);
  });

  it('임계 아래는 가상 분기로 가지 않는다 — 작은 프로젝트가 스크롤 상자에 갇히지 않게', async () => {
    nodes = flat(150);
    renderAt('/p/demo/specs');
    await waitFor(() => expect(screen.getAllByTestId('spec-tree').length).toBe(2));
    const full = screen.getAllByTestId('spec-tree')[1]!;
    await within(full).findByText('문서 149');
    expect(full.getAttribute('data-virtualized')).toBe('false');
  });
});

describe('검토 요청 전의 영향 미리보기 (E08-S10)', () => {
  it('누르면 보내기 전에 역참조와 파생 Task 를 센다 — 아직 아무것도 나가지 않았다', async () => {
    renderAt('/p/demo/specs/doc-7');
    const button = await screen.findByTestId('submit-review');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const preview = await screen.findByTestId('impact-preview');
    expect(preview.textContent).toContain('역참조 문서 2건');
    expect(preview.textContent).toContain('파생 Task 3건');
    expect(submitted).toHaveLength(0);
  });

  it('확인해야 나간다', async () => {
    renderAt('/p/demo/specs/doc-7');
    const button = await screen.findByTestId('submit-review');
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    fireEvent.click(await screen.findByTestId('impact-confirm'));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toContain('/spec-versions/sv-7/submit');
  });
});
