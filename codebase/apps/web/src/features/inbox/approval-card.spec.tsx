// E08-S07 — 승인 카드 (ui-wireframes §2.7 · REQ-WEB-008)

import { createTranslator } from '@nerv/schema';
import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard, subjectFallback, waitedLabel } from './approval-card.js';
import { RealtimeProvider } from '../../lib/realtime.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(cleanup);

/**
 * 카드에 `<Link>` 가 들어왔으므로(2026-08-31) 라우터 안에서 그린다 — 밖에서 그리면
 * 링크가 라우터를 못 찾아 터지고, 그것을 피하려고 링크를 걷으면 정작 검사할 것이 사라진다.
 * 실제 routeTree 를 쓰지 않는 이유는 이 파일이 **카드 하나**를 보기 때문이다.
 */
async function renderCard(card: Record<string, unknown>, active = false): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <RealtimeProvider>
        <ApprovalCard card={card} active={active} />
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
      <QueryClientProvider client={client}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

// 테스트는 한국어 화면을 검사한다 — 로케일이 고정돼야 검사 대상이 기계마다 달라지지 않는다
const ko = createTranslator('ko');

describe('대기 시간 표기 — 오래된 요청이 묻히지 않게', () => {
  it.each([
    [30, '방금'],
    [90, '1분 대기'],
    [7200, '2시간 대기'],
    [172_800, '2일 대기'],
  ])('%s초 → %s', (seconds, label) => {
    expect(waitedLabel(ko, seconds)).toBe(label);
  });
});

describe('카드 3유형', () => {
  it('질문 카드는 세션 신원 3요소를 싣는다 (REQ-WEB-008)', async () => {
    await renderCard({
      id: 'q1',
      subject_type: 'question',
      title: '어느 쪽으로 갈까요',
      project_slug: 'clemvion',
      requested_by: '하나',
      hostname: 'mac-07',
      agent_type: 'claude-code',
      waiting_seconds: 300,
    });
    const identity = screen.getByTestId('question-identity');
    expect(identity.textContent).toContain('하나');
    expect(identity.textContent).toContain('mac-07');
    expect(identity.textContent).toContain('claude-code');
    expect(screen.getByTestId('waited').textContent).toBe('5분 대기');
  });

  it('왜 부르는지를 같은 줄에 적는다 — 다섯 사유가 읽는 사람의 첫 분류다', async () => {
    await renderCard({
      id: 'q2',
      subject_type: 'question',
      title: '판정 방식',
      project_slug: 'sudoku',
      escalate: 'user-decision',
      waiting_seconds: 60,
    });
    expect(screen.getByTestId('question-escalate').textContent).toBe('제품 결정');
  });

  it('사유가 없으면 적지 않는다 — 빈 자리를 만들지 않는다', async () => {
    await renderCard({
      id: 'q3',
      subject_type: 'question',
      title: '사유 없는 질문',
      project_slug: 'sudoku',
      waiting_seconds: 60,
    });
    expect(screen.queryByTestId('question-escalate')).toBeNull();
  });

  it('발견에서 온 질문은 그 짧은 id 를 단다 — 리뷰 센터와 같은 표기다', async () => {
    await renderCard({
      id: 'q4',
      subject_type: 'question',
      title: '이 발견을 어떻게',
      project_slug: 'sudoku',
      finding_id: '9f8d4a2e-1c3b-4f5a-8e7d-6b5c4a3d2e1f',
      waiting_seconds: 60,
    });
    expect(screen.getByTestId('question-context').textContent).toContain('9f8d4a2e');
  });

  it('내가 요청한 승인은 버튼이 잠기고 사유가 보인다 — 지시자≠승인자 (spec-workflow §2.3)', async () => {
    await renderCard({
      id: 'a1',
      subject_type: 'spec_version',
      spec_title: '웹챗 위젯',
      project_slug: 'clemvion',
      self_requested: true,
      waiting_seconds: 60,
    });
    expect(screen.getByText(/다른 승인자가 처리해야 합니다/)).toBeDefined();
    expect(screen.getByRole('button', { name: '승인' }).hasAttribute('disabled')).toBe(true);
  });

  it('남이 요청한 승인은 승인·거절이 열린다', async () => {
    await renderCard({
      id: 'a2',
      subject_type: 'spec_version',
      spec_title: '세션 복원 API',
      project_slug: 'clemvion',
      self_requested: false,
      waiting_seconds: 60,
    });
    expect(screen.getByRole('button', { name: '승인' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '거절' }).hasAttribute('disabled')).toBe(false);
  });
});

