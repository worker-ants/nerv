// 스펙의 **다음 할 일** 한 줄 (screens.md §2.4 · REQ-WEB-214)
//
// 이 화면의 거의 유일한 결정 단추 [검토 요청]이 본문 칸의 맨 끝에 있었다 — clemvion `data-model`
// 이라면 56화면 아래다(2026-09-24 UI/UX 검토 SPEC-02). 잠긴 이유는 block 일 때의 툴팁 하나였고,
// 검토 중이면 결재가 어디서 기다리는지, 승인본이면 무엇을 하면 되는지를 말하지 않았다. 이 줄은
// **보는 버전의 상태**로 그 셋을 말한다:
//
//   초안     → [검토 요청] (막혔으면 "사전 검토 block N건" 이 그 자리로 데려간다)
//   검토 중  → "결재는 받은 요청의 카드에서" + [받은 요청에서 열기] — 그 카드로 곧장
//   승인본   → [작업 만들기] — 약속을 작업으로 옮기는 문(SPEC-08). 요구사항이 없는 문서도 된다
//   반려·대체 → 무엇이 일어났는지와 갈 곳
//
// 곁에는 열린 코멘트 수(2026-09-24 사람 결정 D6 — 레일의 기본 탭은 두고 칩만 둔다)와 요구사항 수가
// 서고, 누르면 레일의 그 탭이 열린다.

import { TASK_CREATE_ROLES } from '@nerv/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { useT } from '../../lib/i18n.js';
import { Button } from '../../components/ui/primitives.js';

export interface NextStepProps {
  proj: string;
  spec: string;
  /** 보는 버전 — `?v=` 가 있으면 그 버전, 없으면 기본(최신 승인본) */
  viewed: Record<string, unknown> | undefined;
  /** 기본이 아닌 버전을 보는 중인가 */
  viewingPast: boolean;
  /** 사전 검토의 block 수 — 0 이 아니면 [검토 요청]이 잠긴다 */
  checkBlocks: number;
  openComments: number;
  requirementCount: number;
  canCreateTask: boolean;
  submitting: boolean;
  onSubmit: () => void;
  /** 레일의 그 탭을 연다 — 이 줄이 여는 것은 둘뿐이다 */
  onRail: (tab: 'comments' | 'requirements') => void;
}

const chip =
  'rounded-nerv-sm border border-border bg-bg px-2 py-0.5 text-2xs text-text-mute hover:border-border-strong hover:text-text';

export function NextStep({
  proj,
  spec,
  viewed,
  viewingPast,
  checkBlocks,
  openComments,
  requirementCount,
  canCreateTask,
  submitting,
  onSubmit,
  onRail,
}: NextStepProps): React.JSX.Element | null {
  const t = useT();
  const navigate = useNavigate();
  if (viewed === undefined) return null;
  const status = String(viewed['doc_status'] ?? '');
  const versionId = String(viewed['version_id'] ?? '');
  const versionNo = Number(viewed['version_no']);
  const pending =
    typeof viewed['pending_approval_id'] === 'string' ? viewed['pending_approval_id'] : null;
  // 에이전트에게 넘길 일이 있는 상태 — 본문을 쓰는 것은 에이전트다(REQ-WEB-173)
  const handoff = status === 'draft' || status === 'rejected' || status === 'approved';

  let message: string;
  let actions: React.ReactNode = null;
  if (versionId === '') {
    message = t('spec.next.no_version');
  } else if (status === 'draft') {
    message = t('spec.next.draft');
    actions = (
      <>
        <Button
          size="sm"
          variant="primary"
          data-testid="submit-review"
          disabled={submitting || checkBlocks > 0}
          onClick={onSubmit}
        >
          {t('spec.submit_review')}
        </Button>
        {/* **잠긴 이유를 단추 곁에서 말하고, 그 자리로 데려간다** — 툴팁 하나로는 고칠 곳을 모른다 */}
        {checkBlocks > 0 && (
          <button
            type="button"
            data-testid="submit-blocked"
            onClick={() =>
              document
                .querySelector('[data-testid="check-findings"]')
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }
            className="text-2xs text-status-danger underline-offset-2 hover:underline"
          >
            {t('spec.next.blocked', { count: checkBlocks })}
          </button>
        )}
      </>
    );
  } else if (status === 'in_review') {
    message = t('spec.next.in_review');
    actions = (
      <Link
        to="/inbox"
        search={pending === null ? {} : { focus: pending }}
        data-testid="spec-next-inbox"
        className="rounded-nerv-sm bg-status-action px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
      >
        {t('spec.next.open_inbox')} ↗
      </Link>
    );
  } else if (status === 'approved') {
    message = t('spec.next.approved');
    actions = canCreateTask ? (
      <Link
        to="/p/$proj/tasks"
        params={{ proj }}
        search={{
          from_spec: spec,
          from_version: versionId,
          from_version_no: String(versionNo),
        }}
        data-testid="spec-next-derive"
        className="rounded-nerv-sm bg-status-action px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
      >
        {t('spec.next.derive')}
      </Link>
    ) : (
      <Button
        size="sm"
        disabled
        data-testid="spec-next-derive"
        title={t('task.next.roles_only', { roles: TASK_CREATE_ROLES.join(' · ') })}
      >
        {t('spec.next.derive')}
      </Button>
    );
  } else if (status === 'rejected') {
    message = t('spec.next.rejected');
  } else {
    message = t('spec.next.superseded');
  }

  return (
    <section
      data-testid="spec-next"
      data-status={status}
      aria-label={t('spec.next.label')}
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-nerv border border-border bg-bg-elev px-3 py-2 text-sm"
    >
      <span data-testid="spec-next-message" className="min-w-0 text-text-mute">
        {message}
      </span>
      {actions}
      {/* 다른 버전을 보고 있으면 **기본으로 돌아가는 길** — 대체된 버전을 연 사람의 다음 걸음이다 */}
      {viewingPast && status !== 'draft' && status !== 'in_review' && (
        <button
          type="button"
          data-testid="spec-next-latest"
          onClick={() =>
            void navigate({ to: '.', search: ({ v: _v, diff: _diff, ...rest }) => rest })
          }
          className={chip}
        >
          {t('spec.next.latest')}
        </button>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {openComments > 0 && (
          <button
            type="button"
            data-testid="spec-next-comments"
            onClick={() => onRail('comments')}
            className={chip}
          >
            {t('spec.next.comments', { count: openComments })}
          </button>
        )}
        {requirementCount > 0 && (
          <button
            type="button"
            data-testid="spec-next-requirements"
            onClick={() => onRail('requirements')}
            className={chip}
          >
            {t('spec.next.requirements', { count: requirementCount })}
          </button>
        )}
        {handoff && (
          <button
            type="button"
            data-testid="spec-next-handoff"
            onClick={() => {
              const card = document.getElementById('spec-handoff');
              card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              card?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
            }}
            className={chip}
          >
            {t('spec.next.handoff')}
          </button>
        )}
      </span>
    </section>
  );
}
