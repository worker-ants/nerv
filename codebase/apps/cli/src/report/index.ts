import { t } from '../i18n.js';
// 실패 리포트 — 정본: docs/04-mvp/importer.md §4.1
//
// 리포트의 규칙은 하나다: **파일·줄·사유·건너뜀/중단 구분이 있어야 한다.** 그리고 원문은
// 보존한다(정보 손실 0). 이 규칙이 있는 이유는 임포트가 한 번에 끝나지 않기 때문이다 —
// 실패 항목을 수동 확인 큐로 처리하고 재실행해서 전수에 도달하는 것이 정상 경로다(시나리오 E).

/**
 * 4분류다 — `abort`(중단) · `skip`(건너뜀) · `manual`(수동 확인) · `warn`(정보성).
 *
 * **`warn` 이 2026-09-06 까지 없었다.** 그래서 `research-doc`(참고 문서라 Task 를 만들지
 * 않는다)·`dist-mismatch`(분포가 기대와 다르다) 처럼 **아무것도 잘못되지 않은 항목**이
 * `skipped` 로 섞였고, 종료 코드가 1(실패·수동 확인 있음)이 됐다 — 정상 실행이 실패로
 * 보고되면 그 코드는 게이트로 쓸 수 없다.
 */
export type Disposition = 'skipped' | 'aborted' | 'manual' | 'warn';

/**
 * **규칙 전표는 한 곳에 있다** — 정본은 [4.7 스펙 임포터](../../../../../docs/04-mvp/importer.md)
 * §4.1 이고, 이 상수가 그 표의 코드 쪽 짝이다.
 *
 * 세 가지가 여기 걸려 있다. ① `rule` 이 이 키들의 **유니온**이라 오타가 컴파일에 걸린다 —
 * 2026-09-07 까지 자유 문자열이라 같은 뜻에 다른 슬러그가 쓰였고(`link-unresolved` 가 참조
 * 과다에, `owner-unmapped` 가 완료 시각 미복구에), 그러면 재실행 큐를 슬러그로 고를 수 없다.
 * ② 등급이 여기 적힌 것과 다르면 L1 이 잡는다 — 전표는 warn 이라 적는데 코드가 `skipped` 를
 * 내면 정상 실행이 종료 코드 1 이 된다. ③ 힌트 키가 여기 있으므로 `hint` 를 채우는 곳도
 * 하나다 — 그 필드는 오래 **선언만 있고 채우는 코드가 없었다**.
 */
export const RULES = {
  // abort — 실행 전체를 멈춘다. 절반을 덮어쓰고 멈추는 것이 아무것도 안 하고 멈추는 것보다 나쁘다
  'count-mismatch': 'aborted',
  'map-conflict': 'aborted',
  'server-unauthorized': 'aborted',
  'profile-invalid': 'aborted',
  // skip — 그 항목만 빼고 계속한다. 종료 코드는 1 이라 신호는 남는다
  'id-collision': 'skipped',
  'status-unknown': 'skipped',
  'server-rejected': 'skipped',
  'plan-spec-unresolved': 'skipped',
  'review-no-snapshot': 'skipped',
  // manual — 사람이 봐야 끝난다(재실행 큐)
  'impl-status-doc-copied': 'manual',
  'req-id-duplicate': 'manual',
  'req-priority-missing': 'manual',
  'pending-plan-unresolved': 'manual',
  'plan-many-refs': 'manual',
  'done-at-unrecovered': 'manual',
  'area-body-missing': 'manual',
  'review-tableless': 'manual',
  // warn — 아무것도 잘못되지 않았다. **종료 코드를 올리지 않는다**
  'dist-mismatch': 'warn',
  'frontmatter-missing': 'warn',
  'research-doc': 'warn',
} as const satisfies Record<string, Disposition>;

export type Rule = keyof typeof RULES;

/**
 * 권장 조치 — 사유가 "무엇이" 라면 이것은 "그래서 무엇을 하라" 다.
 *
 * 카탈로그에 문구가 없으면 `undefined` 다: 힌트가 없는 것은 결함이 아니지만, **없는 키를
 * 그대로 찍는 것**은 결함이다(카탈로그 폴백이 키 문자열을 돌려주므로 사람이 그것을 읽는다).
 */
export function hintFor(rule: Rule): string | undefined {
  const key = `cli.hint.${rule.replaceAll('-', '_')}`;
  const rendered = t()(key as never);
  return rendered === key ? undefined : rendered;
}

export interface ReportEntry {
  file: string;
  line: number | null;
  /**
   * 규칙 슬러그 — §4.1 전표의 이름이다(`req-id-duplicate` · `map-conflict` …).
   *
   * **`report.jsonl` 을 기계가 읽는다는 전제가 이 필드에 걸려 있다.** 2026-09-06 까지
   * 슬러그 23종이 코드에 하나도 없어 전부 자유 문장이었고, 그러면 재실행 큐를 자동으로
   * 분류할 수 없다 — 사람이 매번 문장을 읽어 고르게 된다.
   */
  rule: Rule;
  reason: string;
  disposition: Disposition;
  /** 권장 조치 — 사유가 "무엇이" 라면 이것은 "그래서 무엇을 하라" 다 */
  hint?: string;
  /** 원문 조각 — 정보 손실 0 을 위해 남긴다 */
  excerpt?: string;
}

