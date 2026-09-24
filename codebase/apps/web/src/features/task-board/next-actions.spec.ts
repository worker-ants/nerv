// 작업 상태 → 다음 행동 표 (REQ-WEB-202 · screens.md §2.5)
//
// 표가 서버의 판정(`task.service.ts` 의 transition · assertMayTransition · claimInTx)을 미리
// 말하는지 본다. 어긋나면 사람은 켜진 단추를 누르고 거절당하거나, 된다는 것을 모른 채 멈춘다.

import { createTranslator } from '@nerv/schema';
import { describe, expect, it } from 'vitest';
import { nextActions } from './next-actions.js';
import type { TaskState } from './next-actions.js';

const t = createTranslator('ko');

function state(over: Partial<TaskState>): TaskState {
  return {
    status: 'backlog',
    delegationFilled: true,
    roles: ['developer'],
    liveClaim: 'none',
    expiredClaim: false,
    canFinish: false,
    ...over,
  };
}

const kinds = (s: Partial<TaskState>): string[] => nextActions(state(s), t).map((a) => a.kind);
const primary = (s: Partial<TaskState>) => nextActions(state(s), t).find((a) => a.primary);

describe('다음 행동 표', () => {
  it('4요소가 찬 backlog 는 [준비됨으로 올리기]가 주 행동이다 — 웹에서 만든 작업의 문', () => {
    expect(primary({ status: 'backlog' })).toMatchObject({ kind: 'to_ready', target: 'ready' });
  });

  it('4요소가 빈 backlog 는 [위임 명세 채우기]다 — 올릴 수 없는 단추를 세우지 않는다', () => {
    expect(kinds({ status: 'backlog', delegationFilled: false })).toEqual(['fill_brief']);
  });

  it('위임 명세는 planner·developer·admin 만 고친다 — designer 에게는 사유와 함께 잠긴다', () => {
    const fill = primary({ status: 'backlog', delegationFilled: false, roles: ['designer'] });
    expect(fill?.disabled).toBe('이 조작은 planner · developer · admin 만 할 수 있습니다');
  });

  it('ready 는 [클레임]이다 — viewer 에게는 잠긴다', () => {
    expect(primary({ status: 'ready' })?.kind).toBe('claim');
    expect(primary({ status: 'ready', roles: ['viewer'] })?.disabled).not.toBeNull();
  });

  it('backlog·blocked 에는 [클레임]이 없다 — 서버가 not_ready 로 거절한다', () => {
    expect(kinds({ status: 'backlog' })).not.toContain('claim');
    expect(kinds({ status: 'blocked', unblockSatisfied: true })).not.toContain('claim');
  });

  it('내가 잡은 claimed 는 [진행 시작] — 남이 잡았으면 사유와 함께 잠기고 planner 는 연다', () => {
    expect(primary({ status: 'claimed', liveClaim: 'mine' })).toMatchObject({
      kind: 'start',
      target: 'in_progress',
      disabled: null,
    });
    expect(primary({ status: 'claimed', liveClaim: 'other' })?.disabled).toContain('다른 사람');
    expect(primary({ status: 'claimed', liveClaim: 'other', roles: ['planner'] })?.disabled).toBe(
      null,
    );
  });

  it('진행 중은 [검토 요청]과 [완료…]다', () => {
    expect(kinds({ status: 'in_progress', liveClaim: 'mine', canFinish: true })).toEqual([
      'request_review',
      'finish',
    ]);
    expect(primary({ status: 'in_review', canFinish: true })?.kind).toBe('finish');
  });

  it('아무도 쥐지 않은 진행 중은 되돌린다 — 4요소가 비면 backlog 로', () => {
    const revert = nextActions(
      state({ status: 'in_progress', liveClaim: 'none', delegationFilled: false }),
      t,
    ).find((a) => a.kind === 'revert');
    expect(revert?.target).toBe('backlog');
  });

  it('리스가 지난 클레임만 걸려 있으면 [클레임]으로 되찾는다', () => {
    const claim = primary({ status: 'claimed', liveClaim: 'none', expiredClaim: true });
    expect(claim?.kind).toBe('claim');
    expect(claim?.hint).toContain('회수');
  });

  it('막힘 — 풀렸으면 [막힘 풀기], 서버가 모르면 [확인하고 풀기], 남았으면 잠긴다', () => {
    expect(primary({ status: 'blocked', unblockSatisfied: true })).toMatchObject({
      kind: 'unblock',
      label: '막힘 풀기',
      target: 'ready',
      disabled: null,
    });
    expect(primary({ status: 'blocked', unblockSatisfied: null })?.label).toBe('확인하고 풀기');
    expect(primary({ status: 'blocked', unblockSatisfied: false })?.disabled).not.toBeNull();
  });

  it('쥔 사람이 있는 막힘은 하던 일로 돌아간다 — 큐로 보내면 서버가 해제를 요구한다', () => {
    expect(primary({ status: 'blocked', unblockSatisfied: true, liveClaim: 'mine' })?.target).toBe(
      'in_progress',
    );
  });

  it('완료는 끝이다 — 단추가 없다', () => {
    expect(kinds({ status: 'done' })).toEqual([]);
  });
});
