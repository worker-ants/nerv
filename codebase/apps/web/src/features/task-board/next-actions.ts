// 작업 상태 → 다음 행동 — **한 곳에서 정한다** (screens.md §2.5 · REQ-WEB-202)
//
// 2026-09-24 까지 작업 상세의 전이 단추는 상태를 보지 않았다. 있는 것은 [완료로 전이] ·
// [막힘으로 전이] · (아무도 쥐지 않은 진행 중에만) 되돌리기뿐이라,
//   - 웹에서 4요소를 다 채워 만든 작업이 backlog 를 나갈 문이 없었다(생성은 언제나 backlog 다)
//   - 막힌 작업에 "이제 풀 수 있습니다" 배지만 서고 누를 단추가 없었다
//   - 웹에서 클레임한 사람이 claimed 에서 진행·검토로 옮길 길이 없었다
//   - [클레임]은 done 만 아니면 켜져 있어 backlog 에서 눌렀다가 not_ready 로 거절당했다
// 매뉴얼은 없는 [진행 중] 단추를 가르쳤다. 이 표가 상세 머리의 단추를 정하고, 누를 수 없는
// 단추는 **숨기지 않고 사유를 단다**(REQ-WEB-003) — 서버가 받을 것만 켠다(§1.8).
//
// 판정의 정본은 서버다(`task.service.ts` 의 `transition` · `assertMayTransition` · `claimInTx`).
// 이 표는 그것을 **미리 말하는** 것이고, 어긋나면 서버의 거절이 단추 옆에 남는다(REQ-WEB-018).

import { TASK_EDIT_ROLES, rolesWithScope, scopesForRoles } from '@nerv/schema';
import type { Translator } from '@nerv/schema';

export type NextActionKind =
  | 'fill_brief'
  | 'to_ready'
  | 'claim'
  | 'start'
  | 'request_review'
  | 'finish'
  | 'unblock'
  | 'revert';

export type TransitionTarget = 'ready' | 'backlog' | 'in_progress' | 'in_review';

export interface NextAction {
  kind: NextActionKind;
  /** 주 행동 — 한 화면에 하나 */
  primary: boolean;
  /** 전이라면 목표 상태 */
  target?: TransitionTarget;
  label: string;
  /** 누를 수 없는 이유 — 있으면 비활성 + 이 문장을 툴팁으로 */
  disabled: string | null;
  /** 켜져 있을 때의 설명 */
  hint?: string;
}

export interface TaskState {
  status: string;
  /** 위임 명세 4요소가 찼는가 — 자리표시자는 빈 것이다(`isDelegationFilled`) */
  delegationFilled: boolean;
  /** 막힘 해소 판정(REQ-API-118) — `null` 은 "서버가 모른다", 막히지 않았으면 `undefined` */
  unblockSatisfied?: boolean | null | undefined;
  /** 이 프로젝트에서의 내 역할(겸직 합집합) */
  roles: readonly string[];
  /** 살아 있는 클레임 — 없음 · 내 것 · 남의 것 */
  liveClaim: 'none' | 'mine' | 'other';
  /** 리스가 지난 클레임이 걸려 있다 — 클레임이 그것을 회수하고 잡는다(서버 `claimInTx`) */
  expiredClaim: boolean;
  /** 완료로 옮길 수 있는 사람인가(REQ-WEB-141) */
  canFinish: boolean;
}

/** "이 조작은 planner · developer · admin 만 할 수 있습니다" — 역할 목록은 한 벌에서 온다 */
function rolesOnly(t: Translator, roles: readonly string[]): string {
  return t('task.next.roles_only', { roles: roles.join(' · ') });
}

export function nextActions(state: TaskState, t: Translator): NextAction[] {
  const scopes = scopesForRoles(state.roles);
  const canUpdate = scopes.has('task:update');
  const canClaim = scopes.has('task:claim');
  const canEdit = state.roles.some((r) => (TASK_EDIT_ROLES as readonly string[]).includes(r));
  // planner·admin 은 남의 클레임이 걸린 작업도 정리한다(서버 `assertMayTransition`)
  const privileged = state.roles.some((r) => r === 'planner' || r === 'admin');
  const updateBlock = canUpdate ? null : rolesOnly(t, rolesWithScope('task:update'));
  const claimBlock = canClaim ? null : rolesOnly(t, rolesWithScope('task:claim'));
  const editBlock = canEdit ? null : rolesOnly(t, TASK_EDIT_ROLES);
  // 남이 쥐고 있으면 옮길 수 없다 — planner·admin 만 예외다
  const heldBlock =
    state.liveClaim === 'other' && !privileged ? t('task.next.held_by_other') : null;
  const moveBlock = updateBlock ?? heldBlock;

  const finish = (primary: boolean): NextAction => ({
    kind: 'finish',
    primary,
    label: t('task.next.finish'),
    disabled: state.canFinish ? null : t('task.done_needs_claim'),
  });
  const claim = (primary: boolean, reclaim: boolean): NextAction => ({
    kind: 'claim',
    primary,
    label: t('task.claim'),
    disabled: claimBlock,
    ...(reclaim ? { hint: t('task.next.reclaim_hint') } : {}),
  });
  // 아무도 쥐지 않은 진행 중 — 다시 잡을 길이 없어 사람이 되돌린다. 4요소가 비면 backlog 다
  const revert = (primary: boolean): NextAction => ({
    kind: 'revert',
    primary,
    target: state.delegationFilled ? 'ready' : 'backlog',
    label: t(state.delegationFilled ? 'task.to_ready' : 'task.to_backlog'),
    disabled: updateBlock,
  });

  switch (state.status) {
    case 'backlog':
      return state.delegationFilled
        ? [
            {
              kind: 'to_ready',
              primary: true,
              target: 'ready',
              label: t('task.next.to_ready'),
              disabled: updateBlock,
              hint: t('task.next.to_ready_hint'),
            },
          ]
        : [
            {
              kind: 'fill_brief',
              primary: true,
              label: t('task.next.fill_brief'),
              disabled: editBlock,
            },
          ];
    case 'ready':
      return [claim(true, false)];
    case 'claimed':
      if (state.liveClaim === 'none') {
        return state.expiredClaim ? [claim(true, true), finish(false)] : [revert(true)];
      }
      return [
        {
          kind: 'start',
          primary: true,
          target: 'in_progress',
          label: t('task.next.start'),
          disabled: moveBlock,
        },
        finish(false),
      ];
    case 'in_progress':
      return [
        {
          kind: 'request_review',
          primary: true,
          target: 'in_review',
          label: t('task.next.request_review'),
          disabled: moveBlock,
        },
        finish(false),
        ...(state.liveClaim === 'none'
          ? [state.expiredClaim ? claim(false, true) : revert(false)]
          : []),
      ];
    case 'in_review':
      return [finish(true)];
    case 'blocked': {
      // 풀리면 어디로 가는가 — 쥔 사람이 있으면 하던 일로, 없으면 큐(4요소가 비면 backlog)로
      const target: TransitionTarget =
        state.liveClaim !== 'none' ? 'in_progress' : state.delegationFilled ? 'ready' : 'backlog';
      const pendingBlock = state.unblockSatisfied === false ? t('task.next.unblock_pending') : null;
      return [
        {
          kind: 'unblock',
          primary: true,
          target,
          label: t(
            state.unblockSatisfied === null ? 'task.next.unblock_manual' : 'task.next.unblock',
          ),
          disabled: moveBlock ?? pendingBlock,
          ...(state.unblockSatisfied === null ? { hint: t('task.blocked.human_only') } : {}),
        },
      ];
    }
    default:
      return [];
  }
}
