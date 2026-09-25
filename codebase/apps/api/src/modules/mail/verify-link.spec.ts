// 확인 링크가 사람을 어디로 돌려보내는가 — REQ-WEB-089 · REQ-WEB-188
//
// 전에는 언제나 화면의 첫 주소였다. 초대 링크로 가입한 사람은 초대 화면이 아니라 홈에
// 떨어졌고, 소속이 없는 사람은 아무것도 할 수 없는 빈 홈에 섰다(2026-09-24 사람 보고).

import { describe, expect, it } from 'vitest';
import { resetPasswordLink, returnToOf, verifyEmailLink } from './verify-link.js';

const API = 'https://api.nerv.example.com';
const WEB = 'https://app.nerv.example.com';

function callbackOf(link: string): string | null {
  return new URL(link).searchParams.get('callbackURL');
}

describe('확인 링크의 돌아갈 자리', () => {
  it('요청이 정한 화면으로 돌아간다 — 초대에서 왔으면 그 초대로', () => {
    const link = verifyEmailLink({
      api: API,
      web: WEB,
      token: 't',
      returnTo: `${WEB}/invite/abc`,
    });
    expect(link.startsWith(`${API}/api/auth/verify-email?token=t&`)).toBe(true);
    expect(callbackOf(link)).toBe(`${WEB}/invite/abc`);
  });

  it('상대 경로는 화면 기준으로 편다 — API 호스트의 빈 페이지에 떨어지지 않게', () => {
    const link = verifyEmailLink({ api: API, web: WEB, token: 't', returnTo: '/onboarding' });
    expect(callbackOf(link)).toBe(`${WEB}/onboarding`);
  });

  it('정한 것이 없으면 화면의 첫 주소다', () => {
    expect(callbackOf(verifyEmailLink({ api: API, web: WEB, token: 't', returnTo: null }))).toBe(
      `${WEB}/`,
    );
  });

  it('화면 오리진 밖은 버린다 — 우리 도메인의 링크가 열린 리다이렉트가 되지 않게', () => {
    for (const returnTo of [
      'https://evil.example.com/x',
      '//evil.example.com/x',
      `${API}/api/me`,
      'javascript:alert(1)',
    ]) {
      expect(callbackOf(verifyEmailLink({ api: API, web: WEB, token: 't', returnTo }))).toBe(
        `${WEB}/`,
      );
    }
  });

  it('토큰은 인코딩한다', () => {
    const link = verifyEmailLink({ api: API, web: WEB, token: 'a+b/c', returnTo: null });
    expect(new URL(link).searchParams.get('token')).toBe('a+b/c');
  });
});

describe('better-auth 가 넘긴 링크에서 돌아갈 자리를 꺼낸다', () => {
  it('가입 경로의 모양 — 인코딩된 절대 주소', () => {
    const url = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent(`${WEB}/invite/abc`)}`;
    expect(returnToOf(url)).toBe(`${WEB}/invite/abc`);
  });

  it('정한 것이 없으면 better-auth 는 `/` 를 싣는다 — 그대로 꺼낸다', () => {
    expect(returnToOf(`${API}/api/auth/verify-email?token=t&callbackURL=%2F`)).toBe('/');
  });

  it('못 읽는 값은 null — 링크 하나 때문에 가입이 실패하지 않는다', () => {
    expect(returnToOf('not a url')).toBeNull();
  });
});

describe('비밀번호 재설정 링크 (2026-09-25 · REQ-API-187)', () => {
  it('API 가 토큰을 보고 화면의 /reset-password 로 돌려보낸다', () => {
    const link = resetPasswordLink({ api: `${API}/`, web: `${WEB}/`, token: 'tok_123' });
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(`${API}/api/auth/reset-password/tok_123`);
    expect(callbackOf(link)).toBe(`${WEB}/reset-password`);
  });

  it('토큰의 글자는 경로 안에서 깨지지 않는다', () => {
    const link = resetPasswordLink({ api: API, web: WEB, token: 'a/b?c' });
    expect(new URL(link).pathname).toBe('/api/auth/reset-password/a%2Fb%3Fc');
  });
});
