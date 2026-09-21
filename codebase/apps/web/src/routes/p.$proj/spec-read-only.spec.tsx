// S3 본문 — 웹은 읽는다 (screens.md §2.4·§3.1 개정 · REQ-WEB-173 · 2026-09-22 사람 결정)
//
// "웹에서 본문 편집 기능은 제거 (무조건 에이전트로)". 이 파일이 지키는 것은 둘이다.
//
//   ① **없어진 것이 실제로 없다.** 저장·다음 버전 시작·새 스펙·리스 배너·충돌 대화·왕복
//      경고 — 전부 편집 경로의 것이고, 하나라도 남아 있으면 그것이 곧 막다른 길이다
//      (누를 수는 있는데 아무 일도 일어나지 않거나, 일어나면 안 되는 일이 일어난다).
//   ② **대신 갈 곳을 말한다.** 고칠 곳을 못 찾는 화면은 §1.5 가 금지하는 그 자리다.
//
// 그리고 보는 방식은 **탭이고 주소가 진실이다** — 예전에는 읽는 면과 고치는 면이 같은
// 편집기였고 둘을 가르는 것이 "이 문서가 초안인가" 였다(그 혼동이 초안의 mermaid 가
// 코드로 보이던 결함을 만들었다 · REQ-WEB-169).

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

const BODY = '# 웹챗 위젯\n\n본문 한 줄.\n';

/** 초안이다 — 예전에는 이 상태가 곧 "편집 가능" 이었다(`docStatus === 'draft'`) */
const SPEC = {
  id: 's-1',
  key: 'SPC-CWC-007',
  title: '웹챗 위젯',
  project_id: 'p-1',
  type: 'feature',
  doc_status: 'draft',
  version_id: 'v-1',
  version_no: 2,
  body_md: BODY,
  content_hash: 'h1',
};

let calls: { path: string; method: string }[] = [];

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      const path = String(url);
      calls.push({ path, method: init?.method ?? 'GET' });
      const json = path.includes('/relations')
        ? { items: [] }
        : path.includes('/specs/SPC-CWC-007')
          ? SPEC
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
                      roles: ['admin'],
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

async function renderAt(path = '/p/clemvion/specs/SPC-CWC-007'): Promise<void> {
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
  await waitFor(() => expect(screen.getByTestId('spec-title')).toBeTruthy());
}

describe('① 편집 경로가 없다', () => {
  it('admin 이 초안을 열어도 본문은 고칠 수 있는 면이 아니다', async () => {
    await renderAt();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    const surface = screen.getByTestId('editor-content').querySelector('.ProseMirror');
    // 예전에는 `docStatus === 'draft'` 하나로 편집 가능이었다 — 역할도 보지 않았다
    expect(surface?.getAttribute('contenteditable')).toBe('false');
  });

  it('저장·다음 버전 시작·리스·충돌·왕복 경고가 화면에 없다', async () => {
    await renderAt();
    for (const id of [
      'start-draft',
      'lease-badge',
      'lease-banner',
      'changed-by-others',
      'conflict-dialog',
      'roundtrip-error',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
  });

  it('본문을 쓰는 요청이 한 번도 나가지 않는다', async () => {
    await renderAt();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    // 자동 저장(리스 갱신)이 살아 있으면 여기서 PUT 이 잡힌다
    expect(calls.some((c) => c.method === 'PUT' && c.path.includes('/draft'))).toBe(false);
  });
});

describe('② 갈 곳을 말한다', () => {
  it('본문은 에이전트가 쓴다고 적고, 터미널 명령을 같은 화면에 둔다', async () => {
    await renderAt();
    expect(screen.getByTestId('body-read-only').textContent).toContain('에이전트');
    // 레일 바닥의 카드가 그 명령이다 — 말만 하고 길을 안 주면 §1.5 가 막은 그 자리다
    await waitFor(() => expect(screen.getByTestId('handoff-command')).toBeTruthy());
  });
});

describe('③ 보는 방식은 탭이고 주소가 진실이다', () => {
  it('기본은 뷰어 — 주소에 뜻 없는 인자를 남기지 않는다', async () => {
    await renderAt();
    expect(screen.getByTestId('body-tab-viewer').getAttribute('aria-selected')).toBe('true');
    expect(window.location.search).not.toContain('body=');
  });

  it('소스 탭은 원문 md 를 그대로 보이고 주소에 남는다', async () => {
    await renderAt();
    fireEvent.click(screen.getByTestId('body-tab-source'));

    await waitFor(() => expect(screen.getByTestId('source-view')).toBeTruthy());
    expect(screen.getByTestId('source-view').textContent).toContain('# 웹챗 위젯');
    expect(screen.getByTestId('body-tab-source').getAttribute('aria-selected')).toBe('true');
  });

  it('`?body=source` 로 들어오면 소스가 선 채로 열린다 — 그 화면을 그대로 넘겨줄 수 있다', async () => {
    await renderAt('/p/clemvion/specs/SPC-CWC-007?body=source');
    await waitFor(() => expect(screen.getByTestId('source-view')).toBeTruthy());
  });
});

describe('④ 소스는 가져갈 수 있어야 한다', () => {
  it('복사 단추가 원문 전체를 클립보드에 넣는다', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderAt('/p/clemvion/specs/SPC-CWC-007?body=source');
    await waitFor(() => expect(screen.getByTestId('source-view')).toBeTruthy());

    fireEvent.click(screen.getByTestId('source-copy'));
    // 드래그로 긁으면 줄바꿈과 들여쓰기가 섞인다 — 본문은 md 라 그 차이가 그대로 뜻이다
    expect(writeText).toHaveBeenCalledWith(BODY);
  });
});
