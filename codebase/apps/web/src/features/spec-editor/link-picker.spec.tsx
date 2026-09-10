// 스펙 링크 넣기 (screens.md §3.1a · REQ-WEB-109)
//
// 관계는 본문의 링크에서만 만들어진다. 웹에서 링크를 넣는 길이 URL 을 손으로 붙이는
// 것뿐이면 사람이 쓴 문서는 계속 산문으로 남는다 — 그러면 규약을 에이전트에게만 지키게 한다.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { SpecEditor } from './editor.js';
import { specLinkHref } from './spec-link-picker.js';
import { asProjectId } from '../../lib/query-keys.js';

const NODES = [
  { id: 'a', key: 'SUD-AREA-PLAY', title: '게임플레이 · 실시간 동기화', type: 'area' },
  { id: 'b', key: 'SUD-FTR-COOP', title: '협동 모드', type: 'feature' },
  { id: 'c', key: 'SUD-SELF', title: '나 자신', type: 'feature' },
];

// jsdom 은 레이아웃을 계산하지 않아 `getClientRects` 가 없다. ProseMirror 는 선택을 옮긴 뒤
// 그 자리로 스크롤하려고 그것을 부르는데, 그 호출이 **트랜잭션 바깥의 비동기**라 던지면
// 테스트가 아니라 러너가 잡는다(간헐 실패로 나타났다 — 실측 2026-08-30).
beforeEach(() => {
  Element.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/specs/tree') ? NODES : {}),
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderEditor(onChange = vi.fn(), readOnly = false): void {
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SpecEditor
          value={'# 문서\n\n협동은 보드가 하나다.'}
          readOnly={readOnly}
          onChange={onChange}
          projectSlug="sudoku"
          // 앱은 언제나 함께 넘긴다(specs.$spec.tsx) — 트리 쿼리가 이 축으로 잡힌다
          projectId={asProjectId('p-1')}
          specKey="SUD-SELF"
        />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

describe('링크 대상 형태', () => {
  it('앱 경로로 만든다 — 웹에서 그대로 눌리고 서버는 끝의 키만 본다', () => {
    expect(specLinkHref('sudoku', 'SUD-AREA-PLAY')).toBe('/p/sudoku/specs/SUD-AREA-PLAY');
  });
});

describe('스펙 링크 고르기', () => {
  it('편집할 수 있을 때만 버튼이 있다 — 읽기 화면에 쓰기 도구를 두지 않는다', () => {
    renderEditor(vi.fn(), true);
    expect(screen.queryByTestId('editor-link-spec')).toBeNull();
  });

  it('목록에서 자기 자신은 빠진다 — 자기 참조는 관계가 아니다', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('editor-link-spec'));
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBeGreaterThan(0));
    const labels = screen.getAllByTestId('link-option').map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('SUD-AREA-PLAY'))).toBe(true);
    expect(labels.some((l) => l?.includes('SUD-SELF'))).toBe(false);
  });

  it('제목·키로 좁힌다', async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('editor-link-spec'));
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(2));
    fireEvent.change(screen.getByPlaceholderText('제목·키로 찾기'), { target: { value: '협동' } });
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(1));
    expect(screen.getByTestId('link-option').textContent).toContain('협동 모드');
  });

  it('고르면 본문에 링크가 들어간다 — 그 링크가 곧 관계다', async () => {
    const onChange = vi.fn();
    renderEditor(onChange);
    fireEvent.click(screen.getByTestId('editor-link-spec'));
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(2));
    fireEvent.click(
      screen.getAllByTestId('link-option').find((b) => b.textContent?.includes('협동 모드'))!,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const markdown = onChange.mock.calls.at(-1)?.[0] as string;
    expect(markdown).toContain('[협동 모드](/p/sudoku/specs/SUD-FTR-COOP)');
  });
});
