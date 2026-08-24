// 게이트 현황 — S6 하단(ui-wireframes §2.6 ⑦⑧ · REQ-WEB-065)
//
// **"이 커밋 범위를 커버하는 해소된 리뷰가 있는가"** 한 질문에 브랜치별로 답한다.
// 지금은 **표시일 뿐 집행이 아니다** — Task `done` 을 막는 것은 FR-10 의 Phase 2 몫이다.
// 보여 주는 것과 막는 것을 한 번에 넣지 않는 이유는 단순하다: 막기 시작하면 판정이 틀렸을
// 때 사람의 일이 멈추고, 그때는 판정을 고칠 여유가 없다.

import { StatusBadge } from '../../components/status-badge.js';
import { useT } from '../../lib/i18n.js';
import type { Row } from '../../lib/queries.js';
import { relativeTime } from '../session-monitor/format.js';
import { EmptyState, SectionTitle, Table, Td, Th, Tr } from '../../components/ui/primitives.js';
import type { StatusToken } from '../../components/status-badge.js';

const VERDICT_TOKEN: Record<string, StatusToken> = {
  passed: 'ok',
  pending: 'waiting',
  uncovered: 'danger',
};

export function GateCoverage({
  rows: items,
  total,
}: {
  rows: Row[];
  total: number;
}): React.JSX.Element {
  const t = useT();
  if (items.length === 0) {
    return (
      <section>
        <SectionTitle>{t('reviews.gate.title')}</SectionTitle>
        <EmptyState icon="◈" title={t('reviews.gate.empty')} />
      </section>
    );
  }
  return (
    <section data-testid="gate-coverage">
      <SectionTitle>{t('reviews.gate.title')}</SectionTitle>
      <p className="mb-2 text-2xs text-text-faint">
        {t('reviews.gate.note')}
        {/* **잘랐으면 잘랐다고 말한다.** clemvion 실측 441 브랜치 — 20개만 그리고
            아무 말도 안 하면 화면은 "브랜치가 20개뿐"이라고 거짓말한다(REQ-WEB-067) */}
        {total > items.length && (
          <span className="ml-2" data-testid="gate-truncated">
            {t('reviews.gate.shown', { shown: items.length, total })}
          </span>
        )}
      </p>
      <Table
        head={
          <>
            <Th>{t('reviews.gate.branch')}</Th>
            <Th className="w-56">{t('reviews.gate.review')}</Th>
            <Th className="w-20">{t('reviews.gate.resolved')}</Th>
            <Th className="w-24">{t('reviews.gate.verdict')}</Th>
          </>
        }
      >
        {items.map((row) => {
          const verdict = String(row['verdict']);
          const bypasses = Array.isArray(row['bypasses']) ? (row['bypasses'] as Row[]) : [];
          return (
            <Tr key={String(row['branch'])}>
              <Td className="font-mono text-xs">
                {String(row['branch'])}
                {/* **면제는 같은 줄에 펼친다.** 목록 어딘가가 아니라 그 브랜치 옆에
                    있어야 한다 — 면제가 조용히 일어나지 않는 것 자체가 기능이다 */}
                {bypasses.map((b, i) => (
                  <span
                    key={i}
                    data-testid="gate-bypass"
                    className="mt-1 block font-sans text-2xs text-status-danger"
                  >
                    ↳ {t('reviews.bypass')}: {String(b['display_name'])} ·{' '}
                    {relativeTime(t, b['decided_at'] == null ? null : String(b['decided_at']))} ·{' '}
                    {String(b['bypass_reason'])}
                  </span>
                ))}
              </Td>
              <Td className="font-mono text-2xs text-text-mute">
                {String(row['head_sha']).slice(0, 7)} · {String(row['round_no'])}R
              </Td>
              <Td className="text-2xs text-text-mute">
                {String(row['resolved'])}/{String(row['total'])}
              </Td>
              <Td>
                <StatusBadge
                  token={VERDICT_TOKEN[verdict] ?? 'idle'}
                  label={t(`reviews.verdict.${verdict}` as 'reviews.verdict.passed')}
                />
              </Td>
            </Tr>
          );
        })}
      </Table>
    </section>
  );
}
