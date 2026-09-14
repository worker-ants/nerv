// 우리 주소 둘과 걷힌 이름 — REQ-CB-036 · REQ-CB-037 (정본: docs/04-mvp/codebase.md §5.2)
//
// **이 스위트가 지키는 것은 "조용히 사라지지 않는다" 다.** `NERV_PUBLIC_URL` 만 적어 둔
// 배치가 기본값(`http://localhost:8080`)으로 떠 버리면, 운영자는 자기 설정이 읽히지 않는다는
// 사실을 그 주소로 서명된 쿠키를 받고서야 안다 — `NERV_LOG_LEVEL` 이 읽는 코드 0건인 채로
// 전표에 있던 것과 같은 부류의 침묵이다(방향만 반대다).

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ORIGIN,
  apiUrlFromEnv,
  assertPublicUrlRetired,
  trustedOriginsFromEnv,
  webUrlFromEnv,
} from './origins.js';

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

describe('NERV_TRUSTED_ORIGINS — 여러 개를 어떻게 읽는가', () => {
  /** 경고를 세는 스위트가 여럿이라 묶는다. */
  function withWarn(run: (warn: ReturnType<typeof vi.spyOn>) => void): void {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      run(warn);
    } finally {
      warn.mockRestore();
    }
  }

  it('쉼표로 여러 개를 읽는다', () => {
    expect(
      trustedOriginsFromEnv({
        NERV_TRUSTED_ORIGINS: 'http://localhost:5173,https://app.example.com',
      }),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('**공백·줄바꿈도 구분자다** — ConfigMap 의 여러 줄 문자열이 그 모양이다', () => {
    expect(
      trustedOriginsFromEnv({
        NERV_TRUSTED_ORIGINS: '  http://localhost:5173\n  https://app.example.com\n',
      }),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('끝 슬래시·경로는 오리진으로 정규화하고 한 줄 남긴다 — 조용히 빗나가지 않게', () => {
    withWarn((warn) => {
      expect(
        trustedOriginsFromEnv({ NERV_TRUSTED_ORIGINS: 'https://app.example.com/admin' }),
      ).toEqual(['https://app.example.com']);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain('https://app.example.com/admin');
    });
  });

  it('**스킴 없는 값은 버린다** — `localhost:5173` 의 오리진은 문자열 "null" 이다', () => {
    withWarn((warn) => {
      // 그대로 넣으면 브라우저가 `Origin: null` 을 싣는 요청이 통과한다 —
      // 스킴을 빠뜨린 오타 하나가 CSRF 방어선에 구멍을 내는 자리다.
      const origins = trustedOriginsFromEnv({ NERV_TRUSTED_ORIGINS: 'localhost:5173' });
      expect(origins).toEqual([]);
      expect(origins).not.toContain('null');
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  it('버린 값도 한 줄 남긴다 — 없는 오리진을 열어 둔 줄 알면 안 된다', () => {
    withWarn((warn) => {
      expect(
        trustedOriginsFromEnv({ NERV_TRUSTED_ORIGINS: 'http://ok.example.com not a url' }),
      ).toEqual(['http://ok.example.com']);
      // 'not' · 'a' · 'url' 셋이 각각 버려진다
      expect(warn).toHaveBeenCalledTimes(3);
    });
  });

  it('중복은 한 번만 남는다', () => {
    expect(
      trustedOriginsFromEnv({
        NERV_TRUSTED_ORIGINS: 'https://app.example.com,https://app.example.com',
      }),
    ).toEqual(['https://app.example.com']);
  });

  it('미설정·빈 값은 빈 목록이다 — CSRF 방어선이라 기본은 비운다', () => {
    expect(trustedOriginsFromEnv({})).toEqual([]);
    expect(trustedOriginsFromEnv({ NERV_TRUSTED_ORIGINS: '' })).toEqual([]);
    expect(trustedOriginsFromEnv({ NERV_TRUSTED_ORIGINS: '  ,  ' })).toEqual([]);
  });

  it('**구성은 바꾸지 않는다** — 화면 주소를 자동으로 더하지 않는다(2단계의 몫)', () => {
    expect(trustedOriginsFromEnv({ NERV_WEB_URL: 'https://app.nerv.example.com' })).toEqual([]);
  });
});
