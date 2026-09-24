// 스펙 메타 다이얼로그 — 보관은 한 번 묻고, Esc 로 닫히며, 막힌 이유로 가는 길이 있다
// (screens.md §2.4 "[아카이브…] 확인" · REQ-WEB-200 · 2026-09-24 UI/UX 검토 SPEC-11)

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NERV_ERROR } from '@nerv/schema';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { MetaDialog } from './meta-dialog.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderDialog(reply: { status: number; body: unknown }): {
  onClose: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  const onClose = vi.fn();
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    // 쓰기만 센다 — 실시간 공급자가 부르는 읽기는 이 검사의 것이 아니다
    if ((init?.method ?? 'GET') !== 'GET') {
      calls.push(`${init?.method ?? 'GET'} ${String(url).replace(/^.*\/api\/v1/, '')}`);
    }
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  // 막힌 이유가 링크라 라우터 안에서 그린다
  const root = createRootRoute({
    component: () => (
      <MetaDialog
        projectSlug="clemvion"
        projectId={undefined}
        specKey="SPC-A"
        title="문서"
        canEdit
        onClose={onClose}
      />
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={new QueryClient()}>
        <RealtimeProvider>
          <RouterProvider router={router as never} />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return { onClose, calls };
}

describe('스펙 메타 — 보관', () => {
  it('확인 전에는 보관하지 않는다 — 되살리는 길을 함께 말한다', async () => {
    const { calls } = renderDialog({ status: 200, body: {} });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId('meta-archive-confirming').textContent).toContain('[복구]');
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await waitFor(() => expect(calls).toEqual(['POST /projects/clemvion/specs/SPC-A/archive']));
  });

  it('Esc 는 확인만 닫고, 한 번 더 누르면 다이얼로그를 닫는다', async () => {
    const { onClose } = renderDialog({ status: 200, body: {} });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    fireEvent.keyDown(screen.getByTestId('meta-archive-cancel'), { key: 'Escape' });
    expect(screen.queryByTestId('meta-archive-confirming')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('막힌 이유는 누를 수 있다 — 정리할 문서·작업으로 가는 링크', async () => {
    renderDialog({
      status: 409,
      body: {
        ok: false,
        code: NERV_ERROR.PRECONDITION,
        message: '',
        details: {
          kind: 'archive_blocked',
          blockers: [
            { kind: 'child_spec', key: 'SPC-A-1' },
            { kind: 'active_claim', key: 'CLV-T-AAAAAA' },
          ],
        },
        retry_after_s: null,
        next_actions: [],
      },
    });
    fireEvent.click(await screen.findByTestId('meta-archive'));
    fireEvent.click(screen.getByTestId('meta-archive-confirm'));
    await screen.findByTestId('archive-blocked');
    expect(screen.getByRole('link', { name: 'SPC-A-1' }).getAttribute('href')).toBe(
      '/p/clemvion/specs/SPC-A-1',
    );
    expect(screen.getByRole('link', { name: 'CLV-T-AAAAAA' }).getAttribute('href')).toBe(
      '/p/clemvion/tasks/CLV-T-AAAAAA',
    );
  });
});
