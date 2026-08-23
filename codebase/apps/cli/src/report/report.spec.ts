// 리포트 형식 — 정본: docs/04-mvp/importer.md §4.1
// 규칙 하나: 파일·줄·사유·건너뜀/중단 구분이 있어야 하고 원문은 보존한다(정보 손실 0).

import { setLocaleForTesting } from '../i18n.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { conversionRate, exitCode, renderJsonl, renderMarkdown } from './index.js';
import type { ImportReport } from './index.js';

const base: ImportReport = {
  profile: 'clemvion',
  root: '/checkout',
  rootCommit: 'abc1234',
  scanned: 135,
  converted: 133,
  entries: [],
  expectation: [],
};

// 출력 검사는 한국어 화면 기준이다 — 기계의 LANG 에 따라 검사 대상이 바뀌면 안 된다
beforeAll(() => setLocaleForTesting('ko'));

describe('리포트', () => {
  it('자동 변환율을 계산한다 — 성공 기준 0-6 의 판정값(≥95%)', () => {
    expect(conversionRate(base)).toBeCloseTo(133 / 135);
    expect(conversionRate({ ...base, scanned: 0, converted: 0 })).toBe(1);
  });

  it('종료 코드 — 0 완료 · 1 수동 확인 · 2 중단(§3.1)', () => {
    expect(exitCode(base)).toBe(0);
    expect(
      exitCode({
        ...base,
        entries: [{ file: 'a.md', line: 3, reason: 'x', disposition: 'manual' }],
      }),
    ).toBe(1);
    expect(
      exitCode({
        ...base,
        entries: [{ file: '(집계)', line: null, reason: 'x', disposition: 'aborted' }],
      }),
    ).toBe(2);
  });

  it('실패 항목마다 파일·줄·사유·처리 구분을 적는다', () => {
    const md = renderMarkdown({
      ...base,
      entries: [
        {
          file: 'spec/a.md',
          line: 12,
          reason: 'status_map 에 없는 값: weird',
          disposition: 'manual',
        },
      ],
    });
    expect(md).toContain('spec/a.md');
    expect(md).toContain('| 12 |');
    expect(md).toContain('수동 확인');
    expect(md).toContain('status_map 에 없는 값');
  });

  it('기대 집계 대조표를 싣는다 (REQ-IMP-016)', () => {
    const md = renderMarkdown({
      ...base,
      expectation: [{ field: 'spec_total', expected: 135, actual: 130, ok: false }],
    });
    expect(md).toContain('기대 집계 대조');
    expect(md).toContain('**불일치**');
  });

  it('jsonl 은 한 줄 한 항목 — 기계가 읽는 판', () => {
    const jsonl = renderJsonl({
      ...base,
      entries: [
        { file: 'a.md', line: 1, reason: 'r1', disposition: 'skipped' },
        { file: 'b.md', line: 2, reason: 'r2', disposition: 'manual' },
      ],
    });
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ file: 'a.md', disposition: 'skipped' });
  });

  it('실패가 없으면 "없음" 이라고 적는다 — 빈 표를 두지 않는다', () => {
    expect(renderMarkdown(base)).toContain('없음');
  });
});
