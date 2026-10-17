// 게이트 현황 — S6 하단(ui-wireframes §2.6 ⑦⑧ · REQ-WEB-065)
//
// **"이 커밋 범위를 커버하는 해소된 리뷰가 있는가"** 한 질문에 브랜치별로 답한다.
// **이 표는 표시용이다.** Task `done` 을 막는 판정은 done 게이트(REQ-API-146)이고 기준이 다르다 —
// 정책이 켜면 그 Task 의 라운드와 열린 critical 을 본다(2026-09-28 정정 · 예전 주석은 "Phase 2 몫" 이라
// 적고 있었다). 보여 주는 것과 막는 것을 한 곳에 넣지 않는 이유는 그대로다: 막기 시작하면 판정이
// 틀렸을 때 사람의 일이 멈추고, 그때는 판정을 고칠 여유가 없다.
//
// **브랜치 면제를 여기서도 낸다**(2026-10-16 사람 결정 · REQ-WEB-332). 작업 상세의 리뷰 카드에서만 내던 동안 작업과 무관한
// 브랜치는 API 로만 면제할 수 있었다. 줄마다 [면제]가 그 브랜치를 미리 채운 같은 폼(`BranchWaiverForm`)을 열고, 제목 옆의
// [브랜치 면제]는 아직 줄이 없는 브랜치(리뷰도 면제도 없는 브랜치)의 이름을 직접 넣게 한다.
//
// **면제를 그 줄에서 끝낸다**(2026-10-17 사람 결정 · REQ-WEB-336). 낸 사람이나 admin 은 면제 줄 끝의 [면제 끝내기]로 사유와
// 함께 끝낸다. 끝낸 면제도 줄에 남고(지우지 않는 결재 레코드다) 판정 옆의 면제 수는 끝내지 않은 것만 센다.

