// 메일 설정과 백오프 — 정본: docs/04-mvp/codebase.md §5.2 · database.md §2.17
//
// **여기서 지키는 것은 "비어 있으면 꺼진다" 하나다.** 이 판정이 틀리면 둘 중 하나가 된다 —
// 메일이 꺼진 배치에서 보낼 수 없는 줄이 조용히 쌓이거나(메일을 켠 날 몇 달 치가 한꺼번에
// 나간다), 켠 배치에서 아무것도 나가지 않는다. 스위치는 `NERV_MAIL_HOST` 다(2026-09-24).

import { describe, expect, it } from 'vitest';
import { MAIL_MAX_ATTEMPTS } from '@nerv/schema';
import { backoffMinutes } from './mail.outbox.js';
import {
  assertMailConfig,
  assertSmtpUrlRetired,
  mailDryRunFromEnv,
  mailEnabled,
  mailFromFromEnv,
  requireEmailVerificationFromEnv,
  smtpAuthFromEnv,
  smtpHostFromEnv,
  smtpPortFromEnv,
  smtpSecureFromEnv,
  smtpTransportFromEnv,
} from './mail.config.js';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values;

describe('메일 설정 (codebase.md §5.2)', () => {
  it('비어 있으면 꺼진다 — 없는 키도, 빈 문자열도, 공백도 같다', () => {
    expect(mailEnabled(env({}))).toBe(false);
    expect(mailEnabled(env({ NERV_MAIL_HOST: '' }))).toBe(false);
    // 공백만 넣은 것은 "설정했다" 가 아니다 — `.env` 의 흔한 사고다
    expect(mailEnabled(env({ NERV_MAIL_HOST: '   ' }))).toBe(false);
  });

  it('호스트가 있으면 켜지고, 앞뒤 공백은 걷는다', () => {
    expect(mailEnabled(env({ NERV_MAIL_HOST: 'mailpit' }))).toBe(true);
    expect(smtpHostFromEnv(env({ NERV_MAIL_HOST: ' smtp.example.com ' }))).toBe('smtp.example.com');
  });

  it('호스트만으로 전송 설정이 선다 — 나머지 넷은 기본값이 있다', () => {
    expect(smtpTransportFromEnv(env({ NERV_MAIL_HOST: 'mailpit' }))).toEqual({
      host: 'mailpit',
      port: 587,
      secure: false,
      auth: null,
    });
    expect(smtpTransportFromEnv(env({}))).toBeNull();
  });

  it('마른 실행은 명시적으로 켠 때만이다 — 오타는 꺼짐이다', () => {
    expect(mailDryRunFromEnv(env({ NERV_MAIL_DRY_RUN: 'true' }))).toBe(true);
    expect(mailDryRunFromEnv(env({ NERV_MAIL_DRY_RUN: 'TRUE' }))).toBe(true);
    expect(mailDryRunFromEnv(env({ NERV_MAIL_DRY_RUN: 'yes' }))).toBe(false);
    expect(mailDryRunFromEnv(env({}))).toBe(false);
  });

  it('꺼진 배치는 보내는 사람이 없어도 뜬다 — 검증할 것이 없다', () => {
    expect(() => assertMailConfig(env({}))).not.toThrow();
    expect(mailFromFromEnv(env({}))).toBeNull();
  });

  it('켜 놓고 보내는 사람을 비우면 기동을 거부한다', () => {
    // "보냈다고 믿는데 닿지 않는" 배치가 조용히 서는 것보다 뜨지 않는 편이 싸다.
    // 문구는 무엇을 넣어야 하는지까지 말한다 — 거부만 하고 길을 주지 않는 것이 막다른 길이다.
    expect(() => assertMailConfig(env({ NERV_MAIL_HOST: 'smtp.x' }))).toThrow(/NERV_MAIL_FROM/);
  });

  it('둘 다 있으면 통과한다', () => {
    expect(() =>
      assertMailConfig(env({ NERV_MAIL_HOST: 'smtp.x', NERV_MAIL_FROM: 'NERV <a@b.c>' })),
    ).not.toThrow();
  });
});

