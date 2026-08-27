// 웹 로케일 — 카탈로그가 아니라 **전환이 실제로 되는지**를 본다.
//
// 카탈로그의 정합(키 집합·자리표시자)은 `@nerv/schema` 쪽 테스트가 지킨다. 여기서 지키는 것은
// 웹에서만 틀릴 수 있는 것들이다: 고르는 순서 · 기억 · 서버에 알리기.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptLanguageHeader, initialLocale, LocaleProvider, useLocale, useT } from './i18n.js';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Probe(): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t('shell.inbox')}</span>
      <span data-testid="params">{t('inbox.waited.minutes', { n: 5 })}</span>
      <button type="button" onClick={() => setLocale('en')}>
        en
      </button>
    </div>
  );
}

describe('언어 전환', () => {
  it('로케일에 따라 다른 문장을 그린다', () => {
    render(
      <LocaleProvider locale="ko">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('text').textContent).toBe('받은 요청');

    cleanup();
    render(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('text').textContent).toBe('Inbox');
  });

  it('자리표시자는 로케일마다 제 어순으로 들어간다', () => {
    render(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );
    // ko 는 "5분 대기", en 은 "waiting 5m" — 값의 자리가 다르다
    expect(screen.getByTestId('params').textContent).toBe('waiting 5m');
  });

  it('고른 언어는 다음 방문에도 남는다', () => {
    render(
      <LocaleProvider locale="ko">
        <Probe />
      </LocaleProvider>,
    );
    screen.getByRole('button', { name: 'en' }).click();
    expect(localStorage.getItem('nerv.locale')).toBe('en');
    // 브라우저 언어가 무엇이든 고른 값이 이긴다 — 고른 적 있다는 사실을 배신하지 않는다
    expect(initialLocale()).toBe('en');
  });

  it('<html lang> 이 따라간다 — 스크린리더가 한국어를 영어처럼 읽지 않게', () => {
    render(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
  });

  it('서버에도 같은 언어를 알린다 — 화면은 영어인데 에러만 한국어인 상태를 막는다', () => {
    render(
      <LocaleProvider locale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(acceptLanguageHeader()).toBe('en,ko;q=0.8');
  });

  it('Provider 밖에서 부르면 조용히 넘어가지 않는다', () => {
    // 조용히 기본 로케일로 넘어가면 화면 일부만 전환을 따르지 않는 버그가 되고,
    // 그건 눈으로 찾기 어렵다
    expect(() => render(<Probe />)).toThrow(/LocaleProvider/);
  });
});
