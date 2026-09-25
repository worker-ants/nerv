// 보내기 전 5초 — 결정을 무를 길 (2026-09-25 · 사람 결정 D7 · UI/UX 검토 HUB-11 · SYS-03 · REQ-WEB-237)
//
// 명세는 처리됨 트레일에 "되돌리기 링크" 를 약속했지만 서버에 결정 철회 경로가 없어 그 링크는 한 번도 서지
// 않았다. `a` 한 번이 곧장 서버로 갔고, 잘못 누른 승인은 무를 길이 없었다. 이제 카드가 누른 결정을 5초 들고
// 있다가 보낸다 — 그 사이 [취소]·`z` 로 무른다. 이 파일은 **실제 5초**로 센다(가짜 시계).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { RealtimeProvider } from '../../lib/realtime.js';
import { ApprovalCard } from './approval-card.js';
import { DECISION_GRACE_MS } from './decision-grace.js';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));

let posted: { url: string; body: Record<string, unknown> | null }[] = [];
/** 결정·답변 요청만 — /me 같은 배경 조회는 세지 않는다 */
const sent = (): { url: string; body: Record<string, unknown> | null }[] =>
  posted.filter((p) => /\/decision$|\/answer$/.test(p.url));

beforeEach(() => {
  posted = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      posted.push({
        url: String(url),
        body: init?.body === undefined ? null : (JSON.parse(init.body) as Record<string, unknown>),
      });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** 시계를 민다 — 그 사이 도는 약속(요청의 시작)까지 풀어 준다 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const APPROVAL = {
  id: 'a1',
  subject_type: 'spec_version',
  spec_title: '웹챗 위젯',
  project_slug: 'clemvion',
  self_requested: false,
  can_approve: true,
  waiting_seconds: 60,
};

const QUESTION = {
  id: 'q9',
  subject_type: 'question',
  title: '판정 방식',
  project_slug: 'clemvion',
  hostname: 'mac-07',
  agent_type: 'claude-code',
  options: ['A — 순수 클리어 순서', 'B — 감점 가중'],
  waiting_seconds: 60,
};

function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>{children}</RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>
  );
}

function renderCard(card: Record<string, unknown>, active = false): void {
  render(
    <Providers>
      <ApprovalCard card={card} active={active} />
    </Providers>,
  );
}

/** 단추를 **사람처럼** 누른다 — 포커스가 먼저 가고 클릭이 온다 */
function press(name: string): void {
  const button = screen.getByRole('button', { name });
  button.focus();
  fireEvent.click(button);
}

