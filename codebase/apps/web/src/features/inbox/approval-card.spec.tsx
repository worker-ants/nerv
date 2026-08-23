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
