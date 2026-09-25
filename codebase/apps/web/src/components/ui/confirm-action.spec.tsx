// 되돌리기 어려운 조작의 확인은 한 모양이다 (REQ-WEB-200 · screens.md §1.5)
//
// 모양만 같아서는 안 되고 **키 동작이 같아야** 한다 — 어느 단추는 Esc 로 닫히고 어느 단추는
// 안 닫히면, 사람은 다시 예측할 수 없게 된다. 이 파일은 그 동작을 컴포넌트 한 곳에서 본다.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../lib/i18n.js';
import { ConfirmAction } from './confirm-action.js';

/** 못 쓰는 단추인가 — 사유가 있으면 포커스가 남는 잠금(`aria-disabled`)이다(REQ-WEB-235) */
const isLocked = (b: Element | null | undefined): boolean =>
  b != null && ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');
/** 잠긴 단추의 사유 — hover·포커스의 말풍선과 aria-describedby 가 같은 값을 읽는다 */
const reasonOf = (b: Element | null | undefined): string | null =>
  b?.getAttribute('data-reason') ?? null;

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderAction(
  props: Partial<React.ComponentProps<typeof ConfirmAction>> = {},
): ReturnType<typeof vi.fn> {
  const onConfirm = vi.fn();
  render(
    <LocaleProvider locale="ko">
      <button type="button" data-testid="elsewhere">
        다른 곳
      </button>
      <ConfirmAction
        label="폐기"
        testId="thing"
        message="이 토큰을 폐기합니다 — 되돌릴 수 없습니다."
        confirmLabel="폐기"
        onConfirm={onConfirm}
        {...props}
      />
    </LocaleProvider>,
  );
  return onConfirm;
}

describe('ConfirmAction', () => {
  it('누르면 같은 자리에서 무엇이 일어나는지 말하고, 확인 전에는 실행하지 않는다', () => {
    const onConfirm = renderAction();
    fireEvent.click(screen.getByTestId('thing'));
    expect(screen.getByTestId('thing-confirming').textContent).toContain('되돌릴 수 없습니다');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('thing-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // 실행하면 단추로 돌아온다
    expect(screen.getByTestId('thing')).toBeDefined();
  });

  it('포커스는 [취소]에 간다 — 엔터를 연달아 눌러 실행되지 않게', () => {
    renderAction();
    fireEvent.click(screen.getByTestId('thing'));
    expect(document.activeElement).toBe(screen.getByTestId('thing-cancel'));
  });

  it('Esc 는 취소이고, 포커스가 누른 단추로 돌아온다', () => {
    const onConfirm = renderAction();
    fireEvent.click(screen.getByTestId('thing'));
    fireEvent.keyDown(screen.getByTestId('thing-cancel'), { key: 'Escape' });
    expect(screen.queryByTestId('thing-confirming')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('thing'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc 는 바깥(모달)까지 가지 않는다 — 확인만 닫힌다', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    renderAction();
    fireEvent.click(screen.getByTestId('thing'));
    fireEvent.keyDown(screen.getByTestId('thing-cancel'), { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
  });

  it('사유가 필요하면 비어 있는 동안 실행되지 않고, 쓴 사유를 넘긴다', () => {
    const onConfirm = renderAction({ reason: { label: '중단 사유' } });
    fireEvent.click(screen.getByTestId('thing'));
    // 사유 칸이 있으면 포커스는 그 칸이다
    expect(document.activeElement).toBe(screen.getByTestId('thing-reason'));
    expect((screen.getByTestId('thing-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('thing-reason'), { target: { value: ' 겹침 정리 ' } });
    fireEvent.click(screen.getByTestId('thing-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('겹침 정리');
  });

  it('잠긴 단추는 사유를 말하고, 켜진 단추에는 그 사유를 달지 않는다', () => {
    renderAction({ disabled: true, title: '조직 admin 만 합니다' });
    const thing = screen.getByTestId('thing');
    expect(isLocked(thing)).toBe(true);
    expect(reasonOf(thing)).toBe('조직 admin 만 합니다');
    // 사유가 키보드·보조기기에도 닿는다 — 포커스가 남고 설명으로 읽힌다(REQ-WEB-235)
    expect((thing as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById(thing.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      '조직 admin 만 합니다',
    );
    cleanup();
    renderAction({ title: '조직 admin 만 합니다' });
    expect(reasonOf(screen.getByTestId('thing'))).toBeNull();
    expect((screen.getByTestId('thing') as HTMLButtonElement).title).toBe('');
  });

  it('켜 둔 채 떠나면 거둔다 — 나중에 그 자리를 눌러 실행되지 않게', () => {
    vi.useFakeTimers();
    renderAction();
    fireEvent.click(screen.getByTestId('thing'));
    // 읽는 동안(포커스가 안에 있는 동안)은 그대로다
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByTestId('thing-confirming')).toBeDefined();
    screen.getByTestId('elsewhere').focus();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByTestId('thing-confirming')).toBeNull();
  });
});
