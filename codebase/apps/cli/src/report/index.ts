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

/** 사람이 읽는 판 — report.md */
export function renderMarkdown(report: ImportReport): string {
  const lines: string[] = [
    `# 임포트 리포트 — ${report.profile}`,
    '',
    `- 원본: \`${report.root}\`${report.rootCommit === null ? '' : ` (\`${report.rootCommit}\`)`}`,
    `- 스캔 ${report.scanned}건 · 변환 ${report.converted}건 · 자동 변환율 ${(conversionRate(report) * 100).toFixed(1)}%`,
    '',
  ];

  if (report.expectation.length > 0) {
    lines.push(
      '## 기대 집계 대조',
      '',
      '| 항목 | 기대 | 실제 | 판정 |',
      '| --- | --- | --- | --- |',
    );
    for (const e of report.expectation) {
      lines.push(`| ${e.field} | ${e.expected} | ${e.actual} | ${e.ok ? '일치' : '**불일치**'} |`);
    }
    lines.push('');
  }

  if (report.entries.length === 0) {
    lines.push('## 실패·수동 확인', '', '없음.');
    return lines.join('\n');
  }

  lines.push('## 실패·수동 확인', '', '| 파일 | 줄 | 처리 | 사유 |', '| --- | --- | --- | --- |');
  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.file}\` | ${entry.line ?? '—'} | ${label(entry.disposition)} | ${entry.reason} |`,
    );
  }
  return lines.join('\n');
}

/** 기계가 읽는 판 — report.jsonl (한 줄 한 항목) */
export function renderJsonl(report: ImportReport): string {
  return report.entries.map((e) => JSON.stringify(e)).join('\n');
}

function label(disposition: Disposition): string {
  switch (disposition) {
    case 'skipped':
      return '건너뜀';
    case 'aborted':
      return '**중단**';
    case 'manual':
      return '수동 확인';
  }
}
