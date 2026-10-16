// 컷오버 관측 — S6 하단, 게이트 현황 위(2026-10-16 · 사람 결정 D6 · E21-S03 · REQ-WEB-330 · api.md EP-REV-10)
//
// **M1 이중화 기간의 두 비율을 로드맵 기준에 견준다**(roadmap §7.5 · §7.6). 판정 불일치율(로컬 훅과 서버의 판정이 다른 비교 / 비교 수)과
// 리뷰 제출 실패율이다 — 1% 미만이면 안정, 5% 이상이거나 제출 실패율 2% 이상이면 롤백 기준이다. 기준값은 서버가 응답에 함께 준다
// (`thresholds` — 상수의 정본은 `@nerv/schema`). 이 화면은 값을 다시 계산하지 않고 서버의 `status` 를 그대로 보인다.
//
// admin · planner 에게만, 그 프로젝트가 컷오버 전(`git`)이 아닐 때만 그린다 — 대부분의 프로젝트에는 볼 것이 없다. 저장소의 신규 커밋
// 수(성공 기준 2-1)는 서버가 모른다: CLI(`nerv cutover report`)가 체크아웃에서 잰다고 한 줄로 알린다.

import { StatusBadge } from '../../components/status-badge.js';
import type { StatusToken } from '../../components/status-badge.js';
import { ErrorState } from '../../components/query-state.js';
import { Card, SectionTitle, Skeleton } from '../../components/ui/primitives.js';
import { relativeTime, SOT_LABEL } from '../../lib/format.js';
import { useT } from '../../lib/i18n.js';
import type { CutoverReport, Row } from '../../lib/queries.js';

const STATUS_TOKEN: Record<CutoverReport['status'], StatusToken> = {
  no_data: 'idle',
  stable: 'ok',
  watch: 'waiting',
  rollback: 'danger',
};

const VERDICT_LABEL = { pass: 'gate.verdict.pass', block: 'gate.verdict.block' } as const;

/** 0.0123 → "1.23%". 분모가 0 이면 줄표 */
export function percent(rate: number | null): string {
  if (rate === null) return '—';
  return `${(Math.round(rate * 10_000) / 100).toFixed(2)}%`;
}

export function CutoverPanel({
  report,
  failed,
}: {
  /** 받기 전이면 `undefined` — 골격을 그린다 */
  report: CutoverReport | undefined;
  failed?: { error: unknown; retry: () => void };
}): React.JSX.Element {
  const t = useT();
  if (failed !== undefined) {
    return (
      <section>
        <SectionTitle>{t('reviews.cutover.title')}</SectionTitle>
        <ErrorState error={failed.error} onRetry={failed.retry} />
      </section>
    );
  }
  if (report === undefined) {
    return (
      <section>
        <SectionTitle>{t('reviews.cutover.title')}</SectionTitle>
        <Skeleton rows={2} />
      </section>
    );
  }
  const { thresholds } = report;
  const statusText =
    report.status === 'stable'
      ? t('reviews.cutover.status.stable', { pct: thresholds.stable_below_pct })
      : report.status === 'watch'
        ? t('reviews.cutover.status.watch', { pct: thresholds.stable_below_pct })
        : report.status === 'rollback'
          ? t('reviews.cutover.status.rollback')
          : t('reviews.cutover.status.no_data');
  const reasons = report.reasons.map((reason) =>
    reason === 'mismatch_rate'
      ? t('reviews.cutover.reason.mismatch_rate', { pct: thresholds.rollback_mismatch_pct })
      : t('reviews.cutover.reason.submit_failure_rate', {
          pct: thresholds.rollback_submit_failure_pct,
        }),
  );
  const stage = t(SOT_LABEL[report.review_sot]);
  return (
    <section data-testid="cutover-panel">
      <SectionTitle>{t('reviews.cutover.title')}</SectionTitle>
      <Card className="flex flex-col gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            token={STATUS_TOKEN[report.status]}
            label={statusText}
            data-testid="cutover-status"
          />
          {reasons.length > 0 && (
            <span className="text-status-danger" data-testid="cutover-reasons">
              {reasons.join(' · ')}
            </span>
          )}
        </div>
        <p className="text-text-mute" data-testid="cutover-stage">
          {report.review_sot_since === null
            ? stage
            : t('reviews.cutover.stage', {
                stage,
                since: relativeTime(t, report.review_sot_since),
              })}
          {' · '}
          {t('reviews.cutover.window', {
            days: Math.floor(report.window.days),
            total: report.window.observation_days,
          })}
        </p>
        <ul className="flex flex-col gap-0.5">
          <li data-testid="cutover-mismatch">
            {t('reviews.cutover.mismatch', {
              mismatches: report.comparisons.mismatches,
              total: report.comparisons.total,
            })}{' '}
            <span className="font-mono">{percent(report.comparisons.rate)}</span>
          </li>
          <li data-testid="cutover-submit">
            {t('reviews.cutover.submit_failure', {
              failed: report.submissions.failed,
              total: report.submissions.total,
            })}{' '}
            <span className="font-mono">{percent(report.submissions.rate)}</span>
          </li>
        </ul>
        {report.recent_mismatches.length > 0 && (
          <div>
            <p className="font-medium">{t('reviews.cutover.recent')}</p>
            <ul className="mt-1 flex flex-col gap-0.5" data-testid="cutover-recent">
              {report.recent_mismatches.map((row: Row) => {
                const local = row['local'] === 'pass' ? 'pass' : 'block';
                const server = row['server'] === 'pass' ? 'pass' : 'block';
                return (
                  <li key={String(row['id'])} className="break-all">
                    <span className="font-mono">{String(row['branch'])}</span>
                    {' · '}
                    <span className="font-mono">{String(row['head_sha']).slice(0, 7)}</span>
                    {' · '}
                    {t('reviews.cutover.recent_row', {
                      local: t(VERDICT_LABEL[local]),
                      server: t(VERDICT_LABEL[server]),
                    })}
                    {typeof row['hook'] === 'string' && (
                      <span className="text-text-faint"> · {row['hook']}</span>
                    )}
                    {typeof row['reason'] === 'string' && (
                      <span className="block text-text-faint">{row['reason']}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="text-2xs text-text-faint">{t('reviews.cutover.cli')}</p>
      </Card>
    </section>
  );
}
