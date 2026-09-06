import { t } from '../i18n.js';
// 실패 리포트 — 정본: docs/04-mvp/importer.md §4.1
//
// 리포트의 규칙은 하나다: **파일·줄·사유·건너뜀/중단 구분이 있어야 한다.** 그리고 원문은
// 보존한다(정보 손실 0). 이 규칙이 있는 이유는 임포트가 한 번에 끝나지 않기 때문이다 —
// 실패 항목을 수동 확인 큐로 처리하고 재실행해서 전수에 도달하는 것이 정상 경로다(시나리오 E).

export type Disposition = 'skipped' | 'aborted' | 'manual';

export interface ReportEntry {
  file: string;
  line: number | null;
  reason: string;
  disposition: Disposition;
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

/** 종료 코드 — 0 완료 · 1 실패·수동 확인 있음 · 2 중단(§3.1) */
export function exitCode(report: ImportReport): 0 | 1 | 2 {
  if (report.entries.some((e) => e.disposition === 'aborted')) return 2;
  if (report.entries.length > 0) return 1;
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
    `| ${t()('cli.report.col_file')} | ${t()('cli.report.col_line')} | ${t()('cli.report.col_action')} | ${t()('cli.report.col_reason')} |`,
    '| --- | --- | --- | --- |',
  );
  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.file}\` | ${entry.line ?? '—'} | ${label(entry.disposition)} | ${entry.reason} |`,
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
  }
}
