// steer / stop 의 권한 축 — 화면은 서버가 허용할 것을 미리 말한다 (§1.8 · REQ-WEB-003)
//
// 서버는 이 문을 **세션 소유자와 admin** 에게만 연다(EP-SES-04 · `session.service.ts` 의
// `FORBIDDEN(not_owner)`). 2026-09-06 까지 패널에는 그 축이 없어 누구에게나 활성이었고,
// 남의 세션에 **중단 사유까지 적은 뒤** 403 을 받았다 — 되돌릴 수 없는 버튼일수록
// 누르기 전에 말해야 한다.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '../../lib/realtime.js';
import { SteerPanel } from './steer-panel.js';
import { asProjectId } from '../../lib/query-keys.js';
import type { ProjectId } from '../../lib/query-keys.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

afterEach(cleanup);

function panel(props: {
  canIntervene: boolean;
  state?: string;
  projectId?: ProjectId | undefined;
}): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <SteerPanel
            projectSlug="clemvion"
            projectId={'projectId' in props ? props.projectId : asProjectId('p-1')}
            sessionId="s-1"
            state={props.state ?? 'active'}
            canIntervene={props.canIntervene}
          />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return client;
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

/**
 * **무효화는 `project.id` 축으로 나간다**(4.5 §1.4 · `lib/queries.ts` "프로젝트 축").
 *
 * 세션 목록 캐시가 id 축인데 이 패널은 slug 로 무효화하고 있었다 — 그래서 중단 뒤에도
 * 보드가 그대로였다. 실시간이 붙어 있으면 이벤트가 가려 주므로 **끊긴 동안에만 드러나고**,
 * 그때는 사람이 방금 누른 것의 결과를 보지 못한다. 축이 어긋난 무효화는 조용히 아무 일도
 * 하지 않으므로, 이 검사는 키를 눈으로 본다 — 같은 부류가 세 번째다.
 */
describe('개입 뒤 무효화의 축', () => {
  it('세션 목록을 id 축으로 무효화한다 — slug 로 잡으면 아무 캐시도 맞지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reclaimed: 1 }) })),
    );
    const client = panel({ canIntervene: true, projectId: asProjectId('p-1') });
    const spy = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(screen.getByTestId('stop-button'));
    // 사유가 없으면 확인 버튼이 잠겨 있다(REQ-WEB-021) — 그것을 지나야 무효화까지 간다
    fireEvent.change(screen.getByTestId('stop-reason'), { target: { value: '겹침 정리' } });
    fireEvent.click(screen.getByTestId('stop-confirm'));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ['project', 'p-1', 'sessions'] });
    });
    vi.unstubAllGlobals();
  });
});

/**
 * **같은 지시를 두 번 보내면 두 번 간다**(REQ-WEB-195 · api.md §1.5).
 *
 * 키가 `steer-<세션>-<종류>-<지시 앞 16자>` 였던 동안, "계속 진행해" 를 하루 안에 다시 보내면
 * 서버가 첫 응답을 재생해 "보냈습니다" 만 뜨고 에이전트에게는 가지 않았다. 앞 16자만 같은
 * 두 지시는 서로의 재생으로 막혔다(`idempotency_mismatch`). 키는 누름을 따라가야 한다.
 */
describe('지시의 멱등 키는 누름마다 새로 난다', () => {
  it('같은 지시를 두 번 보내면 키가 둘이다', async () => {
    const keys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
        const key = init?.headers?.['Idempotency-Key'];
        if (key !== undefined) keys.push(key);
        return { ok: true, status: 200, json: async () => ({ reclaimed: 0 }) };
      }),
    );
    panel({ canIntervene: true });

    for (let i = 0; i < 2; i++) {
      fireEvent.change(screen.getByLabelText('지시'), { target: { value: '계속 진행해' } });
      fireEvent.click(screen.getByText('지시 보내기'));
      await waitFor(() => expect(keys).toHaveLength(i + 1));
      // 보내고 나면 입력이 비워진다 — 그것을 기다려야 다음 누름이 새 누름이다
      await waitFor(() =>
        expect((screen.getByLabelText('지시') as HTMLInputElement).value).toBe(''),
      );
    }
    expect(keys[0]).not.toBe(keys[1]);
    vi.unstubAllGlobals();
  });
});

/**
 * **중단 사유는 지시와 다른 칸이다**(REQ-WEB-200 · 2026-09-24 · UI/UX 검토 WORK-13).
 *
 * 한 상태를 나눠 쓰던 동안 [중단]을 누르면 적어 둔 지시가 사유 칸에 미리 차 있어 그대로 실행하면
 * 지시가 중단 사유로 남았고, 취소하면 사유로 쓴 글이 지시 칸에 남아 [지시 보내기]로 나갈 수 있었다.
 */
describe('중단 사유와 지시', () => {
  it('적어 둔 지시가 사유 칸으로 넘어가지 않고, 사유가 지시 칸으로 돌아오지 않는다', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body ?? '{}')));
        return { ok: true, status: 200, json: async () => ({ reclaimed: 1 }) };
      }),
    );
    panel({ canIntervene: true });
    const steer = screen.getByLabelText('지시') as HTMLInputElement;
    fireEvent.change(steer, { target: { value: '테스트를 먼저 돌려' } });

    fireEvent.click(screen.getByTestId('stop-button'));
    const reason = screen.getByTestId('stop-reason') as HTMLInputElement;
    expect(reason.value).toBe('');
    // 포커스는 사유 칸이다
    expect(document.activeElement).toBe(reason);
    fireEvent.change(reason, { target: { value: '겹침 정리' } });
    fireEvent.keyDown(reason, { key: 'Escape' });
    expect(steer.value).toBe('테스트를 먼저 돌려');

    fireEvent.click(screen.getByTestId('stop-button'));
    fireEvent.change(screen.getByTestId('stop-reason'), { target: { value: '겹침 정리' } });
    fireEvent.click(screen.getByTestId('stop-confirm'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ kind: 'stop', message: '겹침 정리' });
    // 지시는 보내지 않았으니 그대로 남는다
    expect(steer.value).toBe('테스트를 먼저 돌려');
    vi.unstubAllGlobals();
  });
});
