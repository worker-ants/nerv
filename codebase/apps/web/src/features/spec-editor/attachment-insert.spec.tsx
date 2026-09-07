// 첨부 삽입 — **그림이 아닌 것은 링크다** (screens.md §2.4 · 2026-09-07 사람 결정)
//
// 삽입 단추가 모든 파일에 이미지 문법(`![…](…)`)을 넣고 있었다. PDF·CSV 를 삽입하면
// 본문에 **깨진 이미지 자리**가 생기고, 누른 사람은 자기가 잘못 올렸다고 읽는다 —
// 오류도 아니고 아무 일도 없는 것도 아닌, 가장 헷갈리는 실패다.

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

function renderPanel(onInsert: (snippet: string) => void): void {
  // 패널은 자기 목록을 직접 읽는다 — 서버 응답을 흉내 낸다(첨부 목록은 맨 배열이다)
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => items }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <AttachmentPanel
            projectSlug="clemvion"
            specKey="SPC-A"
            canEdit={false}
            onInsert={onInsert}
          />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('첨부 삽입 문법', () => {
  it('그림은 이미지 문법, 그 밖은 링크 문법이다', async () => {
    const inserted: string[] = [];
    renderPanel((s) => inserted.push(s));

    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(2));
    const rows = screen.getAllByTestId('attachment');
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId('attach-insert'));
    fireEvent.click(within(rows[1] as HTMLElement).getByTestId('attach-insert'));

    expect(inserted[0]).toMatch(/^!\[그림\.png\]\(/);
    // 느낌표가 없다 — 그것이 링크와 이미지를 가르는 전부다
    expect(inserted[1]).toMatch(/^\[표\.csv\]\(/);
    expect(inserted[1]?.startsWith('!')).toBe(false);
  });
});
