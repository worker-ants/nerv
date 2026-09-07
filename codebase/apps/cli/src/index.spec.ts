// `nerv import <kind>` 인자 파싱 — 정본: docs/04-mvp/importer.md §3.1
//
// **명령 이름에도 검사가 필요하다.** 정본·이 CLI 의 usage 문구·배포된 스킬이 전부
// `nerv import spec …` 이라고 말하는 동안 파서만 그 낱말을 몰랐고, 아무 테스트도 그것을
// 부르지 않아 **아무도 몰랐다**(2026-09-06 대조). 지시대로 친 사람이 받은 것은 usage
// 에러였고, 그 에러가 다시 되지 않는 형태를 알려 줬다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseArgs } from './index.js';
import { NERV_ERROR } from '@nerv/schema';
import { setLocaleForTesting } from './i18n.js';

describe('nerv import <kind> (§3.1)', () => {
  it('정본이 적은 형태가 그대로 돈다', () => {
    const options = parseArgs(['import', 'spec', '--root', '/tmp/x', '--project', 'clemvion']);
    expect(options.command).toBe('spec');
    expect(options.root).toBe('/tmp/x');
    expect(options.project).toBe('clemvion');
    expect(options.apply).toBe(false);
  });

  it.each(['spec', 'plan', 'review', 'docs', 'rebuild-map'])('%s 를 받는다', (command) => {
    expect(parseArgs(['import', command, '--project', 'p']).command).toBe(command);
  });

  it('`import` 을 빠뜨리면 무엇이 빠졌는지 말한다 — usage 만 던지지 않는다', () => {
    setLocaleForTesting('ko');
    expect(() => parseArgs(['spec', '--project', 'p'])).toThrow(/import spec/);
    setLocaleForTesting(null);
  });

  it('모르는 명령은 usage 다', () => {
    expect(() => parseArgs(['import', 'nonsense'])).toThrow();
    expect(() => parseArgs([])).toThrow();
  });

  it('--apply 는 서버와 토큰을 요구한다 — dry-run 만 맨몸으로 돈다(REQ-IMP-011)', () => {
    expect(() => parseArgs(['import', 'spec', '--project', 'p', '--apply'])).toThrow();
  });

  it('docs 는 nerv-docs 프로파일이 기본이다(§5 도그푸딩)', () => {
    expect(parseArgs(['import', 'docs', '--project', 'p']).profile).toBe('nerv-docs');
    expect(parseArgs(['import', 'spec', '--project', 'p']).profile).toBe('clemvion');
  });
});

/**
 * **리포트 없이 죽지 않는다**(2026-09-07 · REQ-IMP-025).
 *
 * 가장 흔한 실패 둘 — 토큰 만료·권한 부족과 프로파일 이름 오타 — 이 예외로 그대로 나가면
 * 종료 코드가 1 이 되고, 그것은 이 CLI 의 어휘에서 **"완료했으나 수동 확인"** 이다.
 * 아무것도 적재되지 않았는데 그렇게 읽히면 다음 사람은 있지도 않은 리포트를 뒤진다.
 */
describe('중단은 중단으로 보고한다 (REQ-IMP-025)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nerv-exit-'));
    mkdirSync(join(root, 'spec'), { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('모르는 프로파일은 종료 코드 2 이고 리포트가 남는다', async () => {
    const reportDir = join(root, 'report');
    const code = await main([
      'import',
      'spec',
      '--profile',
      'no-such-profile',
      '--root',
      root,
      '--project',
      'p',
      '--report-dir',
      reportDir,
    ]);
    expect(code).toBe(2);
    const jsonl = readFileSync(join(reportDir, 'report.jsonl'), 'utf8');
    expect(jsonl).toContain('profile-invalid');
    expect(jsonl).toContain('aborted');
  });

  it('401 은 종료 코드 2 이고 권한을 넓히려 재시도하지 않는다', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      return {
        ok: false,
        status: 401,
        json: async () => ({ ok: false, code: NERV_ERROR.UNAUTHENTICATED, message: '만료' }),
      };
    });
    writeFileSync(join(root, 'spec', 'a.md'), '---\nid: SPC-A\n---\n\n# A\n\n본문\n');
    const reportDir = join(root, 'report2');
    const code = await main([
      'import',
      'spec',
      '--profile',
      'nerv-docs',
      '--root',
      root,
      '--project',
      'p',
      '--report-dir',
      reportDir,
      '--server',
      'http://stub',
      '--token',
      'nerv_x',
      '--apply',
    ]);
    expect(code).toBe(2);
    expect(readFileSync(join(reportDir, 'report.jsonl'), 'utf8')).toContain('server-unauthorized');
    // 4xx 는 재시도하지 않는다 — 만료된 토큰으로 다시 부르는 것은 답이 아니다
    expect(calls).toBe(1);
  });
});
