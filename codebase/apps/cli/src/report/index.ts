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
  rule: string;
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
