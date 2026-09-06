// `nerv import <kind>` 인자 파싱 — 정본: docs/04-mvp/importer.md §3.1
//
// **명령 이름에도 검사가 필요하다.** 정본·이 CLI 의 usage 문구·배포된 스킬이 전부
// `nerv import spec …` 이라고 말하는 동안 파서만 그 낱말을 몰랐고, 아무 테스트도 그것을
// 부르지 않아 **아무도 몰랐다**(2026-09-06 대조). 지시대로 친 사람이 받은 것은 usage
// 에러였고, 그 에러가 다시 되지 않는 형태를 알려 줬다.

import { describe, expect, it } from 'vitest';
import { parseArgs } from './index.js';
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
