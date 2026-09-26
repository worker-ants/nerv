// 보낸 결정을 바로잡는 길 (2026-09-26 — 사람 결정 · 결정 철회 검토 · REQ-WEB-239)
//
// 철회 API 는 만들지 않는다 — 결정은 누르는 트랜잭션 안에서 문서를 옮기고 에이전트를 깨우며, 명세는 되돌리는 것을
// "새 결정" 으로 정해 두었다. 그런데 화면과 매뉴얼은 "보낸 뒤에는 되돌릴 수 없습니다" 에서 끝났다 — 그러면
// 무엇을 하면 되는지가 곁에 있어야 한다. 처리됨 카드가 대상·결정별 한 줄과 그 대상으로 가는 길을 싣고,
// 답을 보낸 토스트는 그 세션으로 데려간다(잘못 답했으면 지시로 고쳐 말한다).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider, useRealtime } from '../../lib/realtime.js';
import { ApprovalCard } from './approval-card.js';
import { setDecisionGraceForTesting } from './decision-grace.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

function ToastLinks(): React.JSX.Element {
  const { toasts } = useRealtime();
  return (
    <ul data-testid="toast-links">
      {toasts.map((toast) => (
        <li key={toast.id} data-href={toast.href ?? ''}>
          {toast.hrefLabel ?? ''}
        </li>
      ))}
    </ul>
  );
}

async function renderCard(card: Record<string, unknown>): Promise<void> {
  const rootRoute = createRootRoute({
    component: () => (
      <RealtimeProvider>
        <ApprovalCard card={card} />
        <ToastLinks />
      </RealtimeProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  setDecisionGraceForTesting(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
  );
});

afterEach(() => {
  setDecisionGraceForTesting();
  vi.unstubAllGlobals();
  cleanup();
});

const decided = (extra: Record<string, unknown>) => ({
  id: 'ap-1',
  project_slug: 'clemvion',
  requested_at: new Date().toISOString(),
  decided_at: new Date().toISOString(),
  can_approve: true,
  ...extra,
});

describe('처리됨 카드는 바로잡는 길을 싣는다 (REQ-WEB-239)', () => {
  it('승인한 스펙 — 거둘 수 없고, 코멘트나 새 초안으로 바로잡는다 · 그 문서로 가는 길', async () => {
    await renderCard(
      decided({
        subject_type: 'spec_version',
        spec_key: 'SPC-CWC-007',
        version_no: 4,
        decision: 'approve',
      }),
    );
    const line = await screen.findByTestId('correction-path');
    expect(line.textContent).toContain('보낸 승인은 취소할 수 없습니다');
    expect(line.textContent).toContain('새 초안');
    const link = screen.getByTestId('correction-link');
    expect(link.getAttribute('href')).toContain('/p/clemvion/specs/SPC-CWC-007');
  });

  it('거절·코멘트한 스펙 — 문서는 초안으로 돌아갔고 작성자가 다시 낸다', async () => {
    for (const decision of ['reject', 'comment']) {
      await renderCard(
        decided({ subject_type: 'spec_version', spec_key: 'SPC-CWC-007', decision }),
      );
      expect((await screen.findByTestId('correction-path')).textContent).toContain(
        '초안으로 돌아갔습니다',
      );
      cleanup();
    }
  });

  it('승인한 계획 — 게이트는 다시 서지 않는다 · 멈추는 길은 세션 중단이나 클레임 놓기 · 그 작업으로', async () => {
    await renderCard(
      decided({ subject_type: 'plan', task_key: 'CLV-T-1KTDCK', decision: 'approve' }),
    );
    const line = await screen.findByTestId('correction-path');
    expect(line.textContent).toContain('되돌릴 수 없습니다');
    expect(line.textContent).toContain('클레임');
    expect(screen.getByTestId('correction-link').getAttribute('href')).toContain(
      '/p/clemvion/tasks/CLV-T-1KTDCK',
    );
  });

  it('승인한 하향 — 처분은 바꿀 수 없고 새 발견으로 올린다 · 면제는 거두는 것도 새 결정이다', async () => {
    await renderCard(
      decided({ subject_type: 'finding', finding_id: 'f-12345678', decision: 'approve' }),
    );
    expect((await screen.findByTestId('correction-path')).textContent).toContain('새 발견');
    cleanup();
    await renderCard(decided({ subject_type: 'gate_bypass', decision: 'approve' }));
    expect((await screen.findByTestId('correction-path')).textContent).toContain('새로 결정');
  });

  it('대기 카드에는 서지 않는다 — 결정하기 전에는 바로잡을 것이 없다', async () => {
    await renderCard({
      id: 'ap-2',
      subject_type: 'spec_version',
      spec_key: 'SPC-CWC-007',
      project_slug: 'clemvion',
      requested_at: new Date().toISOString(),
      can_approve: true,
      waiting_seconds: 60,
    });
    await screen.findByTestId('approve');
    expect(screen.queryByTestId('correction-path')).toBeNull();
  });
});

describe('답을 보낸 토스트는 그 세션으로 데려간다 (REQ-WEB-239)', () => {
  it('보낸 답은 거둘 수 없다 — 잘못 답했으면 그 세션에 지시로 고쳐 말한다', async () => {
    await renderCard({
      id: 'q-1',
      subject_type: 'question',
      title: '판정 방식',
      project_slug: 'clemvion',
      session_id: 'sess-0001',
      hostname: 'mac-07',
      agent_type: 'claude-code',
      options: ['A', 'B'],
      requested_at: new Date().toISOString(),
      waiting_seconds: 60,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'B' }));
    await waitFor(() =>
      expect(screen.getByTestId('toast-links').querySelector('li')?.getAttribute('data-href')).toBe(
        '/p/clemvion/sessions/sess-0001',
      ),
    );
    expect(screen.getByTestId('toast-links').textContent).toContain('세션으로');
  });
});
