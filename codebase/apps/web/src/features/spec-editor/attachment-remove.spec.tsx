// 첨부 삭제 — REQ-WEB-200 · 내리기와 복원 — REQ-WEB-265
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

/**
 * **지난 버전 본문이 가리키는 첨부는 지우지 않고 내린다**(2026-09-28 · REQ-WEB-265).
 *
 * 첨부는 버전이 아니라 스펙에 매달린다 — 옛 시안을 지우면 그 시안을 가리키던 승인본의 그림이
 * 깨진다. 그래서 단추부터 [내리기]다: [삭제]를 눌렀는데 파일이 남으면 그것이 혼동이다.
 */
describe('내리기와 복원 (REQ-WEB-265)', () => {
  const current = [
    {
      id: 'a-old',
      filename: '옛-시안.png',
      content_type: 'image/png',
      uploaded_by: '지민',
      referenced_by_versions: [4],
    },
  ];
  const hidden = [
    {
      id: 'h-1',
      filename: '지난-시안.png',
      content_type: 'image/png',
      referenced_by_versions: [2],
    },
    { id: 'h-2', filename: '쓰지-않은.png', content_type: 'image/png', referenced_by_versions: [] },
  ];

  function renderPanel(canEdit = true): { calls: { method: string; url: string }[] } {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url: String(url) });
      const body =
        method === 'DELETE'
          ? { attachment_id: 'a-old', deleted: false, hidden: true, file_kept: true }
          : method === 'POST'
            ? { attachment_id: 'h-1', hidden: false }
            : String(url).includes('hidden=true')
              ? hidden
              : current;
      return { ok: true, status: 200, json: async () => body };
    });
    render(
      <LocaleProvider locale="ko">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <RealtimeProvider>
            <AttachmentPanel projectSlug="clemvion" specKey="SPC-A" canEdit={canEdit} />
          </RealtimeProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
    return { calls };
  }

  it('지난 버전이 가리키면 [삭제] 대신 [내리기]다 — 확인에 그 버전을 적는다', async () => {
    const { calls } = renderPanel();
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(1));
    const item = screen.getByTestId('attachment');
    expect(within(item).queryByTestId('attach-remove')).toBeNull();
    fireEvent.click(within(item).getByTestId('attach-hide'));
    const confirming = screen.getByTestId('attach-hide-confirming');
    expect(confirming.textContent).toContain('옛-시안.png');
    expect(confirming.textContent).toContain('v4');
    fireEvent.click(screen.getByTestId('attach-hide-confirm'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/attachments\/a-old$/);
  });

  it('내린 첨부는 접혀 있다 — 펼치면 복원하고, 가리키는 버전이 없을 때만 지운다', async () => {
    const { calls } = renderPanel();
    const toggle = await screen.findByTestId('attach-hidden-toggle');
    expect(toggle.textContent).toContain('2');
    expect(screen.queryAllByTestId('attachment-hidden')).toHaveLength(0);

    fireEvent.click(toggle);
    const rows = screen.getAllByTestId('attachment-hidden');
    expect(rows).toHaveLength(2);
    const [pointed, unused] = rows as [HTMLElement, HTMLElement];
    expect(within(pointed).getByTestId('attach-kept-for').textContent).toContain('v2');
    expect(within(pointed).queryByTestId('attach-remove')).toBeNull();
    expect(within(unused).getByTestId('attach-remove')).toBeTruthy();

    fireEvent.click(within(pointed).getByTestId('attach-restore'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'POST')?.url).toMatch(/\/attachments\/h-1\/restore$/);
  });

  it('올릴 수 없는 사람에게는 내린 첨부를 부르지도 보이지도 않는다', async () => {
    const { calls } = renderPanel(false);
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(1));
    expect(screen.queryByTestId('attach-hide')).toBeNull();
    expect(screen.queryByTestId('attach-hidden-toggle')).toBeNull();
    expect(calls.some((c) => c.url.includes('hidden=true'))).toBe(false);
  });
});