describe('접속 정보 여섯 키 (2026-09-24 · 사람 결정)', () => {
  const on = { NERV_MAIL_HOST: 'smtp.x', NERV_MAIL_FROM: 'NERV <a@b.c>' };

  it('포트를 비우면 587 이다 — 25 는 사업자가 막아 둔 릴레이 포트다', () => {
    expect(smtpPortFromEnv(env({}))).toBe(587);
    expect(smtpPortFromEnv(env({ NERV_MAIL_PORT: '465' }))).toBe(465);
  });

  it('포트를 읽을 수 없으면 기본값으로 떨어지지 않고 기동을 거부한다', () => {
    // 조용히 587 로 가면 운영자는 자기 오타를 영영 모른다.
    for (const bad of ['오륙오', '0', '-1', '65536', '587.5']) {
      expect(() => assertMailConfig(env({ ...on, NERV_MAIL_PORT: bad }))).toThrow(/NERV_MAIL_PORT/);
    }
  });

  // **쪼개기를 미루던 시절의 반대 이유가 정확히 이 값이었다** — "사람은 대개 TLS 를 틀린다".
  // 그래서 기본값을 두지 않고 포트를 따르게 한다. 이 유도가 깨지면 그 걱정이 현실이 된다.
  it('TLS 를 비우면 포트에서 유도한다 — 465 만 암묵 TLS 다', () => {
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '465' }))).toBe(true);
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '587' }))).toBe(false);
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '25' }))).toBe(false);
    expect(smtpSecureFromEnv(env({}))).toBe(false);
  });

  it('명시하면 그 값이 이긴다 — 비표준 포트에서 암묵 TLS 를 받는 게이트웨이가 있다', () => {
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '2465', NERV_MAIL_SECURE: 'true' }))).toBe(true);
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '465', NERV_MAIL_SECURE: 'false' }))).toBe(
      false,
    );
    // 오타는 명시가 아니다 — 유도로 떨어진다(`NERV_MAIL_DRY_RUN` 과 같은 규약).
    expect(smtpSecureFromEnv(env({ NERV_MAIL_PORT: '465', NERV_MAIL_SECURE: 'yes' }))).toBe(true);
  });

  it('인증은 둘 다 있거나 둘 다 없다', () => {
    expect(smtpAuthFromEnv(env({}))).toBeNull();
    expect(smtpAuthFromEnv(env({ NERV_MAIL_USER: 'u', NERV_MAIL_PASS: 'p' }))).toEqual({
      user: 'u',
      pass: 'p',
    });
  });

  it('한쪽만 설정하면 기동을 거부한다 — 인증 없이 붙는 것을 아무도 모른다', () => {
    expect(() => assertMailConfig(env({ ...on, NERV_MAIL_USER: 'u' }))).toThrow(/NERV_MAIL_USER/);
    expect(() => assertMailConfig(env({ ...on, NERV_MAIL_PASS: 'p' }))).toThrow(/NERV_MAIL_PASS/);
    expect(() =>
      assertMailConfig(env({ ...on, NERV_MAIL_USER: 'u', NERV_MAIL_PASS: 'p' })),
    ).not.toThrow();
  });
});