import { Fragment, useState } from 'react';
import { StatusBadge } from '../../components/status-badge.js';
import { useT } from '../../lib/i18n.js';
import type { Row } from '../../lib/queries.js';
import { relativeTime } from '../session-monitor/format.js';
import { reviewKindText } from '../../lib/format.js';
import {
  Button,
  EmptyState,
  SectionTitle,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '../../components/ui/primitives.js';
import { ErrorState } from '../../components/query-state.js';
import { EntityLink } from '../../components/entity-link.js';
import type { StatusToken } from '../../components/status-badge.js';
import {
  BranchWaiverForm,
  canWaiveBranch,
  isRevokedWaiver,
  WaiverRevoke,
  WaiverRevokedNote,
} from '../task-board/review-waiver.js';

const VERDICT_TOKEN: Record<string, StatusToken> = {
  passed: 'ok',
  pending: 'waiting',
  uncovered: 'danger',
};

/**
 * 게이트 현황에서 내는 브랜치 면제(2026-10-16 사람 결정 · REQ-WEB-332) — 줄마다 그 브랜치를 미리 채운 폼, 제목 옆에는 이름을
 * 직접 넣는 폼. 리뷰가 없는 브랜치는 면제하기 전에는 이 표에 줄이 없어서 제목 옆의 길이 따로 있어야 한다
 */
export interface GateWaiver {
  roles: readonly string[];
  /** 보는 사람 — [면제 끝내기]를 그릴지 정한다(낸 사람이나 admin). 받기 전이면 null */
  userId: string | null;
  /** 기록한 뒤 — 게이트 현황을 다시 읽는다(`gate.bypassed` 실시간 무효화와 같은 일을 그 자리에서) */
  onDone: () => void;
}

export function GateCoverage({
  rows: items,
  total,
  projectSlug,
  failed,
  waiver,
}: {
  /** 받기 전이면 `undefined` — 그때는 빈 상태가 아니라 골격이다(REQ-WEB-293) */
  rows: Row[] | undefined;
  total: number;
  projectSlug: string;
  /** 한 번도 받지 못한 채 실패했다 — 빈 상태로 그리지 않는다(REQ-WEB-198) */
  failed?: { error: unknown; retry: () => void };
  /** 브랜치 면제를 여기서 낸다 — 면제할 수 있는 종류가 없는 역할에게는 단추가 없다 */
  waiver?: GateWaiver;
}): React.JSX.Element {
  const t = useT();
  // 펼친 폼 — null 이면 닫힘, '' 이면 제목 옆(이름을 직접 넣는다), 그 밖은 그 브랜치 줄
  const [waiving, setWaiving] = useState<string | null>(null);
  const canWaive = waiver !== undefined && canWaiveBranch(waiver.roles);
  const waiveForm = (branch: string): React.JSX.Element | null =>
    waiver === undefined ? null : (
      <BranchWaiverForm
        key={`waive-${branch}`}
        proj={projectSlug}
        roles={waiver.roles}
        initialBranch={branch}
        startOpen
        onDone={() => {
          setWaiving(null);
          waiver.onDone();
        }}
        onCancel={() => setWaiving(null)}
      />
    );
  const newWaiver = canWaive ? (
    <Button
      size="xs"
      variant="subtle"
      data-testid="gate-waive-new"
      aria-expanded={waiving === ''}
      onClick={() => setWaiving(waiving === '' ? null : '')}
    >
      {t('task.branch_waiver.open')}
    </Button>
  ) : undefined;
  if (failed !== undefined) {
    return (
      <section>
        <SectionTitle>{t('reviews.gate.title')}</SectionTitle>
        <ErrorState error={failed.error} onRetry={failed.retry} />
      </section>
    );
  }
  if (items === undefined) {
    return (
      <section>
        <SectionTitle>{t('reviews.gate.title')}</SectionTitle>
        <Skeleton rows={3} />
      </section>
    );
  }
  if (items.length === 0) {
    return (
      <section>
        <SectionTitle action={newWaiver}>{t('reviews.gate.title')}</SectionTitle>
        {waiving === '' && waiveForm('')}
        <EmptyState icon="◈" title={t('reviews.gate.empty')} action={null} />
      </section>
    );
  }
  return (
    <section data-testid="gate-coverage">
      <SectionTitle action={newWaiver}>{t('reviews.gate.title')}</SectionTitle>
      {waiving === '' && waiveForm('')}
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
      {/* **좁은 칸에 맞춰 다시 잰다**(2026-09-10 — 사람 지시 · REQ-WEB-158). 이 표는 페이지
          바닥에서 화면 폭을 통째로 쓰다가 발견 큐와 같은 칸으로 들어왔다 — 고정 폭 셋이
          400px 를 먼저 가져가면 브랜치 이름이 한 글자 폭으로 찌그러진다(§2.5 가 세션 줄에서
          겪은 그 모양이다). 실제로 드는 값으로 줄인다: 커버 리뷰는 `sha7 · nR`, 해소는
          `n/m`, 판정은 배지 하나다. 브랜치는 남는 폭을 다 갖고 길면 **줄 안에서** 접는다 —
          `overflow-x-auto`(프리미티브) 는 마지막 방어선이지 기본 배치가 아니다. */}
      <Table
        head={
          <>
            <Th>{t('reviews.gate.branch')}</Th>
            <Th className="w-32">{t('reviews.gate.review')}</Th>
            <Th className="w-16">{t('reviews.gate.resolved')}</Th>
            <Th className="w-24">{t('reviews.gate.verdict')}</Th>
          </>
        }
      >
        {items.map((row) => {
          const verdict = String(row['verdict']);
          const bypasses = Array.isArray(row['bypasses']) ? (row['bypasses'] as Row[]) : [];
          // 판정 옆의 수는 끝내지 않은 면제만 센다 — 끝낸 면제는 기록으로 줄에 남을 뿐 게이트를 넘기지 않는다
          const active = bypasses.filter((b) => !isRevokedWaiver(b)).length;
          const branch = String(row['branch']);
          return (
            <Fragment key={branch}>
              <Tr>
                <Td className="font-mono text-xs break-all">
                  {/* 그 브랜치의 **발견으로** 간다(REQ-WEB-209) — 표의 브랜치가 글자뿐이었다 */}
                  <EntityLink
                    projectSlug={projectSlug}
                    entity={{ kind: 'findings', branch: String(row['branch']) }}
                    testId="gate-branch-link"
                  >
                    {String(row['branch'])}
                  </EntityLink>
                  {/* **면제는 같은 줄에 펼친다.** 목록 어딘가가 아니라 그 브랜치 옆에
                    있어야 한다 — 면제가 조용히 일어나지 않는 것 자체가 기능이다 */}
                  {bypasses.map((b, i) => {
                    // 범위를 함께 적는다(2026-10-16 · 사람 결정 D4 · REQ-WEB-327) — 어느 종류를 · 어느 커밋까지 넘겼는지
                    // 빠지면 "면제됨" 한 줄이 브랜치 전체를 넘긴 것처럼 읽힌다
                    const kinds = Array.isArray(b['kinds']) ? (b['kinds'] as string[]) : null;
                    const head = typeof b['head_sha'] === 'string' ? b['head_sha'] : null;
                    const revoked = isRevokedWaiver(b);
                    return (
                      <span
                        key={String(b['id'] ?? i)}
                        data-testid="gate-bypass"
                        data-revoked={revoked ? 'true' : undefined}
                        className={
                          revoked
                            ? 'mt-1 block font-sans text-2xs text-text-faint'
                            : 'mt-1 block font-sans text-2xs text-status-danger'
                        }
                      >
                        ↳ {t('reviews.bypass')}: {String(b['display_name'])} ·{' '}
                        {relativeTime(t, b['decided_at'] == null ? null : String(b['decided_at']))}{' '}
                        ·{' '}
                        <span data-testid="gate-bypass-scope">
                          {kinds === null
                            ? t('task.waiver.all')
                            : kinds.map((k) => reviewKindText(t, k)).join(' · ')}
                          {head !== null &&
                            ` · ${t('reviews.gate.bypass_commit', { sha: head.slice(0, 7) })}`}
                        </span>{' '}
                        · {String(b['bypass_reason'])}
                        <WaiverRevokedNote waiver={b} />
                        {waiver !== undefined && (
                          <WaiverRevoke
                            proj={projectSlug}
                            waiver={b}
                            roles={waiver.roles}
                            userId={waiver.userId}
                            onDone={waiver.onDone}
                          />
                        )}
                      </span>
                    );
                  })}
                </Td>
                <Td className="font-mono text-2xs text-text-mute">
                  {/* 리뷰가 없는 브랜치(면제만 있는 줄)는 커버 리뷰가 없다 — "null" 을 그리지 않는다 */}
                  {row['head_sha'] == null
                    ? '—'
                    : `${String(row['head_sha']).slice(0, 7)} · ${String(row['round_no'])}R`}
                </Td>
                <Td className="text-2xs text-text-mute">
                  {row['head_sha'] == null
                    ? '—'
                    : `${String(row['resolved'])}/${String(row['total'])}`}
                </Td>
                <Td>
                  <StatusBadge
                    token={VERDICT_TOKEN[verdict] ?? 'idle'}
                    label={t(`reviews.verdict.${verdict}` as 'reviews.verdict.passed')}
                  />
                  {/* 와이어프레임 ⑧의 「미커버 + BYPASS 1」 — 판정 옆에 면제 수를 적는다 */}
                  {active > 0 && (
                    <span
                      data-testid="gate-bypass-count"
                      className="mt-1 block text-2xs text-status-danger"
                    >
                      {t('reviews.gate.bypass_count', { count: active })}
                    </span>
                  )}
                  {/* **그 줄에서 면제한다**(2026-10-16 사람 결정 · REQ-WEB-332) — 와이어프레임 ⑧이 면제를 그린 자리다. 리뷰가 있는
                    줄도 둔다 — 면제는 그 브랜치에서 라운드가 없는 종류만 넘기고, 다른 종류에는 아직 라운드가 없을 수 있다 */}
                  {canWaive && (
                    <Button
                      size="xs"
                      variant="subtle"
                      data-testid="gate-waive"
                      aria-label={t('reviews.gate.waive_branch', { branch })}
                      aria-expanded={waiving === branch}
                      className="mt-1"
                      onClick={() => setWaiving(waiving === branch ? null : branch)}
                    >
                      {t('reviews.gate.waive')}
                    </Button>
                  )}
                </Td>
              </Tr>
              {waiving === branch && (
                <Tr>
                  <Td colSpan={4} className="pt-0">
                    {waiveForm(branch)}
                  </Td>
                </Tr>
              )}
            </Fragment>
          );
        })}
      </Table>
    </section>
  );
}
