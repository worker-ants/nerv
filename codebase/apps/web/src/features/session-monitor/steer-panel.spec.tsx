// steer / stop 의 권한 축 — 화면은 서버가 허용할 것을 미리 말한다 (§1.8 · REQ-WEB-003)
//
// 서버는 이 문을 **세션 소유자와 admin** 에게만 연다(EP-SES-04 · `session.service.ts` 의
// `FORBIDDEN(not_owner)`). 2026-09-06 까지 패널에는 그 축이 없어 누구에게나 활성이었고,
// 남의 세션에 **중단 사유까지 적은 뒤** 403 을 받았다 — 되돌릴 수 없는 버튼일수록
// 누르기 전에 말해야 한다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../../lib/realtime.js';
import { SteerPanel } from './steer-panel.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(cleanup);

function panel(props: { canIntervene: boolean; state?: string }): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <SteerPanel
            projectSlug="clemvion"
            sessionId="s-1"
            state={props.state ?? 'active'}
            canIntervene={props.canIntervene}
          />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('steer 패널의 권한 축', () => {
  it('개입할 수 있으면 중단 버튼이 살아 있다', () => {
    panel({ canIntervene: true });
    expect((screen.getByTestId('stop-button') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('steer-forbidden')).toBeNull();
  });

  it('남의 세션이면 막고 **왜 막혔는지 말한다** — 사유를 적은 뒤 403 을 받게 두지 않는다', () => {
    panel({ canIntervene: false });
    expect((screen.getByTestId('stop-button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('steer-forbidden').textContent).toContain('admin');
  });

  it('입력칸까지 막는다 — 쓸 수 있게 두면 지시를 다 적은 뒤에야 막힌 것을 안다', () => {
    panel({ canIntervene: false });
    expect((screen.getByLabelText('지시') as HTMLInputElement).disabled).toBe(true);
  });

  it('끝난 세션과 남의 세션은 **다른 문구**로 말한다 — 기다리면 되는 일과 아닌 일은 다르다', () => {
    panel({ canIntervene: true, state: 'complete' });
    expect(screen.getByText('종료된 세션입니다')).toBeTruthy();
    expect(screen.queryByTestId('steer-forbidden')).toBeNull();
  });
});
