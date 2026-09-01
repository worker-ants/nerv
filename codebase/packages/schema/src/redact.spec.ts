// 마스킹 — api.md §2.9 (REQ-API-065)
//
// **이건 눈으로 볼 수 없는 종류의 코드다.** 정규식이 맞는지 읽어서 알 수 없으므로 표로 적는다.
// 여기 없는 모양은 안 잡힌다고 봐야 한다 — 그것이 이 규칙의 한계이자 열람 권한이 필요한 이유다.

import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMIT,
  prepareHookPayload,
  redact,
  redactText,
  responseIsSecret,
  truncate,
} from './redact.js';

describe('이름이 말하는 비밀 — 열쇠로 잡는다', () => {
  it.each([
    ['api_key', 'sk-live-abcdefghijklmnop'],
    ['NERV_TOKEN', 'abc123'],
    ['password', 'hunter2'],
    ['private_key', '-----BEGIN X-----'],
    ['authorization', 'Bearer zzz'],
  ])('%s 는 값을 통째로 가린다', (key, value) => {
    const out = redact({ [key]: value }) as Record<string, string>;
    expect(out[key]).toContain('masked');
    expect(out[key]).not.toContain(value);
  });

  it('비밀이 아닌 열쇠는 건드리지 않는다 — 다 가리면 원문 보관의 뜻이 없다', () => {
    expect(redact({ command: 'pnpm -r test', file_path: 'src/a.ts' })).toEqual({
      command: 'pnpm -r test',
      file_path: 'src/a.ts',
    });
  });

  it('중첩된 곳도 훑는다 — 훅 페이로드는 평평하지 않다', () => {
    const out = redact({ tool_input: { env: { API_KEY: 'sk-live-abcdefghijklmnop' } } }) as {
      tool_input: { env: { API_KEY: string } };
    };
    expect(out.tool_input.env.API_KEY).toContain('masked');
  });
});

describe('모양이 말하는 비밀 — 이름이 없어도 잡는다', () => {
  it.each([
    ['sk-abcdefghijklmnopqrst', 'api_key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz01', 'github_token'],
    ['github_pat_11ABCDEFG0abcdefghijklm', 'github_token'],
    ['xoxb-1234567890-abcdefghij', 'slack_token'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws_key'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'jwt'],
  ])('%s → %s 로 가린다', (value, reason) => {
    const out = redactText(`값은 ${value} 이다`);
    expect(out).toContain(reason);
    expect(out).not.toContain(value);
  });

  it('PEM 블록은 통째로 사라진다 — 줄이 여럿이어도 한 덩어리다', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END RSA PRIVATE KEY-----';
    const out = redactText(`키:\n${pem}\n끝`);
    expect(out).not.toContain('AAAA');
    expect(out).toContain('private_key');
    expect(out).toContain('끝');
  });
});

describe('대입 — 이름은 남기고 값만 가린다', () => {
  it.each([
    ['NERV_TOKEN=abc123', 'NERV_TOKEN='],
    ['--token abc123', '--token'],
    ['--api-key=abc123', '--api-key='],
    ['Authorization: Bearer abc123', 'Authorization:'],
  ])('%s 에서 값만 사라진다', (text, keep) => {
    const out = redactText(text);
    expect(out).toContain(keep.trim().split('=')[0]!);
    expect(out).not.toContain('abc123');
  });

  it('주소의 비밀번호만 가리고 호스트는 남긴다 — 어디에 붙었는지는 사실이다', () => {
    const out = redactText('psql postgres://nerv:devpassword@localhost:5432/nerv');
    expect(out).not.toContain('devpassword');
    expect(out).toContain('localhost:5432/nerv');
    expect(out).toContain('postgres://nerv:');
  });

  it('평범한 명령은 그대로 남는다', () => {
    expect(redactText('pnpm -r test && git status')).toBe('pnpm -r test && git status');
  });
});

describe('파일 자체가 비밀인 것 — 내용에는 열쇠 이름이 없다', () => {
  it.each([
    ['Read', { file_path: '/repo/.env' }],
    ['Read', { file_path: '/home/me/.ssh/id_rsa' }],
    ['Read', { file_path: 'certs/server.pem' }],
    ['Bash', { command: 'cat .env.local' }],
    ['Bash', { command: 'env | grep TOKEN' }],
  ])('%s %o 는 응답을 통째로 가린다', (tool, input) => {
    expect(responseIsSecret(tool, input)).toBe(true);
  });

  it.each([
    ['Read', { file_path: 'src/index.ts' }],
    ['Bash', { command: 'pnpm -r test' }],
  ])('%s %o 는 그대로 남긴다', (tool, input) => {
    expect(responseIsSecret(tool, input)).toBe(false);
  });

  it('응답이 가려져도 무엇을 읽었는지는 남는다', () => {
    const out = prepareHookPayload({
      toolName: 'Read',
      toolInput: { file_path: '/repo/.env' },
      toolResponse: 'NERV_TOKEN=real-secret-value',
    });
    expect(JSON.stringify(out['tool_input'])).toContain('.env');
    expect(String(out['tool_response'])).toContain('secret_file');
    expect(JSON.stringify(out)).not.toContain('real-secret-value');
  });
});

describe('상한 — 끝을 남긴다', () => {
  it('상한 아래는 손대지 않는다', () => {
    expect(truncate('짧다')).toBe('짧다');
  });

  it('앞과 뒤를 남기고 가운데를 접는다 — 오류는 끝에 있다', () => {
    const text = `${'A'.repeat(FIELD_LIMIT)}ERROR_AT_THE_END`;
    const out = truncate(text);
    expect(out.length).toBeLessThan(text.length);
    expect(out).toContain('자 생략');
    // **끝이 남아야 한다** — 앞에서만 자르면 실패한 명령의 값어치가 사라진다
    expect(out.endsWith('ERROR_AT_THE_END')).toBe(true);
  });

  it('행 상한을 넘으면 응답부터 버린다 — 무엇을 했는가가 먼저다', () => {
    const out = prepareHookPayload({
      toolName: 'Bash',
      toolInput: { command: 'pnpm -r test' },
      // 필드 상한을 통과하는 조각 여럿으로 행 상한을 넘긴다
      toolResponse: Array.from({ length: 8 }, () => 'X'.repeat(FIELD_LIMIT - 1)),
    });
    expect(JSON.stringify(out['tool_input'])).toContain('pnpm -r test');
    expect(String(out['tool_response'])).toContain('row_limit');
  });
});
