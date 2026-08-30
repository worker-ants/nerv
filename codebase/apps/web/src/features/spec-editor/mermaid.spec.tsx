// mermaid 다이어그램 — screens.md §3.1b · REQ-WEB-113
//
// 사람 보고(2026-08-30): "스펙 문서에서 에이전트가 아스키 아트로 다이어그램을 그리고 있다".
// 저장은 이미 되고 있었다 — 왕복에서 ```mermaid 펜스는 언어 태그까지 무손실이다.
// 빠져 있던 것은 **그리는 쪽**이다.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { SpecEditor } from './editor.js';

// 실제 mermaid 는 레이아웃을 재는데 jsdom 에는 그것이 없다 — 계약(호출 → svg)만 흉내 낸다
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => {
      if (code.includes('망가진')) throw new Error('parse error');
      return { svg: '<svg data-testid="drawn"><title>도형</title></svg>' };
    }),
  },
}));

const DIAGRAM = '# 제목\n\n```mermaid\ngraph TD\n  A-->B\n```\n';

afterEach(cleanup);

function draw(value: string, readOnly = true): void {
  render(
    <LocaleProvider locale="ko">
      <SpecEditor value={value} readOnly={readOnly} onChange={() => undefined} />
    </LocaleProvider>,
  );
}

describe('mermaid 블록', () => {
  it('읽을 때는 그림이다 — 아스키 아트를 그릴 이유가 없어진다', async () => {
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
    expect(screen.getByTestId('mermaid-figure').querySelector('svg')).toBeTruthy();
  });

  it('편집 중에는 코드 그대로다 — 타이핑 중의 문법은 대개 깨져 있다', async () => {
    draw(DIAGRAM, false);
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    expect(screen.queryByTestId('mermaid-figure')).toBeNull();
    expect(screen.getByTestId('editor-content').textContent).toContain('graph TD');
  });

  it('mermaid 가 아닌 코드블록은 건드리지 않는다', async () => {
    draw('# 제목\n\n```ts\nconst x = 1;\n```\n');
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    expect(screen.queryByTestId('mermaid-figure')).toBeNull();
    expect(screen.getByTestId('editor-content').textContent).toContain('const x = 1;');
  });

  it('문법이 깨지면 코드를 감추지 않는다 — 그림도 글도 없는 자리를 만들지 않는다', async () => {
    draw('# 제목\n\n```mermaid\n망가진 문법\n```\n');
    await waitFor(() => expect(screen.getByTestId('mermaid-failed')).toBeTruthy());
    expect(screen.getByTestId('editor-content').textContent).toContain('망가진 문법');
  });
});