export interface ImportReport {
  profile: string;
  root: string;
  rootCommit: string | null;
  scanned: number;
  converted: number;
  entries: ReportEntry[];
  /** 기대 집계 대조 결과 — 프로파일이 expect 를 선언한 경우에만(REQ-IMP-016) */
  expectation: { field: string; expected: number; actual: number; ok: boolean }[];
  /**
   * preflight 가 `unchanged` 로 답해 본문을 다시 보내지 않은 파일 수(§3.4).
   *
   * **실패가 아니라 재실행의 정상이다** — 그래서 `entries` 가 아니라 여기에 센다.
   * 이 수가 재실행에서 0 이면 멱등이 깨진 것이고(REQ-IMP-004), 그 사실은 표가 아니라
   * 이 한 줄에서 먼저 보인다.
   */
  unchanged?: number;
}

export function conversionRate(report: ImportReport): number {
  return report.scanned === 0 ? 1 : report.converted / report.scanned;
}

/**
 * 종료 코드 — 0 완료 · 1 실패·수동 확인 있음 · 2 중단(§3.1).
 *
 * **`warn` 은 1 을 만들지 않는다.** 정보성 항목이 종료 코드를 올리면 "참고 문서가 하나
 * 있었다" 만으로 실행이 실패가 된다 — 그 코드를 게이트로 쓰는 쪽은 늘 빨강을 보게 되고,
 * 늘 빨간 신호는 이미 신호가 아니다.
 */
export function exitCode(report: ImportReport): 0 | 1 | 2 {
  if (report.entries.some((e) => e.disposition === 'aborted')) return 2;
  if (report.entries.some((e) => e.disposition !== 'warn')) return 1;
  return 0;
}

/**
 * 힌트를 채운다 — **끝에서 한 번**(2026-09-07 · REQ-IMP-024).
 *
 * 항목을 만드는 자리가 스무 곳이라 거기마다 채우면 언젠가 한 곳이 빠지고, 빠진 것은
 * "이 규칙에는 힌트가 없다" 와 구별되지 않는다. 이미 채워진 힌트는 건드리지 않는다 —
 * 그 자리에서만 아는 맥락이 있을 수 있다.
 */
export function withHints(report: ImportReport): ImportReport {
  return {
    ...report,
    entries: report.entries.map((e) => {
      if (e.hint !== undefined) return e;
      const hint = hintFor(e.rule);
      return hint === undefined ? e : { ...e, hint };
    }),
  };
}

/** 사람이 읽는 버전 — report.md */
export function renderMarkdown(report: ImportReport): string {
  const lines: string[] = [
    t()('cli.report.title', { profile: report.profile }),
    '',
    t()('cli.report.source', { root: report.root }) +
      (report.rootCommit === null ? '' : ` (\`${report.rootCommit}\`)`),
    `- 스캔 ${report.scanned}건 · 변환 ${report.converted}건 · 자동 변환율 ${(conversionRate(report) * 100).toFixed(1)}%`,
    ...(report.unchanged === undefined
      ? []
      : [`- 무변경 ${report.unchanged}건 — 본문을 다시 보내지 않았다(§3.4)`]),
    '',
  ];

  if (report.expectation.length > 0) {
    lines.push(
      t()('cli.report.expectations'),
      '',
      `| ${t()('cli.report.col_item')} | ${t()('cli.report.col_expected')} | ${t()('cli.report.col_actual')} | ${t()('cli.report.col_verdict')} |`,
      '| --- | --- | --- | --- |',
    );
    for (const e of report.expectation) {
      lines.push(
        `| ${e.field} | ${e.expected} | ${e.actual} | ${t()(e.ok ? 'cli.report.match' : 'cli.report.mismatch')} |`,
      );
    }
    lines.push('');
  }

  if (report.entries.length === 0) {
    lines.push(t()('cli.report.failures'), '', t()('cli.report.none'));
    return lines.join('\n');
  }

  lines.push(
    t()('cli.report.failures'),
    '',
    `| ${t()('cli.report.col_file')} | ${t()('cli.report.col_line')} | ${t()('cli.report.col_rule')} | ${t()('cli.report.col_action')} | ${t()('cli.report.col_reason')} |`,
    '| --- | --- | --- | --- | --- |',
  );
  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.file}\` | ${entry.line ?? '—'} | \`${entry.rule}\` | ${label(entry.disposition)} | ` +
        `${entry.reason}${entry.hint === undefined ? '' : ` — ${entry.hint}`} |`,
    );
  }
  return lines.join('\n');
}

/** 기계가 읽는 버전 — report.jsonl (한 줄 한 항목) */
export function renderJsonl(report: ImportReport): string {
  return report.entries.map((e) => JSON.stringify(e)).join('\n');
}

function label(disposition: Disposition): string {
  switch (disposition) {
    case 'skipped':
      return t()('cli.report.action.skipped');
    case 'aborted':
      return t()('cli.report.action.aborted');
    case 'manual':
      return t()('cli.report.action.manual');
    case 'warn':
      return t()('cli.report.action.warn');
  }
}
