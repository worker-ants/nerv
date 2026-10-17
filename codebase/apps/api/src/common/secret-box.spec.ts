// L1 — 저장하는 비밀의 암호화(secret-box.ts · 2026-10-17 · 사람 결정 D2)
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptionKeyFromEnv, open, seal } from './secret-box.js';

describe('encryptionKeyFromEnv', () => {
  it('없으면 null — 기능이 꺼진다', () => {
    expect(encryptionKeyFromEnv({})).toBeNull();
    expect(encryptionKeyFromEnv({ NERV_ENCRYPTION_KEY: '  ' })).toBeNull();
  });

  it('base64 와 hex 를 모두 받는다', () => {
    const key = randomBytes(32);
    expect(encryptionKeyFromEnv({ NERV_ENCRYPTION_KEY: key.toString('base64') })).toEqual(key);
    expect(encryptionKeyFromEnv({ NERV_ENCRYPTION_KEY: key.toString('hex') })).toEqual(key);
  });

  it('32바이트가 아니면 던진다 — 조용히 꺼지지 않는다', () => {
    expect(() => encryptionKeyFromEnv({ NERV_ENCRYPTION_KEY: 'short' })).toThrow(/32바이트/);
  });
});

describe('seal · open', () => {
  const key = randomBytes(32);
  const url = 'https://hooks.slack.com/services/T000/B000/XXXX';

  it('왕복한다 · 같은 값도 매번 다른 암호문이다', () => {
    const a = seal(url, key);
    const b = seal(url, key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('hooks.slack.com');
    expect(open(a, key)).toBe(url);
  });

  it('다른 키나 망가진 값은 풀리지 않는다', () => {
    const sealed = seal(url, key);
    expect(() => open(sealed, randomBytes(32))).toThrow();
    const [v, iv, tag, body] = sealed.split(':');
    expect(() => open([v, iv, tag, `${body}AA`].join(':'), key)).toThrow();
    expect(() => open('v0:a:b:c', key)).toThrow(/형식/);
  });
});
