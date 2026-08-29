// 문서 대조에서 드러난 이탈의 회귀 방지 — S7 받은 요청 (REQ-WEB-022·024·025)
//
// 셋 다 "막는 것"이 아니라 **말하게 하는 것**이 요점이다: 거절에는 사유가 남아야 하고,
// 질문 처리는 어느 세션에 전달됐는지 보여야 하며, 키보드만으로 끝나야 한다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './approval-card.js';
import { RealtimeProvider, useRealtime } from '../../lib/realtime.js';

/**
 * 토스트 출구는 앱 셸이 갖는다 — 카드만 렌더하는 테스트에는 그릴 곳이 없다.
 * 셸 전체를 띄우는 대신 같은 컨텍스트를 읽는 최소 출구를 둔다.
 */
function ToastProbe(): React.JSX.Element {
  const { toasts } = useRealtime();
  return <div data-testid="toast">{toasts.map((t) => t.message).join(' | ')}</div>;
}

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

let posted: { url: string; body: unknown }[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      posted.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderCard(card: Record<string, unknown>, active = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <ApprovalCard card={card} active={active} />
          <ToastProbe />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const APPROVAL = {
  id: 'a1',
  subject_type: 'spec_version',
  spec_title: '웹챗 위젯',
  project_slug: 'clemvion',
  self_requested: false,
  waiting_seconds: 60,
};

describe('REQ-WEB-022 — 거절에는 사유가 필수다', () => {
  it('사유 없이 거절하면 서버를 부르지 않고 사유를 요구한다', async () => {
    renderCard(APPROVAL);
    fireEvent.click(screen.getByRole('button', { name: '거절' }));

    await waitFor(() => expect(screen.getByTestId('reason-required')).toBeDefined());
    // 요청 자체가 나가지 않았다 — 서버 검증에 기대지 않고 화면이 먼저 막는다
    expect(posted.filter((p) => p.url.includes('/decision'))).toHaveLength(0);
  });

  it('사유를 적으면 거절이 나가고 사유가 함께 실린다 — 알림·감사 로그의 재료다', async () => {
    renderCard(APPROVAL);
    fireEvent.change(screen.getByTestId('decision-comment'), {
      target: { value: '범위가 넓습니다' },
    });
    fireEvent.click(screen.getByRole('button', { name: '거절' }));

    await waitFor(() => expect(posted.some((p) => p.url.includes('/decision'))).toBe(true));
    const sent = posted.find((p) => p.url.includes('/decision'))?.body as Record<string, unknown>;
    expect(sent['decision']).toBe('reject');
    expect(sent['comment']).toBe('범위가 넓습니다');
  });

  it('승인에는 사유를 요구하지 않는다 — 마찰은 되돌리기 어려운 쪽에만 둔다', async () => {
    renderCard(APPROVAL);
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    await waitFor(() => expect(posted.some((p) => p.url.includes('/decision'))).toBe(true));
  });
});

describe('REQ-WEB-025 — a/r/c 키보드 완결', () => {
  it('포커스된 카드에서 a 는 승인이다', async () => {
    renderCard(APPROVAL, true);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(posted.some((p) => p.url.includes('/decision'))).toBe(true));
  });

  it('포커스가 없는 카드는 키를 먹지 않는다 — 목록 전체가 동시에 반응하면 사고다', () => {
    renderCard(APPROVAL, false);
    fireEvent.keyDown(window, { key: 'a' });
    expect(posted.filter((p) => p.url.includes('/decision'))).toHaveLength(0);
  });

  it('r 은 사유가 없으면 막힌다 — 키보드 경로도 같은 규칙이다', async () => {
    renderCard(APPROVAL, true);
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => expect(screen.getByTestId('reason-required')).toBeDefined());
  });

  it('입력 중에는 단축키가 글자를 먹지 않는다', () => {
    renderCard(APPROVAL, true);
    const input = screen.getByTestId('decision-comment');
    fireEvent.keyDown(input, { key: 'a', target: input });
    expect(posted.filter((p) => p.url.includes('/decision'))).toHaveLength(0);
  });
});

describe('REQ-WEB-024 — 질문 처리는 어느 세션에 전달됐는지 말한다', () => {
  it('답변 후 토스트에 hostname·agent_type 이 실린다', async () => {
    renderCard({
      id: 'q1',
      subject_type: 'question',
      title: '어느 쪽으로',
      project_slug: 'clemvion',
      hostname: 'mac-07',
      agent_type: 'claude-code',
      waiting_seconds: 30,
    });
    fireEvent.change(screen.getByTestId('decision-comment'), { target: { value: 'A 로' } });
    fireEvent.click(screen.getByRole('button', { name: '답변 보내기' }));

    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toContain('mac-07/claude-code'),
    );
  });
});

// ── 선택지 (2026-08-30 — 스킬이 요구하던 것을 도구·화면이 받는다) ────────────────
//
// 에이전트는 그대로 실행 가능한 답 2~4개를 만들어 보낸다(skills/question §절차 1).
// 그런데 화면에는 자유 서술 상자 하나뿐이라 **선택지가 어디에도 그려지지 않았다** —
// 구조화해서 보낸 쪽의 노력이 사라지고, 사람이 고른 것과 에이전트가 읽은 것이 갈린다.

describe('질문의 선택지는 누를 수 있어야 한다', () => {
  const card = {
    id: 'q9',
    subject_type: 'question',
    title: '판정 방식',
    project_slug: 'clemvion',
    hostname: 'mac-07',
    agent_type: 'claude-code',
    options: ['A — 순수 클리어 순서', 'B — 감점 가중'],
    waiting_seconds: 60,
  };

  it('선택지를 버튼으로 그린다', () => {
    renderCard(card);
    const options = screen.getByTestId('question-options');
    expect(options.textContent).toContain('A — 순수 클리어 순서');
    expect(options.textContent).toContain('B — 감점 가중');
  });

  it('누르면 고른 값이 answer_key 로 그대로 실린다 — 재해석이 끼어들 자리가 없다', async () => {
    renderCard(card);
    fireEvent.click(screen.getByRole('button', { name: 'B — 감점 가중' }));

    // /me 같은 배경 조회가 섞이므로 답변 요청만 골라 본다
    const answer = await waitFor(() => {
      const hit = posted.find((p) => p.url.includes('/questions/q9/answer'));
      expect(hit).toBeDefined();
      return hit;
    });
    expect(answer?.body).toMatchObject({ answer_key: 'B — 감점 가중' });
  });

  it('선택지가 없으면 버튼 줄도 없다 — 빈 줄은 고를 것이 있다는 거짓말이다', () => {
    renderCard({ ...card, options: [] });
    expect(screen.queryByTestId('question-options')).toBeNull();
  });
});
