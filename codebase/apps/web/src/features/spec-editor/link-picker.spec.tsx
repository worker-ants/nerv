// 스펙 고르개 (screens.md §3.1a · REQ-WEB-109)
//
// **2026-09-22 부터 이 고르개는 본문에 링크를 넣지 않는다**(사람 결정 · REQ-WEB-173).
// 웹에서 본문을 고치는 경로를 걷어냈기 때문이다 — 본문의 링크는 이제 에이전트가 쓴다.
// 컴포넌트는 남는다: 리뷰 센터의 처분 다이얼로그가 "어느 스펙을 고칠 것인가" 를 고를 때
// 같은 것을 쓴다(`review-center/resolve-dialog.tsx`). 그래서 이 파일이 지키는 것은
// **고르개 자신의 계약**이다 — 무엇이 목록에 오르고, 무엇이 빠지고, 고르면 무엇이 오는가.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { SpecLinkPicker, specLinkHref } from './spec-link-picker.js';
import { asProjectId } from '../../lib/query-keys.js';

const NODES = [
  { id: 'a', key: 'SUD-AREA-PLAY', title: '게임플레이 · 실시간 동기화', type: 'area' },
  { id: 'b', key: 'SUD-FTR-COOP', title: '협동 모드', type: 'feature' },
  { id: 'c', key: 'SUD-SELF', title: '나 자신', type: 'feature' },
];

beforeEach(() => {
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

function renderPicker(onPick = vi.fn()): void {
  render(
    <LocaleProvider locale="ko">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <SpecLinkPicker
          projectSlug="sudoku"
          // 앱은 언제나 함께 넘긴다 — 트리 쿼리가 이 축으로 잡힌다
          projectId={asProjectId('p-1')}
          excludeKey="SUD-SELF"
          onPick={onPick}
          onClose={() => undefined}
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

describe('스펙 고르기', () => {
  it('목록에서 자기 자신은 빠진다 — 자기 참조는 관계가 아니다', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBeGreaterThan(0));
    const labels = screen.getAllByTestId('link-option').map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('SUD-AREA-PLAY'))).toBe(true);
    expect(labels.some((l) => l?.includes('SUD-SELF'))).toBe(false);
  });

  it('제목·키로 좁힌다', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(2));
    fireEvent.change(screen.getByPlaceholderText('제목·키로 찾기'), { target: { value: '협동' } });
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(1));
    expect(screen.getByTestId('link-option').textContent).toContain('협동 모드');
  });

  it('고르면 그 문서가 온다 — 키와 제목 둘 다', async () => {
    const onPick = vi.fn();
    renderPicker(onPick);
    await waitFor(() => expect(screen.getAllByTestId('link-option').length).toBe(2));
    fireEvent.click(
      screen.getAllByTestId('link-option').find((b) => b.textContent?.includes('협동 모드'))!,
    );

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const picked = onPick.mock.calls.at(-1)?.[0] as { key: string; title: string };
    expect(picked.key).toBe('SUD-FTR-COOP');
    expect(picked.title).toBe('협동 모드');
  });
});
