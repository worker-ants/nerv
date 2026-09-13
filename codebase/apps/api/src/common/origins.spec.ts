// 우리 주소 둘과 걷힌 이름 — REQ-CB-036 · REQ-CB-037 (정본: docs/04-mvp/codebase.md §5.2)
//
// **이 스위트가 지키는 것은 "조용히 사라지지 않는다" 다.** `NERV_PUBLIC_URL` 만 적어 둔
// 배치가 기본값(`http://localhost:8080`)으로 떠 버리면, 운영자는 자기 설정이 읽히지 않는다는
// 사실을 그 주소로 서명된 쿠키를 받고서야 안다 — `NERV_LOG_LEVEL` 이 읽는 코드 0건인 채로
// 전표에 있던 것과 같은 부류의 침묵이다(방향만 반대다).

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORIGIN, apiUrlFromEnv, assertPublicUrlRetired, webUrlFromEnv } from './origins.js';

describe('NERV_WEB_URL · NERV_API_URL', () => {
  it('지정이 없으면 둘 다 개발 기본값이다 — 한 포트의 compose 앞문', () => {
    expect(apiUrlFromEnv({})).toBe(DEFAULT_ORIGIN);
    expect(webUrlFromEnv({})).toBe(DEFAULT_ORIGIN);
  });

  it('**서로 다른 값을 갖는다** — 한 이름이 두 뜻을 겸하지 않는다', () => {
    const env = {
      NERV_WEB_URL: 'https://app.nerv.example.com',
      NERV_API_URL: 'https://api.nerv.example.com',
    };
    expect(webUrlFromEnv(env)).toBe('https://app.nerv.example.com');
    expect(apiUrlFromEnv(env)).toBe('https://api.nerv.example.com');
  });

  it('빈 문자열은 미설정과 같다 — compose 가 빈 값을 넘기는 자리가 있다', () => {
    expect(apiUrlFromEnv({ NERV_API_URL: '' })).toBe(DEFAULT_ORIGIN);
    expect(webUrlFromEnv({ NERV_WEB_URL: '   ' })).toBe(DEFAULT_ORIGIN);
  });
});

describe('걷힌 이름 — NERV_PUBLIC_URL (REQ-CB-037)', () => {
  it('옛 이름이 없으면 아무 일도 하지 않는다', () => {
    expect(() => assertPublicUrlRetired({})).not.toThrow();
    expect(() => assertPublicUrlRetired({ NERV_API_URL: 'https://api.example.com' })).not.toThrow();
  });

  it('**옛 이름만 있으면 기동을 거부한다** — 기본값으로 떨어지지 않는다', () => {
    expect(() => assertPublicUrlRetired({ NERV_PUBLIC_URL: 'https://nerv.example.com' })).toThrow(
      /기동을 거부/,
    );
  });

  it('거부 문구가 **두 이름과 넣을 값**을 말한다 — 무엇을 어떻게 고치라는 문구여야 한다', () => {
    let message = '';
    try {
      assertPublicUrlRetired({ NERV_PUBLIC_URL: 'https://nerv.example.com' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('NERV_WEB_URL=https://nerv.example.com');
    expect(message).toContain('NERV_API_URL=https://nerv.example.com');
    expect(message).toContain(DEFAULT_ORIGIN); // 왜 기본값으로 떨어뜨리지 않는지까지
  });

  it('새 이름이 하나라도 있으면 거부하지 않되 **한 줄 남긴다** — 읽히지 않는 값이라고', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() =>
        assertPublicUrlRetired({
          NERV_PUBLIC_URL: 'https://old.example.com',
          NERV_API_URL: 'https://api.example.com',
        }),
      ).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain('https://old.example.com');
    } finally {
      warn.mockRestore();
    }
  });

  it('빈 값으로 남은 옛 이름은 설정이 아니다 — compose 의 `${VAR:-}` 가 그렇게 넘긴다', () => {
    expect(() => assertPublicUrlRetired({ NERV_PUBLIC_URL: '' })).not.toThrow();
  });
});
