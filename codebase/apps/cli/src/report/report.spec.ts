// 리포트 형식 — 정본: docs/04-mvp/importer.md §4.1
// 규칙 하나: 파일·줄·사유·건너뜀/중단 구분이 있어야 하고 원문은 보존한다(정보 손실 0).

import { setLocaleForTesting } from '../i18n.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImport } from '../run.js';
import {
  conversionRate,
  exitCode,
  renderJsonl,
  renderMarkdown,
  RULES,
  withHints,
} from './index.js';
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
          reason: 'status_map에 없는 값: weird',
          disposition: 'manual',
        },
      ],
    });
    expect(md).toContain('spec/a.md');
    expect(md).toContain('| 12 |');
    expect(md).toContain('수동 확인');
    expect(md).toContain('status_map에 없는 값');
  });

  it('예상 집계 비교표를 싣는다 (REQ-IMP-016)', () => {
    const md = renderMarkdown({
      ...base,
      expectation: [{ field: 'spec_total', expected: 135, actual: 130, ok: false }],
    });
    expect(md).toContain('예상 집계 비교');
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

  // **집계 두 줄이 한국어로 박혀 있었다** — 카탈로그에 같은 문장(`cli.report.counts`)이 있었는데
  // 코드가 그것을 부르지 않아, 영어 로케일의 리포트도 그 두 줄만 한국어였다
  it('집계 줄도 로케일을 따른다', () => {
    const report = { ...base, unchanged: 4 };
    expect(renderMarkdown(report)).toContain('- 스캔 135건 · 변환 133건 · 자동 변환율 98.5%');
    expect(renderMarkdown(report)).toContain('- 무변경 4건');
    setLocaleForTesting('en');
    try {
      const md = renderMarkdown(report);
      expect(md).toContain('- Scanned 135, converted 133, automatic conversion rate 98.5%');
      expect(md).toContain('- Unchanged 4');
      expect(md).not.toMatch(/[가-힣]/);
    } finally {
      setLocaleForTesting('ko');
    }
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

/**
 * **옮겨 온 요구사항 번호를 적는다**(2026-10-15 · REQ-IMP-034 · `req-moved`).
 *
 * 서버는 소유가 풀린 번호를 이 문서로 옮기면 응답 항목에 `requirements_moved` 를 준다. CLI 가 그 칸을
 * 읽지 않던 동안 번호의 주인이 바뀐 사실이 리포트 어디에도 없었다. 서버 응답은 다른 패스의 검사처럼
 * `fetch` 를 흉내 내어 준다.
 */
describe('옮겨 온 요구사항 번호 (REQ-IMP-034)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importWith(moved: { ref: string; from_key: string }[] | undefined) {
    // 뿌리에 둔다 — 디렉터리 아래면 그 영역의 본문이 없다는 수동 확인 항목이 함께 남는다
    const root = mkdtempSync(join(tmpdir(), 'nerv-moved-'));
    writeFileSync(
      join(root, 'b.md'),
      '---\nid: SPC-B\nstatus: approved\n---\n\n# B\n\n| ID | 설명 | 우선순위 |\n| --- | --- | --- |\n' +
        '| REQ-B-001 | 새 요구사항 | 필수 |\n| REQ-A-002 | 옮겨 온 요구사항 | 필수 |\n',
    );
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { kind?: string };
      return {
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('preflight')
            ? { items: [] }
            : body.kind === 'document'
              ? {
                  items: [
                    {
                      source_path: 'b.md',
                      status: 'ok',
                      spec_id: 's-b',
                      ...(moved === undefined ? {} : { requirements_moved: moved }),
                    },
                  ],
                }
              : { items: [] },
      };
    });
    return runImport({
      command: 'spec',
      root,
      project: 'p',
      apply: true,
      batchSize: 50,
      reportDir: join(root, 'report'),
      mapPath: join(root, 'map.json'),
      profile: 'nerv-docs',
      server: 'http://stub',
      token: 'nerv_x',
    });
  }

  it('응답에 있으면 번호마다 경고 한 줄 — 원래 문서의 키와 정의한 행 · 종료 코드는 그대로', async () => {
    const report = await importWith([{ ref: 'REQ-A-002', from_key: 'SPC-A' }]);
    const moved = report.entries.filter((e) => e.rule === 'req-moved');
    expect(moved).toEqual([
      expect.objectContaining({
        file: 'b.md',
        // 그 번호를 정의한 표의 행 — 다른 요구사항 규칙과 같이 frontmatter 를 뺀 본문의 줄이다
        line: 7,
        disposition: 'warn',
        reason: expect.stringContaining('SPC-A') as unknown as string,
      }),
    ]);
    expect(moved[0]?.reason).toContain('REQ-A-002');
    // 잘못된 것은 없다 — 경고는 종료 코드를 올리지 않는다
    expect(report.entries).toEqual(moved);
    expect(exitCode(report)).toBe(0);

    const md = renderMarkdown(withHints(report));
    expect(md).toContain('`req-moved`');
    expect(md).toContain('SPC-A에서 옮겨 온 요구사항이다');
    expect(md).toContain('원래 문서와 대조한다');
    expect(renderJsonl(report)).toContain('"rule":"req-moved"');
  });

  it('칸이 없거나 비었으면 아무것도 더하지 않는다', async () => {
    for (const moved of [undefined, []]) {
      const report = await importWith(moved);
      expect(report.entries.filter((e) => e.rule === 'req-moved')).toEqual([]);
      expect(renderMarkdown(report)).not.toContain('req-moved');
    }
  });
});
