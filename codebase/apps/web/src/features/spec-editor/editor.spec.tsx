// 에디터의 계약 — 정본: screens.md §3.1~§3.2
//
// 여기서 지키는 것은 하나다: **나중에 도착한 본문이 화면에 뜬다.**
// 첫 렌더의 value 는 빈 문자열이다(쿼리가 아직 안 끝났다). 그때 만들어진 빈 문서가
// 그대로 남으면 스펙 상세 화면은 영영 백지다 — 실제로 그랬고, 그래서 이 테스트가 있다.

import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { SpecEditor } from './editor.js';

afterEach(cleanup);

/**
 * 편집기도 로케일 안에서 산다 — 소스 보기 토글의 문구가 카탈로그에서 온다.
 * rerender 도 같은 껍질을 다시 씌운다: 벗기면 Provider 가 사라져 두 번째 렌더가 터진다.
 */
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
    const { rerender } = render(<SpecEditor value="" readOnly onChange={() => undefined} />);
    expect(screen.getByTestId('editor-content').textContent).toBe('');

    rerender(
      <SpecEditor
        value={'# 웹챗 위젯\n\n- REQ-CWC-031 복원한다'}
        readOnly
        onChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('웹챗 위젯');
    });
    expect(screen.getByTestId('editor-content').querySelector('h1')).not.toBeNull();
  });

  it('같은 내용이 다시 흘러들어와도 문서를 갈아끼우지 않는다', async () => {
    // 부모가 draft 를 들고 있어 타이핑 결과가 value 로 되돌아온다 —
    // 그때마다 setContent 를 하면 한 글자마다 커서가 문서 앞으로 튄다.
    const markdown = '# 제목\n\n본문';
    const { rerender } = render(
      <SpecEditor value={markdown} readOnly={false} onChange={() => undefined} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('제목');
    });
    const before = screen.getByTestId('editor-content').querySelector('h1');

    rerender(<SpecEditor value={markdown} readOnly={false} onChange={() => undefined} />);

    // 같은 DOM 노드가 그대로 살아 있으면 문서를 새로 만들지 않았다는 뜻이다
    expect(screen.getByTestId('editor-content').querySelector('h1')).toBe(before);
  });

  it('편집기를 만드는 과정의 빈 갱신은 부모에게 올라가지 않는다', async () => {
    // 이게 새면 부모의 draft 가 빈 문자열로 굳고 `draft ?? body` 가 영영 빈 값이 된다 —
    // 스펙 본문이 화면에 안 뜨던 실제 결함이 정확히 이것이었다.
    const onChange = vi.fn();
    const { rerender } = render(<SpecEditor value="" readOnly onChange={onChange} />);
    rerender(<SpecEditor value={'# 제목\n\n본문'} readOnly onChange={onChange} />);
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('제목');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('편집 가능 상태로 만들어져도 빈 갱신이 부모의 draft 를 굳히지 않는다', async () => {
    // 부모(specs.$spec)는 데이터가 오기 전 doc_status 기본값이 'draft' 라 **editable 로**
    // 편집기를 만든다. 그때의 빈 갱신이 draft='' 로 굳으면 `draft ?? body` 가 빈 문자열을
    // 통과시켜 본문이 도착해도 화면은 백지다 — 실측으로 잡은 결함이다.
    const onChange = vi.fn();
    const { rerender } = render(<SpecEditor value="" readOnly={false} onChange={onChange} />);
    rerender(<SpecEditor value={'# 도착한 본문'} readOnly={false} onChange={onChange} />);
    await waitFor(() => {
      expect(screen.getByTestId('editor-content').textContent).toContain('도착한 본문');
    });
    // 사람이 친 적이 없으므로 부모는 아무것도 받지 않았어야 한다
    expect(onChange).not.toHaveBeenCalled();
  });

  it('소스 보기는 md 원문을 그대로 보인다 — 편집 경로는 없다(§3.1)', () => {
    render(<SpecEditor value={'# 제목'} readOnly onChange={() => undefined} />);
    expect(screen.queryByTestId('editor-source')).toBeNull();
    screen.getByRole('button', { name: '소스 보기' }).click();
  });
});