describe('걷힌 이름 — NERV_SMTP_URL (REQ-CB-050)', () => {
  it('새 이름이 없으면 기동을 거부하고, 옮겨 적을 값을 문구가 풀어 준다', () => {
    let thrown: Error | null = null;
    try {
      assertSmtpUrlRetired(env({ NERV_SMTP_URL: 'smtps://bob:s3cret@smtp.example.com:465' }));
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    // 거부만 하고 길을 주지 않는 것이 막다른 길이다 — 여섯 키를 값과 함께 적어 준다.
    expect(thrown?.message).toContain('NERV_MAIL_HOST=smtp.example.com');
    expect(thrown?.message).toContain('NERV_MAIL_PORT=465');
    expect(thrown?.message).toContain('NERV_MAIL_SECURE=true');
    expect(thrown?.message).toContain('NERV_MAIL_USER=bob');
    // **비밀번호는 문구에 싣지 않는다** — 기동 로그를 읽는 사람이 곧 그 릴레이를 쓸 수 있는
    // 사람이 된다. 어디서 가져오라는 말만 남긴다.
    expect(thrown?.message).not.toContain('s3cret');
  });

  it('URL 을 파싱하지 못해도 거부는 그대로다 — 키 이름만 적어 준다', () => {
    expect(() => assertSmtpUrlRetired(env({ NERV_SMTP_URL: '호스트' }))).toThrow(/NERV_MAIL_HOST/);
  });

  it('새 이름이 있으면 뜨되 읽지 않는 값이라고 한 줄 남긴다', () => {
    expect(() =>
      assertSmtpUrlRetired(env({ NERV_SMTP_URL: 'smtp://old:25', NERV_MAIL_HOST: 'smtp.x' })),
    ).not.toThrow();
  });

  it('없으면 아무 일도 하지 않는다 — compose 가 빈 문자열로 넘기는 것이 정상 경로다', () => {
    expect(() => assertSmtpUrlRetired(env({}))).not.toThrow();
    expect(() => assertSmtpUrlRetired(env({ NERV_SMTP_URL: '' }))).not.toThrow();
  });

  it('엔트리가 부르는 메일 검사 하나가 이것을 포함한다 — api·worker 둘 다', () => {
    expect(() => assertMailConfig(env({ NERV_SMTP_URL: 'smtp://old:25' }))).toThrow(/걷힌 이름/);
  });
});

describe('재시도 간격', () => {
  it('2의 거듭제곱이다 — 1 · 2 · 4 · 8 · 16분', () => {
    expect([1, 2, 3, 4, 5].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16]);
  });

  it('상한까지 걸리는 시간이 31분이다 — 잠깐 막힌 서버가 돌아오면 그 안에 나간다', () => {
    const total = Array.from({ length: MAIL_MAX_ATTEMPTS }, (_, i) => backoffMinutes(i + 1)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBe(31);
  });

  it('0회에서도 음수가 되지 않는다 — 과거로 미는 간격은 즉시 재시도다', () => {
    expect(backoffMinutes(0)).toBeGreaterThan(0);
  });
});

describe('가입 이메일 인증 강제 (2026-09-22 · 사람 결정)', () => {
  // **강제는 메일을 보낼 수 있을 때만 성립한다.** 그래서 기본값을 메일 설정에서 유도한다 —
  // 이 유도가 없으면 둘 중 하나가 된다: 메일을 붙인 배치가 강제되지 않거나(결정과 다르다),
  // 메일이 없는 배치가 아무도 가입하지 못하는 서버가 된다.
  it('비어 있으면 메일 설정을 따른다 — 메일이 있으면 강제, 없으면 아니다', () => {
    expect(requireEmailVerificationFromEnv(env({}))).toBe(false);
    expect(requireEmailVerificationFromEnv(env({ NERV_MAIL_HOST: 'smtp.x' }))).toBe(true);
  });

  it('명시하면 그 값이 이긴다 — 메일을 쓰면서 가입은 막지 않는 배치가 있을 수 있다', () => {
    expect(
      requireEmailVerificationFromEnv(
        env({ NERV_MAIL_HOST: 'smtp.x', NERV_REQUIRE_EMAIL_VERIFICATION: 'false' }),
      ),
    ).toBe(false);
    expect(requireEmailVerificationFromEnv(env({ NERV_REQUIRE_EMAIL_VERIFICATION: 'true' }))).toBe(
      true,
    );
  });

  it('메일 없이 강제를 켜면 기동을 거부한다 — 아무도 가입하지 못하는 서버다', () => {
    expect(() => assertMailConfig(env({ NERV_REQUIRE_EMAIL_VERIFICATION: 'true' }))).toThrow(
      /NERV_MAIL_HOST/,
    );
  });

  it('메일도 강제도 없는 배치는 그대로 뜬다 — 오늘까지의 동작이다', () => {
    expect(() => assertMailConfig(env({}))).not.toThrow();
  });
});
