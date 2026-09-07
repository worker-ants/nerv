// 리포트 형식 — 정본: docs/04-mvp/importer.md §4.1
// 규칙 하나: 파일·줄·사유·건너뜀/중단 구분이 있어야 하고 원문은 보존한다(정보 손실 0).

import { setLocaleForTesting } from '../i18n.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { conversionRate, exitCode, renderJsonl, renderMarkdown, RULES } from './index.js';
import type { Disposition, Rule } from './index.js';
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
        entries: [
          { file: 'a.md', line: 3, rule: 'req-id-duplicate', reason: 'x', disposition: 'manual' },
        ],
      }),
    ).toBe(1);
    expect(
      exitCode({
        ...base,
        entries: [
          {
            file: '(집계)',
            line: null,
            rule: 'req-id-duplicate',
            reason: 'x',
            disposition: 'aborted',
          },
        ],
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
          rule: 'req-id-duplicate',
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

  it('jsonl 은 한 줄 한 항목 — 기계가 읽는 버전', () => {
    const jsonl = renderJsonl({
      ...base,
      entries: [
        { file: 'a.md', line: 1, rule: 'req-id-duplicate', reason: 'r1', disposition: 'skipped' },
        { file: 'b.md', line: 2, rule: 'req-id-duplicate', reason: 'r2', disposition: 'manual' },
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

/**
 * **전표와 코드가 갈리면 여기서 잡힌다**(2026-09-07 · REQ-IMP-024).
 *
 * §4.1 의 규칙 전표는 사람이 읽는 계약이고 `RULES` 는 그 계약의 코드 쪽 짝이다. 둘이
 * 갈리면 등급이 문서와 다르게 매겨지고 — 전표가 warn 이라 적은 것이 코드에서 `skipped`
 * 면 정상 실행이 종료 코드 1 이 된다 — 그 사실을 아무도 모른 채 게이트가 늘 빨갛다.
 * 실제로 세 자리가 갈려 있었다(`dist-mismatch`·`status-unknown`·`title-missing`).
 */
describe('규칙 전표가 문서와 같다 (importer.md §4.1)', () => {
  const doc = readFileSync(
    new URL('../../../../../docs/04-mvp/importer.md', import.meta.url).pathname,
    'utf8',
  );
  /** 전표 행: `| \`slug\` [/ \`slug\`] | class | 조건 |` */
  const declared = new Map<string, string>();
  for (const line of doc.split('\n')) {
    const row = /^\| ((?:`[a-z-]+`(?: \/ )?)+) \| (abort|skip|manual|warn) \|/.exec(line);
    if (row === null) continue;
    for (const slug of row[1]?.match(/[a-z-]+(?=`)/g) ?? []) {
      declared.set(slug, row[2] as string);
    }
  }
  const CLASS: Record<string, Disposition> = {
    abort: 'aborted',
    skip: 'skipped',
    manual: 'manual',
    warn: 'warn',
  };

  it('전표를 읽어 냈다 — 정규식이 표를 놓치면 이 검사는 아무것도 세지 않는다', () => {
    expect(declared.size).toBeGreaterThan(15);
  });

  it.each(Object.keys(RULES))('%s 의 등급이 전표와 같다', (slug) => {
    const want = declared.get(slug);
    expect(want, `전표에 \`${slug}\` 행이 없다`).toBeDefined();
    expect(RULES[slug as Rule]).toBe(CLASS[want as string]);
  });
});