// 2026-08-31 사람 요청 — "받은 요청에서 그 문서를 열거나 그 페이지로 갈 수 있으면 좋겠다".
// 예전 카드에는 제목과 키뿐이었고, 키는 **글자였을 뿐**이라 문서를 보려면 목록에서
// 손으로 찾아야 했다 — 다른 탭에서 열고 돌아오는 왕복이 승인 병목(P4)의 한 조각이다.
describe('문서로 가는 길 (REQ-WEB-119)', () => {
  const SPEC_CARD = {
    id: 'ap-1',
    subject_type: 'spec_version',
    project_slug: 'sudoku',
    spec_key: 'SUD-CONV-DOCS',
    spec_title: '문서 규약',
    version_no: 1,
    waiting_seconds: 120,
    can_approve: true,
  };

  it('키가 문서로 가는 링크다', async () => {
    await renderCard(SPEC_CARD);
    const link = screen.getByText('SUD-CONV-DOCS').closest('a');
    expect(link?.getAttribute('href')).toBe('/p/sudoku/specs/SUD-CONV-DOCS');
  });

  it('본문을 카드에서 편다 — 펼칠 때 받아 온다(목록을 무겁게 하지 않는다)', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ body_md: '# 문서 규약\n\n본문' }) };
      }),
    );
    await renderCard(SPEC_CARD);
    // 펼치기 전에는 부르지 않는다
    expect(calls.some((u) => u.includes('/specs/SUD-CONV-DOCS'))).toBe(false);

    fireEvent.click(screen.getByTestId('toggle-body'));
    await waitFor(() => expect(screen.getByTestId('subject-body').textContent).toContain('본문'));
    // **검토 중인 그 버전**을 받는다 — 카드가 보여준 것과 승인되는 것이 같아야 한다
    expect(calls.some((u) => u.includes('/specs/SUD-CONV-DOCS?v=1'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('질문 카드의 발견은 리뷰 센터를 가리킨다 — 짧은 id 만 적어 두지 않는다', async () => {
    await renderCard({
      id: 'q-1',
      subject_type: 'question',
      project_slug: 'sudoku',
      title: '이 지적이 맞나요',
      finding_id: '0f3a91c2-7d10-4b55-9a3e-1c2d3e4f5a6b',
      hostname: 'mac-02',
      agent_type: 'claude-code',
      waiting_seconds: 60,
    });
    const href = screen.getByTestId('finding-link').getAttribute('href');
    expect(href).toContain('/p/sudoku/reviews');
    expect(href).toContain('finding=0f3a91c2-7d10-4b55-9a3e-1c2d3e4f5a6b');
  });
});

/**
 * 결정된 카드에서 키가 살아 있던 자리(2026-09-05 감사 · 06).
 *
 * 단추는 `decided === null` 일 때만 그려지는데 키 핸들러는 그 값을 보지 않아,
 * 처리됨 탭에서 `a` 를 누르면 요청이 나가고 `already_decided` 오류 토스트가 떴다.
 * 이 파일 자신이 "누를 수 있는 것은 할 수 있다는 뜻이어야 한다" 고 적어 둔 규율이다.
 */
describe('처리됨 탭 — 단추가 없으면 키도 없다', () => {
  const decidedCard = {
    id: 'ap-decided',
    subject_type: 'spec_version',
    subject_key: 'SPC-CWC-007',
    requested_at: new Date().toISOString(),
    can_approve: true,
    decision: 'approve',
    decided_at: new Date().toISOString(),
  };

  it('결정된 카드에서 `a` 는 아무 요청도 보내지 않는다', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await renderCard(decidedCard, true);

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'r' });

    // **기다렸다가 센다.** 뮤테이션은 비동기라 누른 직후에 세면 언제나 0이고,
    // 그러면 이 테스트는 결함이 있어도 통과한다(실제로 처음에 그랬다).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes('/approvals/'))).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('아직 안 정한 카드에서는 `a` 가 그대로 듣는다 — 조건을 너무 넓게 걸지 않았다', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { decision: _d, decided_at: _t, ...pending } = decidedCard;
    await renderCard({ ...pending, id: 'ap-pending' }, true);

    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/approvals/'))).toBe(true);
    });
    vi.unstubAllGlobals();
  });
});

describe('제목 없는 대상의 이름 (REQ-WEB-133)', () => {
  // 목록 질의는 `spec_version` 에만 제목을 JOIN 한다 — 나머지는 제목 없이 온다.
  // 2026-09-06 까지 폴백이 `gate_bypass` 하나뿐이라 플랜 결재 카드가 "(제목 없음)" 이었다.
  it.each([
    ['plan', '플랜'],
    ['finding', '발견'],
    ['gate_bypass', '게이트'],
    ['change_request', '변경'],
    ['question', '질문'],
    ['spec_version', '스펙'],
  ])('%s 은 종류의 이름을 말한다', (subjectType, word) => {
    const label = subjectFallback(ko, subjectType);
    expect(label).toContain(word);
    expect(label).not.toBe(ko('inbox.card.untitled'));
  });

  it('모르는 종류만 "(제목 없음)" 이다 — 아는 것을 그리로 흘리지 않는다', () => {
    expect(subjectFallback(ko, 'nonsense')).toBe(ko('inbox.card.untitled'));
    expect(subjectFallback(ko, undefined)).toBe(ko('inbox.card.untitled'));
  });
});
