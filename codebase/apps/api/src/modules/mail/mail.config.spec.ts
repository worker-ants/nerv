// 메일 설정과 백오프 — 정본: docs/04-mvp/codebase.md §5.2 · database.md §2.17
//
// **여기서 지키는 것은 "비어 있으면 꺼진다" 하나다.** 이 판정이 틀리면 둘 중 하나가 된다 —
// 메일이 꺼진 배치에서 보낼 수 없는 줄이 조용히 쌓이거나(SMTP 를 켠 날 몇 달 치가 한꺼번에
// 나간다), 켠 배치에서 아무것도 나가지 않는다.

import { describe, expect, it } from 'vitest';
import { MAIL_MAX_ATTEMPTS } from '@nerv/schema';
import { backoffMinutes } from './mail.outbox.js';
import {
  assertMailConfig,
  mailDryRunFromEnv,
  mailEnabled,
  mailFromFromEnv,
  smtpUrlFromEnv,
} from './mail.config.js';

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values;

describe('메일 설정 (codebase.md §5.2)', () => {
  it('비어 있으면 꺼진다 — 없는 키도, 빈 문자열도, 공백도 같다', () => {
    expect(mailEnabled(env({}))).toBe(false);
    expect(mailEnabled(env({ NERV_SMTP_URL: '' }))).toBe(false);
    // 공백만 넣은 것은 "설정했다" 가 아니다 — `.env` 의 흔한 사고다
    expect(mailEnabled(env({ NERV_SMTP_URL: '   ' }))).toBe(false);
  });

  it('값이 있으면 켜지고, 앞뒤 공백은 걷는다', () => {
    expect(mailEnabled(env({ NERV_SMTP_URL: 'smtp://mailpit:1025' }))).toBe(true);
    expect(smtpUrlFromEnv(env({ NERV_SMTP_URL: ' smtp://x:25 ' }))).toBe('smtp://x:25');
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
    expect(() => assertMailConfig(env({ NERV_SMTP_URL: 'smtp://x:25' }))).toThrow(/NERV_MAIL_FROM/);
  });

  it('둘 다 있으면 통과한다', () => {
    expect(() =>
      assertMailConfig(env({ NERV_SMTP_URL: 'smtp://x:25', NERV_MAIL_FROM: 'NERV <a@b.c>' })),
    ).not.toThrow();
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
