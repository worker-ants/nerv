// 첨부 주소의 오리진 — REQ-WEB-166 (2026-09-21 사람 보고)
//
// 첨부 링크가 **화면 호스트**로 갔다: `https://app.…/api/v1/projects/sudoku/attachments/…`.
// 패널이 주소를 손으로 조립하면서 `apiBase()` 를 빼먹었고(업로드 경로는 붙이고 있었다),
// 한 호스트 배치에서는 그 둘이 같아 **아무도 못 봤다**. 호스트를 가른 배치에서는 그쪽에
// API 가 없어 링크가 죽는다 — 세션 쿠키도 API 호스트의 것이라 앞문이 프록시해도 401 이다.
//
// 이 파일이 지키는 것은 두 가지이고, **둘이 서로 반대 방향이라 함께 봐야 한다**:
//   ① 브라우저가 스스로 부르는 자리(`<img src>`·`<a href>`)에는 오리진이 붙는다
//   ② 본문(md)에 남는 주소에는 붙지 않는다 — 문서를 배치에 묶지 않는다(REQ-API-089)

import { Editor } from '@tiptap/react';
import { LocaleProvider } from '../../lib/i18n.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RealtimeProvider } from '../../lib/realtime.js';
import { resetRuntimeConfigForTesting } from '../../lib/config.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: () => undefined,
    onAny: () => undefined,
    emit: () => undefined,
    close: () => undefined,
  }),
}));
import { AttachmentPanel } from './attachment-panel.js';
import { EDITOR_EXTENSIONS, normalize } from './editor.js';

/** 호스트를 가른 배치(4.1 §2.3 4단계) — 화면은 `app.`, API 는 `api.` 다. */
const API = 'https://api.example.com';

const items = [
  { id: 'a-1', filename: '시안.png', content_type: 'image/png', uploaded_by: '지민' },
  { id: 'a-2', filename: '리포트.pdf', content_type: 'application/pdf', uploaded_by: '지민' },
];

beforeEach(() => resetRuntimeConfigForTesting({ apiBase: API }));

afterEach(() => {
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
  cleanup();
});

function renderPanel(onInsert: (snippet: string) => void): void {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => items }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <AttachmentPanel
            projectSlug="sudoku"
            specKey="SPC-A"
            canEdit={false}
            onInsert={onInsert}
          />
        </RealtimeProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('첨부 패널의 주소', () => {
  it('브라우저가 부르는 주소에는 API 오리진이 붙는다', async () => {
    renderPanel(() => undefined);
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(2));
    const [image, pdf] = screen.getAllByTestId('attachment') as HTMLElement[];

    // 미리보기 — 상대 경로면 브라우저가 화면 오리진으로 해소한다
    expect(
      within(image as HTMLElement)
        .getByRole('img')
        .getAttribute('src'),
    ).toBe(`${API}/api/v1/projects/sudoku/attachments/a-1`);
    // 받는 링크 — 사람이 실제로 눌러 본 자리다
    expect(
      within(pdf as HTMLElement)
        .getByText('리포트.pdf')
        .getAttribute('href'),
    ).toBe(`${API}/api/v1/projects/sudoku/attachments/a-2`);
  });

  it('본문에 넣는 주소에는 붙지 않는다 — 문서는 배치에 묶이지 않는다', async () => {
    const inserted: string[] = [];
    renderPanel((snippet) => inserted.push(snippet));
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(2));
    const rows = screen.getAllByTestId('attachment');
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId('attach-insert'));
    fireEvent.click(within(rows[1] as HTMLElement).getByTestId('attach-insert'));

    expect(inserted[0]).toBe('![시안.png](/api/v1/projects/sudoku/attachments/a-1)');
    expect(inserted[1]).toBe('[리포트.pdf](/api/v1/projects/sudoku/attachments/a-2)');
    for (const snippet of inserted) expect(snippet).not.toContain(API);
  });
});

describe('본문에 남은 첨부 주소', () => {
  const body = [
    '![시안](/api/v1/projects/sudoku/attachments/a-1)',
    '',
    '[리포트](/api/v1/projects/sudoku/attachments/a-2)',
    '',
    '[다른 스펙](/p/sudoku/specs/SUD-S-ABC123)',
    '',
    '[바깥](https://example.com/x)',
  ].join('\n');

  it('그릴 때 API 오리진이 붙는다 — 스펙 링크·외부 링크는 그대로다', () => {
    const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: body });
    const html = editor.getHTML();
    editor.destroy();

    expect(html).toContain(`src="${API}/api/v1/projects/sudoku/attachments/a-1"`);
    expect(html).toContain(`href="${API}/api/v1/projects/sudoku/attachments/a-2"`);
    // 앱 안의 길은 앱의 것이다 — API 오리진을 붙이면 라우터 밖으로 나간다
    expect(html).toContain('href="/p/sudoku/specs/SUD-S-ABC123"');
    expect(html).toContain('href="https://example.com/x"');
  });

  it('저장되는 md 는 상대 주소 그대로다 — 왕복이 문서를 다시 쓰지 않는다', () => {
    const editor = new Editor({ extensions: EDITOR_EXTENSIONS, content: body });
    const serialized = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    editor.destroy();

    expect(serialized).not.toContain(API);
    expect(normalize(serialized)).toBe(normalize(body));
  });
});
