// E11-S01·S02 — plan → Task 매핑 (importer.md §2.6)
//
// 이 파일이 지키는 것은 **하지 않는 일들**이다. 임포터가 그럴듯하게 채우기 시작하면
// 임포트 직후의 보드는 "아무도 책임지지 않는 작업"으로 가득 차고, 그것이 clemvion 이
// 이미 겪은 상태다(빈 약속 · 무장 해제된 가드).

import { setLocaleForTesting } from '../i18n.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { classifyPlan, mapSpecImpact, parseOwnerMap } from './plan.js';

const OPTIONS = { unstartedSentinel: '(unstarted)', importedAt: '2026-08-22T00:00:00.000Z' };

function classify(path: string, frontmatter: Record<string, unknown>, body = '# 제목\n본문') {
  return classifyPlan({ path, frontmatter, body }, OPTIONS);
}

// 출력 검사는 한국어 화면 기준이다 — 기계의 LANG 에 따라 검사 대상이 바뀌면 안 된다
beforeAll(() => setLocaleForTesting('ko'));

describe('상태 매핑 — ready 는 절대 나오지 않는다 (REQ-IMP-009)', () => {
  it('complete/ 는 done 이다', () => {
    expect(classify('plan/complete/x.md', { worktree: 'wt-1' }).task?.status).toBe('done');
  });

  it('in-progress/ + (unstarted) 는 backlog 다 — ready 가 아니다', () => {
    const task = classify('plan/in-progress/x.md', { worktree: '(unstarted)' }).task;
    expect(task?.status).toBe('backlog');
  });

  /**
   * **임포트가 만든 진행 중은 아무도 하지 않는 진행 중이다**(2026-09-07 · 사람 결정 ·
   * REQ-IMP-031). 원본의 worktree 는 "그 저장소에서 누군가 작업 중이었다" 는 사실이지
   * 이 플랫폼의 세션이 그 Task 를 쥐고 있다는 뜻이 아니다 — 그렇게 적재하면 활성 클레임
   * 없는 `in_progress` 가 되고(실측 24건), 그 Task 는 큐에도 안 보이고 리스 만료로
   * 회수되지도 않는다. 사실은 리포트에 남고 상태는 backlog 다.
   */
  it('in-progress/ + worktree 값은 backlog + 경고다 — 클레임 없는 진행 중을 만들지 않는다', () => {
    const result = classify('plan/in-progress/x.md', { worktree: 'wt-7' });
    expect(result.task?.status).toBe('backlog');
    expect(result.task?.warnings.join(' ')).toContain('wt-7');
  });

  it('research/ 는 Task 를 만들지 않는다 — 참고 문서다', () => {
    const result = classify('plan/research/x.md', {});
    expect(result.kind).toBe('reference');
    expect(result.task).toBeNull();
  });

  it('worktree 미선언은 backlog + 경고다 — 값을 지어내지 않는다', () => {
    const task = classify('plan/in-progress/x.md', {}).task;
    expect(task?.status).toBe('backlog');
    expect(task?.warnings.join()).toContain('worktree 미선언');
  });
});

describe('추정 금지', () => {
  it('started 가 없으면 임포트 시각 + 경고다 — git 이력으로 메우지 않는다', () => {
    const task = classify('plan/complete/x.md', { worktree: 'wt' }).task;
    expect(task?.started).toBe(OPTIONS.importedAt);
    expect(task?.warnings.join()).toContain('started 미선언');
  });

  it('priority 는 선언된 것만 — 미선언은 null 이다', () => {
    expect(classify('plan/complete/x.md', { priority: 'P1' }).task?.priority).toBe('P1');
    expect(classify('plan/complete/x.md', {}).task?.priority).toBeNull();
    expect(classify('plan/complete/x.md', { priority: '높음' }).task?.priority).toBeNull();
  });

  it('title 은 첫 헤딩, 없으면 파일명이다', () => {
    expect(classify('plan/complete/widget-embed.md', {}, '본문만').task?.title).toBe(
      'widget-embed',
    );
    expect(classify('plan/complete/x.md', {}, '# 위젯 임베드\n\n본문').task?.title).toBe(
      '위젯 임베드',
    );
  });

  it('본문은 바이트 보존이다 — 체크박스를 분해하지 않는다(기본 off)', () => {
    const body = '# 제목\n\n- [x] 하나\n- [ ] 둘';
    expect(classify('plan/complete/x.md', {}, body).task?.body_md).toBe(body);
  });
});

