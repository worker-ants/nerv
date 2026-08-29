// E08-S07 — 승인 카드 (ui-wireframes §2.7 · REQ-WEB-008)

import { createTranslator } from '@nerv/schema';
import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard, waitedLabel } from './approval-card.js';
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

function renderCard(card: Record<string, unknown>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <ApprovalCard card={card} />
        </RealtimeProvider>
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
  it('질문 카드는 세션 신원 3요소를 싣는다 (REQ-WEB-008)', () => {
    renderCard({
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

  it('왜 부르는지를 같은 줄에 적는다 — 다섯 사유가 읽는 사람의 첫 분류다', () => {
    renderCard({
      id: 'q2',
      subject_type: 'question',
      title: '판정 방식',
      project_slug: 'sudoku',
      escalate: 'user-decision',
      waiting_seconds: 60,
    });
    expect(screen.getByTestId('question-escalate').textContent).toBe('제품 결정');
  });

  it('사유가 없으면 적지 않는다 — 빈 자리를 만들지 않는다', () => {
    renderCard({
      id: 'q3',
      subject_type: 'question',
      title: '사유 없는 질문',
      project_slug: 'sudoku',
      waiting_seconds: 60,
    });
    expect(screen.queryByTestId('question-escalate')).toBeNull();
  });

  it('발견에서 온 질문은 그 짧은 id 를 단다 — 리뷰 센터와 같은 표기다', () => {
    renderCard({
      id: 'q4',
      subject_type: 'question',
      title: '이 발견을 어떻게',
      project_slug: 'sudoku',
      finding_id: '9f8d4a2e-1c3b-4f5a-8e7d-6b5c4a3d2e1f',
      waiting_seconds: 60,
    });
    expect(screen.getByTestId('question-context').textContent).toContain('9f8d4a2e');
  });

  it('내가 요청한 승인은 버튼이 잠기고 사유가 보인다 — 지시자≠승인자 (spec-workflow §2.3)', () => {
    renderCard({
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

  it('남이 요청한 승인은 승인·거절이 열린다', () => {
    renderCard({
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
