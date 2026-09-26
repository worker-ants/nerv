// 첨부 삭제 — REQ-WEB-200
//
// 첨부의 [본문에 넣기]와 그 문법 검사(2026-09-07 — 그림이 아닌 것은 링크)는 웹 본문 편집과
// 함께 없앴다(REQ-WEB-173). 그 규칙은 이제 에이전트가 지킨다 — `plugin/skills/spec/SKILL.md`.

import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealtimeProvider } from '../../lib/realtime.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));
import { AttachmentPanel } from './attachment-panel.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const items = [
  { id: 'a-1', filename: '그림.png', content_type: 'image/png', uploaded_by: '지민' },
  { id: 'a-2', filename: '표.csv', content_type: 'text/csv', uploaded_by: '지민' },
];

/**
 * **첨부 삭제는 되돌릴 수 없다**(REQ-WEB-200) — 서버가 저장소 객체와 행을 함께 지운다. 예전에는
 * 한 번 누르면 지워졌고, 본문이 그 파일을 가리키면 그림이 깨졌다.
 */
describe('첨부 삭제', () => {
  it('확인 전에는 지우지 않는다 — 확인하면 그 첨부 하나를 지운다', async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url) });
      return { ok: true, status: 200, json: async () => items };
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RealtimeProvider>
            <AttachmentPanel projectSlug="clemvion" specKey="SPC-A" canEdit />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(2));
    const first = screen.getAllByTestId('attachment')[0] as HTMLElement;
    fireEvent.click(within(first).getByTestId('attach-remove'));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(screen.getByTestId('attach-remove-confirming').textContent).toContain('그림.png');
    fireEvent.click(screen.getByTestId('attach-remove-confirm'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/attachments\/a-1$/);
  });
});