describe('E11-S02 owner 는 신원이 아니다', () => {
  it('매핑 테이블에 있으면 배정한다', () => {
    const result = classifyPlan(
      { path: 'plan/complete/x.md', frontmatter: { owner: 'developer' }, body: '# x' },
      { ...OPTIONS, ownerMap: { developer: 'user-1' } },
    );
    expect(result.task?.assignee_user_id).toBe('user-1');
  });

  it('없으면 unassigned + 수동 배정 큐 경고다 — 자유 텍스트를 계정으로 추정하지 않는다', () => {
    const result = classifyPlan(
      {
        path: 'plan/complete/x.md',
        frontmatter: { owner: 'developer (다음 진입자)' },
        body: '# x',
      },
      { ...OPTIONS, ownerMap: { developer: 'user-1' } },
    );
    expect(result.task?.assignee_user_id).toBeNull();
    expect(result.task?.warnings.join()).toContain('수동 배정');
  });

  it('owner-map 형식이 틀리면 던진다 — 조용히 전원 unassigned 가 되지 않게', () => {
    expect(() => parseOwnerMap('["developer"]')).toThrow();
    expect(() => parseOwnerMap('{"developer": 3}')).toThrow();
    expect(parseOwnerMap('{"developer":"u1"}')).toEqual({ developer: 'u1' });
  });
});

describe('spec_impact — Gate C 어휘', () => {
  it('sentinel 4종은 {none:true} 다', () => {
    for (const sentinel of ['none', '없음', 'N/A', 'na']) {
      expect(mapSpecImpact(sentinel, [])).toEqual({ none: true });
    }
  });

  it('경로는 보존하고 해소 실패를 경고로 남긴다', () => {
    const warnings: string[] = [];
    expect(mapSpecImpact(['spec/widget.md', 'spec/session.md'], warnings)).toEqual({
      paths: ['spec/widget.md', 'spec/session.md'],
    });
    expect(warnings.join()).toContain('수동 확인');
  });

  it('선언이 없으면 null 이다 — {none:true} 로 채우지 않는다', () => {
    expect(mapSpecImpact(undefined, [])).toBeNull();
    expect(mapSpecImpact('', [])).toBeNull();
  });
});

describe('복합 owner 라벨 — 매핑은 사람이 준다 (0003_multi_role)', () => {
  // clemvion 실측에서 `planner/developer` 류가 20건이다. 겸직이 흔한 형태라는 신호를
  // 데이터가 먼저 보내고 있었고, 그래서 멤버십이 다중 역할을 담게 됐다.
  //
  // 다만 **임포터는 여전히 추정하지 않는다.** 쪼개서 첫 조각을 쓰면 `developer (다음
  // 진입자)`(=사람이 아직 없다)까지 특정인에게 붙는다. 복합 라벨은 owner-map 에 그대로
  // 적는 것이 답이고, 그것은 코드가 아니라 운영자의 판단이다.
  const owner = (label: string, map: Record<string, string>): string | null =>
    classifyPlan(
      { path: 'plan/in-progress/x.md', frontmatter: { owner: label, worktree: 'wt' }, body: '# x' },
      { unstartedSentinel: '(unstarted)', ownerMap: map, importedAt: '2026-08-23T00:00:00Z' },
    ).task?.assignee_user_id ?? null;

  it('복합 라벨을 키로 적으면 배정된다', () => {
    expect(owner('planner/developer', { 'planner/developer': 'u-jimin' })).toBe('u-jimin');
    expect(owner('project-planner + developer', { 'project-planner + developer': 'u-jimin' })).toBe(
      'u-jimin',
    );
  });

  it('적지 않으면 미배정이다 — 조각을 보고 추정하지 않는다', () => {
    expect(owner('planner/developer', { planner: 'u-plan', developer: 'u-dev' })).toBeNull();
  });
});