describe('누른 결정은 5초 들고 있다가 보낸다 (REQ-WEB-237)', () => {
  it('[승인]을 누르면 곧장 나가지 않는다 — 무엇을 보내려는지와 [취소]가 서고, 5초가 지나야 나간다', async () => {
    renderCard(APPROVAL);
    press('승인');

    const strip = screen.getByTestId('decision-grace');
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.textContent).toContain('승인 — 5초 뒤 보냅니다.');
    // 누른 단추가 사라졌다 — 포커스는 [취소]로 간다(body 로 떨어지지 않게)
    await advance(0);
    expect(document.activeElement).toBe(screen.getByTestId('decision-cancel'));
    // 들고 있는 동안에는 결정 단추도 코멘트 칸도 못 쓴다
    expect(screen.queryByTestId('approve')).toBeNull();
    expect((screen.getByTestId('decision-comment') as HTMLTextAreaElement).readOnly).toBe(true);

    await advance(DECISION_GRACE_MS - 100);
    expect(sent()).toHaveLength(0);

    await advance(100);
    vi.useRealTimers();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.url).toContain('/approvals/a1/decision');
    expect(sent()[0]?.body?.['decision']).toBe('approve');
  });

  it('[취소]를 누르면 아무것도 나가지 않고 단추가 돌아온다 — 포커스는 카드로', async () => {
    renderCard(APPROVAL);
    press('승인');
    await advance(1_000);
    fireEvent.click(screen.getByTestId('decision-cancel'));

    await advance(DECISION_GRACE_MS * 2);
    expect(sent()).toHaveLength(0);
    expect(screen.queryByTestId('decision-grace')).toBeNull();
    expect(screen.getByTestId('approve')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByTestId('approval-card'));
  });

  it('키로도 무른다 — a 로 들고 z 로 무르며, 들고 있는 동안의 a·r 은 둘째 결정이 되지 않는다', async () => {
    renderCard(APPROVAL, true);
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getByTestId('decision-grace').textContent).toContain('승인');
    // 키로 들었으면 포커스를 옮기지 않는다 — j/k 로 다음 카드로 가는 흐름을 끊지 않는다
    await advance(0);
    expect(document.activeElement).not.toBe(screen.getByTestId('decision-cancel'));

    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getAllByTestId('decision-grace')).toHaveLength(1);
    expect(screen.getByTestId('decision-grace').textContent).toContain('승인');

    fireEvent.keyDown(window, { key: 'z' });
    await advance(DECISION_GRACE_MS * 2);
    expect(sent()).toHaveLength(0);

    // 무른 뒤에는 다시 결정할 수 있다 — 이번에는 끝까지 간다
    fireEvent.keyDown(window, { key: 'a' });
    await advance(DECISION_GRACE_MS);
    vi.useRealTimers();
    await waitFor(() => expect(sent()).toHaveLength(1));
  });

  it('실리는 코멘트는 누른 순간의 글이다 — 거절의 사유가 그대로 간다', async () => {
    renderCard(APPROVAL);
    fireEvent.change(screen.getByTestId('decision-comment'), { target: { value: '범위 밖' } });
    press('거절');
    expect(screen.getByTestId('decision-grace').textContent).toContain('거절 — 5초 뒤 보냅니다.');
    await advance(DECISION_GRACE_MS);
    vi.useRealTimers();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.body).toMatchObject({ decision: 'reject', comment: '범위 밖' });
  });

  it('질문의 선택지도 5초 든다 — 무엇을 답하려는지 그 글자로 말한다', async () => {
    renderCard(QUESTION);
    press('B — 감점 가중');
    expect(screen.getByTestId('decision-grace').textContent).toContain(
      '답변 “B — 감점 가중” — 5초 뒤 보냅니다.',
    );
    // 들고 있는 동안 다른 선택지를 눌러도 둘째 답이 되지 않는다
    expect(
      (screen.getByRole('button', { name: 'A — 순수 클리어 순서' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await advance(DECISION_GRACE_MS);
    vi.useRealTimers();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.url).toContain('/questions/q9/answer');
    expect(sent()[0]?.body?.['answer_key']).toBe('B — 감점 가중');
  });
});

describe('들고 있던 결정을 조용히 버리지 않는다', () => {
  it('카드가 사라지면(다른 화면으로 옮김) 곧장 보낸다 — 누른 사람은 보내라고 했다', async () => {
    let hide: () => void = () => undefined;
    function Toggle(): React.JSX.Element | null {
      const [shown, setShown] = useState(true);
      hide = () => setShown(false);
      return shown ? <ApprovalCard card={APPROVAL} /> : null;
    }
    render(
      <Providers>
        <Toggle />
      </Providers>,
    );
    press('승인');
    await advance(1_000);
    expect(sent()).toHaveLength(0);

    act(() => hide());
    vi.useRealTimers();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.body?.['decision']).toBe('approve');
  });

  it('들고 있는 동안 창을 닫으려 하면 브라우저가 묻는다 — 무르면 더 묻지 않는다', async () => {
    const leave = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderCard(APPROVAL);
    expect(leave()).toBe(false);
    press('승인');
    expect(leave()).toBe(true);
    fireEvent.click(screen.getByTestId('decision-cancel'));
    expect(leave()).toBe(false);
  });
});

describe('막대의 길이가 유예와 같다', () => {
  it('tokens.css 의 --animate-grace 가 DECISION_GRACE_MS 와 같은 초다 — 한쪽만 고치면 막대가 거짓말을 한다', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/tokens.css'),
      'utf8',
    );
    const seconds = /--animate-grace:\s*grace\s+([\d.]+)s\b/.exec(css)?.[1];
    expect(Number(seconds) * 1000).toBe(DECISION_GRACE_MS);
    expect(DECISION_GRACE_MS).toBe(5_000);
  });
});
