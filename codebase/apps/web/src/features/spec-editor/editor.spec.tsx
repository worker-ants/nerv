// 에디터의 계약 — 정본: screens.md §3.1~§3.2
//
// **2026-09-22 부터 이 컴포넌트는 읽기만 한다**(사람 결정 · REQ-WEB-173). 웹에서 본문을
// 고치는 경로를 걷어냈으므로 `onChange`·`readOnly`·자체 소스 토글·링크 고르개가 함께
// 사라졌다 — 본문은 에이전트가 쓰고, 보는 방식(뷰어·소스)은 라우트의 탭이 가른다.
//
// 그래도 지켜야 하는 것 하나는 그대로다: **나중에 도착한 본문이 화면에 뜬다.**
// 첫 렌더의 value 는 빈 문자열이다(쿼리가 아직 안 끝났다). 그때 만들어진 빈 문서가
// 그대로 남으면 스펙 상세 화면은 영영 백지다 — 실제로 그랬고, 그래서 이 테스트가 있다.

import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { SpecEditor } from './editor.js';

afterEach(cleanup);

/** rerender 도 같은 껍질을 다시 씌운다 — 벗기면 Provider 가 사라져 두 번째 렌더가 터진다 */
function render(ui: React.ReactElement) {
  const result = rtlRender(<LocaleProvider locale="ko">{ui}</LocaleProvider>);
  return {
    ...result,
    rerender: (next: React.ReactElement) =>
      result.rerender(<LocaleProvider locale="ko">{next}</LocaleProvider>),
  };
}

describe('SpecEditor 본문 동기화', () => {
  it('빈 값으로 만들어진 뒤 본문이 도착하면 화면에 뜬다', async () => {
    const { rerender } = render(<SpecEditor value="" />);
    expect(screen.getByTestId('editor-content').textContent).toBe('');

    rerender(<SpecEditor value={'# 웹챗 위젯\n\n- REQ-CWC-031 복원한다'} />);

    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('웹챗 위젯');
    });
    expect(screen.getByTestId('editor-content').querySelector('h1')).not.toBeNull();
  });

  it('같은 내용이 다시 흘러들어와도 문서를 갈아끼우지 않는다', async () => {
    const markdown = '# 제목\n\n본문';
    const { rerender } = render(<SpecEditor value={markdown} />);
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('제목');
    });
    const before = screen.getByTestId('editor-content').querySelector('h1');

    rerender(<SpecEditor value={markdown} />);

    // 같은 DOM 노드가 그대로 살아 있으면 문서를 새로 만들지 않았다는 뜻이다
    expect(screen.getByTestId('editor-content').querySelector('h1')).toBe(before);
  });
});

describe('읽기만 한다 (REQ-WEB-173)', () => {
  it('본문은 편집 가능한 면이 아니다', async () => {
    render(<SpecEditor value={'# 제목\n\n본문'} />);
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('제목');
    });
    const surface = screen.getByTestId('editor-content').querySelector('.ProseMirror');
    expect(surface?.getAttribute('contenteditable')).toBe('false');
  });

  it('편집 경로의 조작이 하나도 없다 — 소스 토글도 링크 고르개도', async () => {
    render(<SpecEditor value={'# 제목'} />);
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('제목');
    });
    // 소스는 이제 **라우트의 탭**이다(`body-tab-source`) — 편집기 안의 토글이 아니다
    expect(screen.queryByTestId('editor-source')).toBeNull();
    expect(screen.queryByTestId('editor-link-spec')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
