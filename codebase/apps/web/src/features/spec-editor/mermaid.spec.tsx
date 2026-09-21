// mermaid 다이어그램 — screens.md §3.1b · REQ-WEB-113 · REQ-WEB-169
//
// 사람 보고(2026-08-30): "스펙 문서에서 에이전트가 아스키 아트로 다이어그램을 그리고 있다".
// 저장은 이미 되고 있었다 — 왕복에서 ```mermaid 펜스는 언어 태그까지 무손실이다.
// 빠져 있던 것은 **그리는 쪽**이다.
//
// 사람 보고(2026-09-21): "본문의 머메이드가 렌더링되어 보였으면 좋겠다". 렌더러는 있었는데
// **초안에서 켜지지 않았다** — 조건이 `!editor.isEditable` 이었고 그 값은 "이 문서가
// 초안인가" 이지 "내가 지금 치고 있는가" 가 아니다. 그런데 초안이야말로 에이전트가
// 다이어그램을 써 넣는 자리다. 이 파일이 지키는 것은 그 뒤집힌 기본값이다.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// **`readOnly` 인자가 없다**(2026-09-22 · REQ-WEB-173) — 웹의 본문은 언제나 읽기 전용이다.
// 이 파일의 "초안에서도 그림이다" 는 이제 구조가 보장한다: 가를 축 자체가 사라졌다.
function draw(value: string): void {
  render(
    <LocaleProvider locale="ko">
      <SpecEditor value={value} />
    </LocaleProvider>,
  );
}

describe('mermaid 블록', () => {
  it('읽을 때는 그림이다 — 아스키 아트를 그릴 이유가 없어진다', async () => {
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
    expect(screen.getByTestId('mermaid-figure').querySelector('svg')).toBeTruthy();
  });

  it('초안에서도 그림이다 — 초안이야말로 다이어그램이 써지는 자리다', async () => {
    // 이 한 줄이 2026-09-21 보고의 전부다: 예전에는 편집 가능한 문서면 코드로 남았고,
    // `editable` 은 역할이 아니라 **문서 상태**(draft + 리스 없음)라 초안을 **읽는**
    // 사람에게도 코드가 보였다.
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
  });

  it('[코드]를 누르면 원본이 서고, 다시 누르면 그림으로 돌아온다', async () => {
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mermaid-toggle'));
    expect(screen.queryByTestId('mermaid-figure')).toBeNull();
    // **고칠 수 있는 자리가 곧 보이는 자리다** — 원본은 편집기의 내용으로 선다
    expect(screen.getByTestId('editor-content').textContent).toContain('graph TD');

    fireEvent.click(screen.getByTestId('mermaid-toggle'));
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
  });

  it('mermaid 가 아닌 코드블록은 건드리지 않는다', async () => {
    draw('# 제목\n\n```ts\nconst x = 1;\n```\n');
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    expect(screen.queryByTestId('mermaid-figure')).toBeNull();
    expect(screen.getByTestId('editor-content').textContent).toContain('const x = 1;');
    // 토글도 붙지 않는다 — 그릴 것이 없는 블록에 서는 단추는 잡음이다
    expect(screen.queryByTestId('mermaid-toggle')).toBeNull();
  });

  it('문법이 깨지면 코드를 감추지 않는다 — 그림도 글도 없는 자리를 만들지 않는다', async () => {
    draw('# 제목\n\n```mermaid\n망가진 문법\n```\n');
    await waitFor(() => expect(screen.getByTestId('mermaid-failed')).toBeTruthy());
    expect(screen.getByTestId('editor-content').textContent).toContain('망가진 문법');
  });
});

// ── 배율과 전체화면 — 2026-09-22 사람 보고 (REQ-WEB-172) ─────────────────────
//
// "github 과 같이 확대·축소 컨트롤 패널이 있는 게 좋지 않을까". 기전은 mermaid 의
// `useMaxWidth` 기본값(`true`)이다 — 출력 SVG 가 **언제나 담긴 칸 폭에 맞춰 줄어들어**
// 노드가 많은 다이어그램은 글자를 읽을 수 없었고, 상자의 `overflow-x-auto` 는 넘칠 일이
// 없어 한 번도 동작하지 않았다.

describe('배율과 전체화면', () => {
  it('처음은 100% 이고, 키우면 그 값이 컨트롤에 적힌다', async () => {
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
    // 몇 번 눌렀는지 세게 하지 않는다 — 지금 배율이 숫자로 서 있다
    expect(screen.getByTestId('mermaid-zoom-fit').textContent).toBe('100%');

    fireEvent.click(screen.getByTestId('mermaid-zoom-in'));
    expect(screen.getByTestId('mermaid-zoom-fit').textContent).toBe('125%');

    fireEvent.click(screen.getByTestId('mermaid-zoom-fit'));
    expect(screen.getByTestId('mermaid-zoom-fit').textContent).toBe('100%');
  });

  it('전체화면은 새 탭이 아니라 이 문서 위에 선다 — 읽던 자리를 잃지 않는다', async () => {
    draw(DIAGRAM);
    await waitFor(() => expect(screen.getByTestId('mermaid-figure')).toBeTruthy());
    expect(screen.queryByTestId('mermaid-fullscreen')).toBeNull();

    fireEvent.click(screen.getByTestId('mermaid-fullscreen-toggle'));
    const full = screen.getByTestId('mermaid-fullscreen');
    expect(within(full).getByTestId('mermaid-figure-full')).toBeTruthy();

    // 배율은 **각자 기억한다** — 전체화면에서 키운 값이 닫은 뒤 좁은 칸에 남으면
    // 사람이 한 적 없는 일이 일어난 것으로 보인다
    fireEvent.click(within(full).getByTestId('mermaid-zoom-in'));
    expect(within(full).getByTestId('mermaid-zoom-fit').textContent).toBe('125%');
    fireEvent.click(within(full).getByTestId('mermaid-fullscreen-toggle'));
    expect(screen.queryByTestId('mermaid-fullscreen')).toBeNull();
    expect(screen.getByTestId('mermaid-zoom-fit').textContent).toBe('100%');
  });

  it('그림이 없으면 배율 컨트롤도 없다 — 조절할 것이 없는 자리의 단추는 잡음이다', async () => {
    draw('# 제목\n\n```mermaid\n망가진 문법\n```\n');
    await waitFor(() => expect(screen.getByTestId('mermaid-failed')).toBeTruthy());
    expect(screen.queryByTestId('mermaid-zoom-in')).toBeNull();
  });
});
