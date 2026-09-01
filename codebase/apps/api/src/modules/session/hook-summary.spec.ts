// 도구 호출 요약 — screens.md §2.6 (REQ-WEB-123)
//
// "Bash / Bash" 를 383번 본 사람의 보고에서 나온 코드다. 도구마다 정보가 있는 자리가
// 다르다는 것이 이 표의 요지다.

import { describe, expect, it } from 'vitest';
import { outcomeOf, shortPath, summarize } from './hook-summary.js';

describe('한 줄 요약 — 도구마다 정보의 자리가 다르다', () => {
  it.each([
    ['Bash', { command: 'pnpm -r test' }, 'Bash · pnpm -r test'],
    [
      'Edit',
      { file_path: '/repo/apps/api/src/modules/spec/spec.service.ts' },
      'Edit · repo/apps/…/spec.service.ts',
    ],
    ['Read', { file_path: 'src/index.ts' }, 'Read · src/index.ts'],
    ['Grep', { pattern: 'REQ-API', glob: 'docs' }, 'Grep · REQ-API in docs'],
    ['nerv_spec_get', { spec_id: 'SUD-AREA-PLAY' }, 'nerv_spec_get · SUD-AREA-PLAY'],
    ['nerv_task_update', { task_id: 'CLV-T-1KTDCK' }, 'nerv_task_update · CLV-T-1KTDCK'],
  ])('%s → %s', (tool, input, expected) => {
    expect(summarize(tool, input)).toBe(expected);
  });

  it('여러 줄 명령은 첫 줄만 — 목록이 문단이 되면 안 된다', () => {
    expect(summarize('Bash', { command: 'cd x\nrm -rf y' })).toBe('Bash · cd x');
  });

  it('긴 명령은 자른다', () => {
    const out = summarize('Bash', { command: 'echo ' + 'A'.repeat(200) });
    expect(out.length).toBeLessThan(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('모르는 도구는 이름만 남긴다 — 지어내지 않는다', () => {
    expect(summarize('Unknown', { weird: 1 })).toBe('Unknown');
  });

  it('cwd 아래면 상대 경로로 — 홈 디렉터리 이름을 목록에 늘어놓지 않는다', () => {
    expect(shortPath('/Users/me/repo/src/a.ts', '/Users/me/repo')).toBe('src/a.ts');
  });
});

describe('성패 — 모르면 모른다고 한다', () => {
  it.each([
    [{ exit_code: 0 }, true],
    [{ exit_code: 1 }, false],
    [{ interrupted: true }, false],
    [{ is_error: true }, false],
    [{ stderr: 'boom' }, false],
    [{ stdout: 'fine' }, true],
  ])('%o → ok=%s', (response, ok) => {
    expect(outcomeOf(response)?.ok).toBe(ok);
  });

  it('모양을 모르면 null 이다 — 모르는 것을 성공으로 적으면 그 표시를 믿을 수 없다', () => {
    expect(outcomeOf('그냥 문자열')).toBeNull();
    expect(outcomeOf(undefined)).toBeNull();
  });

  it('실패는 이유를 적는다 — 목록에서 그것만 보고도 짚을 수 있게', () => {
    expect(outcomeOf({ exit_code: 2 })?.detail).toBe('exit 2');
  });
});
