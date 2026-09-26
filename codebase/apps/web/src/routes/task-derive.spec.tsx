// 승인된 SpecVersion 에서 Task 를 파생하는 웹 경로 — E08-S05 · REQ-WEB-016 · REQ-WEB-147
//
// 백로그는 이 경로가 "없다" 고 적고 있었다(2026-09-06 실측 — 폼 스키마에 출처가 없었다).
// 2026-09-07 에 들어왔는데 **지키는 검사가 없어** 백로그도 고쳐지지 않았다. 없는 줄 알던
// 기능은 없어져도 아무도 모른다 — 여기서 두 수용 기준을 못 박는다.
//   ① 스펙 상세의 "이 버전에서 파생" 이 보낸 주소가 폼의 출처가 되고, 저장이 그것을 싣는다
//   ② 4요소가 비면 폼이 누락을 말하고 **요청을 보내지 않는다**

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** 작업 생성 요청의 본문 — 검사 대상이다 */
let created: Record<string, unknown>[] = [];

beforeEach(() => {
  created = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && /\/projects\/[^/]+\/tasks$/.test(u)) {
        created.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return {
          ok: true,
          status: 201,
          json: async () => ({ key: 'CLV-T-1', status: 'ready' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'p1', items: [], memberships: [], count: 0, summary: {} }),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function renderAt(path: string): Promise<HTMLFormElement> {
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
  return (await screen.findByTestId('delegation-form')) as HTMLFormElement;
}

const DERIVE = '/p/clemvion/tasks?from_spec=auth-login&from_version=sv-3&from_version_no=3';

function fill(form: HTMLFormElement, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const el = form.querySelector(`[name="${name}"]`);
    fireEvent.change(el!, { target: { value } });
  }
}

describe('승인본에서 파생 (E08-S05)', () => {
  it('스펙 상세가 보낸 주소가 폼의 출처다 — 피커 대신 고정 표기', async () => {
    await renderAt(DERIVE);
    expect(screen.getByTestId('source-locked').textContent).toBe('auth-login v3 에서 만듭니다');
    expect(screen.queryByTestId('source-spec')).toBeNull();
  });

  it('저장이 그 버전을 싣는다 — 가치 사슬의 첫 고리', async () => {
    const form = await renderAt(DERIVE);
    fill(form, {
      title: '로그인 실패 문구',
      goal_md: '실패 사유를 인라인으로',
      output_format_md: 'PR',
      tools_sources_md: 'screens.md §2.1',
      boundaries_md: 'apps/web/src/routes/login.tsx 만',
    });
    fireEvent.submit(form);
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.['source_spec_version_id']).toBe('sv-3');
  });
});

describe('4요소가 비면 막는다 (REQ-WEB-016)', () => {
  it('누락을 필드마다 말하고 요청을 보내지 않는다', async () => {
    const form = await renderAt(DERIVE);
    fill(form, { title: '제목만 있다', goal_md: '목표도 있다' });
    fireEvent.submit(form);
    await screen.findByText('산출물 형식을 적어주세요(예: PR).');
    expect(screen.getByText('쓸 도구·참고할 출처를 적어주세요.')).toBeDefined();
    expect(screen.getByText('건드리면 안 되는 범위를 적어주세요.')).toBeDefined();
    expect(created).toHaveLength(0);
  });

  it('공백만으로는 채워지지 않는다 — 형식적 충족을 막는 최소선', async () => {
    const form = await renderAt(DERIVE);
    fill(form, {
      title: '제목',
      goal_md: '   ',
      output_format_md: 'PR',
      tools_sources_md: '출처',
      boundaries_md: '범위',
    });
    fireEvent.submit(form);
    await screen.findByText('목표를 적어주세요.');
    expect(created).toHaveLength(0);
  });
});
