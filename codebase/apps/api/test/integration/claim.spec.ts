// E04 — 클레임·리스 엔진. **Phase 0 종료 게이트의 직접 대상이다.**
//
//   두 호스트·세 세션 90분 동시 작업에서 중복 클레임 0건,
//   겹침 경고 10/10 검출·오탐 0 (scope.md §1.3 · backlog §5.1~5.3)
//
// 동시성은 mock 으로 검증하지 않는다(codebase.md §4.3). 여기서 도는 것은 실제 Postgres 의
// 행 잠금·조건부 UPDATE·부분 unique 다 — 그 셋이 함께 동작해야 "중복 클레임 0건"이 성립한다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { QuestionService } from '../../src/modules/approval/question.service.js';
import { ApprovalService } from '../../src/modules/approval/approval.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let tasks: TaskService;
let claims: ClaimService;
let questions: QuestionService;
let sessions: SessionService;
let drizzleDb: ReturnType<typeof drizzle>;

/** 시나리오 등장인물 — backlog §5.1~5.3 과 같은 한 벌 */
let projectId: string;
let hana: string; // mac-07
let dohyun: string; // mac-02
let yuna: string; // linux-ci-01 / codex
let sessionHana: string;
let sessionDohyun: string;
let sessionYuna: string;
let specParent: string;
let specA: string;
let specB: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_claim');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url, max: 20 });
  drizzleDb = drizzle(pool);

  // 방송은 이 스위트의 관심사가 아니다 — 여기서 보는 것은 트랜잭션·행 잠금·부분 unique 다.
  // 실제 Valkey 를 붙이면 동시성 측정에 네트워크 지연이 섞이고, 죽은 Valkey 를 붙이면
  // 재시도 대기가 섞인다. 방송 규약 자체는 event-broadcast.spec 이 실물로 검증한다.
  const silentValkey = {
    publish: async () => false,
    subscribe: async () => undefined,
    failureCount: 0,
  } as unknown as ValkeyService;
  const events = new EventService(drizzleDb, silentValkey);

  claims = new ClaimService();
  // 하트비트 역채널은 이 스위트의 관심사가 아니다 — 질문이 없으면 빈 목록이다.
  questions = new QuestionService(events, drizzleDb);
  sessions = new SessionService(events, drizzleDb);
  // 플랜 승인 게이트가 카드를 만드는 자리 — 이 스위트도 그 서비스를 들고 있어야 한다
  // 플랜 승인 게이트가 카드를 만드는 자리 — 이 스위트는 그 게이트에 닿지 않지만
  // 서비스는 들고 있어야 한다(SpecService·AuthService 는 이 경로에서 쓰이지 않는다)
  const approvals = new ApprovalService(events, null as never, null as never, drizzleDb);
  tasks = new TaskService(claims, events, questions, sessions, approvals, drizzleDb);

  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  // Task·클레임만 초기화한다 — 테넌시·스펙·세션은 유지한다.
  // CASCADE 는 쓰지 않는다: agent_session.current_task_id 가 task 를 참조하므로 연쇄가
  // 세션·스펙까지 번져 시드를 통째로 날린다(실측). FK 의존 순서대로 지운다.
  await pool.query('UPDATE agent_session SET current_task_id = NULL');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task_dependency');
  // 증적은 Task 를 참조한다 — 먼저 지우지 않으면 done 전이를 만든 테스트 뒤로
  // 이 스위트 전체가 FK 위반으로 무너진다
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM event');
});

// ── E04-S01 원자적 클레임 ───────────────────────────────────────────────────

/** 클레임을 쥔 주체 — 하트비트·해제는 보유자만 부를 수 있다(EP-TASK-07·08) */
function actor(
  sessionId: string | null,
  userId: string,
  isAdmin = false,
): { projectId: string; userId: string; sessionId: string | null; isAdmin: boolean } {
  return { projectId, userId, sessionId, isAdmin };
}

describe('E04-S01 원자적 클레임 (성공 기준 0-1·0-2)', () => {
  it('세 세션이 같은 ready Task 를 동시에 잡으면 정확히 1건만 성공한다', async () => {
    const taskId = await makeTask('CLV-T-0CFQC2');

    const results = await Promise.allSettled([
      tasks.claim(claimInput(taskId, sessionHana, hana)),
      tasks.claim(claimInput(taskId, sessionDohyun, dohyun)),
      tasks.claim(claimInput(taskId, sessionYuna, yuna)),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);

    // DB 에도 활성 클레임은 하나뿐이다 — 부분 unique 가 최종 방어선이다
    expect(await count(`SELECT count(*)::int AS n FROM claim WHERE status='active'`)).toBe(1);
    expect(await scalarText(`SELECT status::text FROM task WHERE id='${taskId}'`)).toBe('claimed');
    // task.claimed 이벤트도 정확히 1건
    expect(await count(`SELECT count(*)::int AS n FROM event WHERE type='task.claimed'`)).toBe(1);
  });

  it('부하: 요청묶음 20회 × 3세션 동시 클레임 — 묶음마다 성공 정확히 1 (0-1 재현)', async () => {
    let totalWinners = 0;
    for (let round = 0; round < 20; round += 1) {
      const taskId = await makeTask(`TSK-load-${round}`);
      const results = await Promise.allSettled([
        tasks.claim(claimInput(taskId, sessionHana, hana)),
        tasks.claim(claimInput(taskId, sessionDohyun, dohyun)),
        tasks.claim(claimInput(taskId, sessionYuna, yuna)),
      ]);
      const winners = results.filter((r) => r.status === 'fulfilled').length;
      expect({ round, winners }).toEqual({ round, winners: 1 });
      totalWinners += winners;
    }
    expect(totalWinners).toBe(20);

    // 같은 Task 가 두 세션에서 동시에 잡힌 구간이 있는가 — 0건이어야 한다(0-1 판정 질의)
    const dup = await count(`
      SELECT count(*)::int AS n FROM (
        SELECT task_id FROM claim WHERE status='active' GROUP BY task_id HAVING count(*) > 1
      ) x`);
    expect(dup).toBe(0);
  });

  it('ready 가 아니면 클레임하지 않는다', async () => {
    const taskId = await makeTask('TSK-backlog', { status: 'backlog' });
    await expect(tasks.claim(claimInput(taskId, sessionHana, hana))).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
  });

  it('같은 세션의 재호출은 기존 클레임을 돌려준다 — 멱등(리스 연장 없음)', async () => {
    const taskId = await makeTask('TSK-idem');
    const first = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const second = await tasks.claim(claimInput(taskId, sessionHana, hana));

    expect(second.claimId).toBe(first.claimId);
    expect(second.replayed).toBe(true);
    expect(second.leaseExpiresAt.getTime()).toBe(first.leaseExpiresAt.getTime());
    expect(await count(`SELECT count(*)::int AS n FROM claim`)).toBe(1);
  });

  it('위임 명세 4요소가 비면 클레임을 거부하고 누락 요소를 알려준다 (E04-S05)', async () => {
    // CHECK 를 우회해 ready 로 만든 뒤(임포트 레거시 경로 가정) 서비스가 막는지 본다
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-nospec','명세 미비','backlog','목표만',NULL,NULL,NULL)`,
      [taskId, projectId],
    );
    await pool.query(`UPDATE task SET status='ready' WHERE id=$1`, [taskId]).catch(() => {
      /* CHECK 가 막으면 그것도 정답이다 — 아래에서 서비스 경로를 따로 확인한다 */
    });

    expect(() =>
      tasks.assertDelegationSpec({
        goal_md: '목표만',
        output_format_md: null,
        tools_sources_md: null,
        boundaries_md: null,
      }),
    ).toThrowError(expect.objectContaining({ code: NERV_ERROR.PRECONDITION }));
  });
});

// ── E04-S02 scope 겹침 ─────────────────────────────────────────────────────

describe('E04-S02 scope 겹침 판정 (성공 기준 0-3)', () => {
  it('같은 스펙을 두 세션이 직접 선언하면 차단하고 상대 정보를 돌려준다', async () => {
    const t1 = await makeTask('TSK-a');
    const t2 = await makeTask('TSK-b');

    await tasks.claim(claimInput(t1, sessionDohyun, dohyun, { specIds: [specA], fileGlobs: [] }));

    let error: { code: string; details: Record<string, unknown> } | null = null;
    try {
      await tasks.claim(claimInput(t2, sessionHana, hana, { specIds: [specA], fileGlobs: [] }));
    } catch (e) {
      error = e as { code: string; details: Record<string, unknown> };
    }

    expect(error?.code).toBe(NERV_ERROR.CONFLICT_SCOPE);
    const overlaps = error?.details['overlaps'] as Record<string, unknown>[];
    expect(overlaps).toHaveLength(1);
    // 상대 사용자·hostname·scope 를 그대로 돌려준다(agent-integration §2.4)
    expect(overlaps[0]).toMatchObject({ user_id: dohyun, hostname: 'mac-02', severity: 'block' });

    // 차단은 롤백이다 — Task 는 ready 로 남고 클레임도 늘지 않는다
    expect(await scalarText(`SELECT status::text FROM task WHERE id='${t2}'`)).toBe('ready');
    expect(await count(`SELECT count(*)::int AS n FROM claim WHERE status='active'`)).toBe(1);
  });

  it('트리 폐포로만 만나면 경고다 — 부모·자식 스펙은 차단하지 않는다', async () => {
    const t1 = await makeTask('TSK-parent');
    const t2 = await makeTask('TSK-child');

    await tasks.claim(
      claimInput(t1, sessionDohyun, dohyun, { specIds: [specParent], fileGlobs: [] }),
    );
    const result = await tasks.claim(
      claimInput(t2, sessionHana, hana, { specIds: [specA], fileGlobs: [] }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.severity).toBe('warn');
    expect(result.warnings[0]?.hostname).toBe('mac-02');
    // 통과시킨다 — 경고는 넓게, 차단은 좁게
    expect(await scalarText(`SELECT status::text FROM task WHERE id='${t2}'`)).toBe('claimed');
    expect(
      await count(`SELECT count(*)::int AS n FROM event WHERE type='claim.conflict_warn'`),
    ).toBe(1);
  });

  it('파일 glob 이 겹치면 경고한다 — 스펙이 달라도', async () => {
    const t1 = await makeTask('TSK-f1');
    const t2 = await makeTask('TSK-f2');

    await tasks.claim(
      claimInput(t1, sessionDohyun, dohyun, {
        specIds: [],
        fileGlobs: ['codebase/frontend/src/widget/**'],
      }),
    );
    const result = await tasks.claim(
      claimInput(t2, sessionHana, hana, {
        specIds: [],
        fileGlobs: ['codebase/frontend/src/widget/loader.ts'],
      }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.fileHit).toEqual([
      ['codebase/frontend/src/widget/loader.ts', 'codebase/frontend/src/widget/**'],
    ]);
  });

  it('겹치는 클레임 10회 → 10/10 검출, 겹치지 않는 20회 → 오탐 0 (0-3 판정)', async () => {
    let detected = 0;
    for (let i = 0; i < 10; i += 1) {
      const holder = await makeTask(`TSK-hold-${i}`);
      const rival = await makeTask(`TSK-rival-${i}`);
      await tasks.claim(
        claimInput(holder, sessionDohyun, dohyun, {
          specIds: [],
          fileGlobs: [`codebase/area-${i}/**`],
        }),
      );
      const r = await tasks.claim(
        claimInput(rival, sessionHana, hana, {
          specIds: [],
          fileGlobs: [`codebase/area-${i}/deep/file.ts`],
        }),
      );
      if (r.warnings.length > 0) detected += 1;
      await pool.query('DELETE FROM claim');
    }
    expect(detected).toBe(10);

    let falsePositives = 0;
    for (let i = 0; i < 20; i += 1) {
      const holder = await makeTask(`TSK-h2-${i}`);
      const other = await makeTask(`TSK-o2-${i}`);
      await tasks.claim(
        claimInput(holder, sessionDohyun, dohyun, {
          specIds: [],
          fileGlobs: [`codebase/left-${i}/**`],
        }),
      );
      const r = await tasks.claim(
        claimInput(other, sessionHana, hana, {
          specIds: [],
          fileGlobs: [`codebase/right-${i}/**`],
        }),
      );
      if (r.warnings.length > 0) falsePositives += 1;
      await pool.query('DELETE FROM claim');
    }
    expect(falsePositives).toBe(0);
  });

  it('자기 세션의 클레임과는 겹치지 않는다', async () => {
    const t1 = await makeTask('TSK-self1');
    const t2 = await makeTask('TSK-self2');
    await tasks.claim(claimInput(t1, sessionHana, hana, { specIds: [specA], fileGlobs: [] }));
    const r = await tasks.claim(
      claimInput(t2, sessionHana, hana, { specIds: [specA], fileGlobs: [] }),
    );
    expect(r.warnings).toEqual([]);
  });
});

// ── E04-S03·S04 리스 ───────────────────────────────────────────────────────

describe('E04-S03 하트비트·리스 연장', () => {
  it('유효한 claim_id 로 하트비트하면 새 만료 시각을 준다', async () => {
    const taskId = await makeTask('TSK-hb');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana, undefined, 60));

    const before = claim.leaseExpiresAt.getTime();
    const beat = await tasks.heartbeat({
      claimId: claim.claimId,
      leaseSeconds: 1800,
      actor: actor(sessionHana, hana),
    });
    expect(beat.leaseExpiresAt.getTime()).toBeGreaterThan(before);
  });

  // 2026-09-01 사람 보고 — "세션에서 에이전트에게 메세지를 보내면 오류가 발생".
  // 화면은 지시를 잘 넣고 있었고 `takePendingInstructions` 도 있었는데 **부르는 곳이
  // 없었다** — 지시는 activity 에 앉아 아무에게도 가지 않았다. 하트비트가 에이전트와
  // 서버가 정기적으로 만나는 유일한 자리라 전달도 그 자리에서 한다.
  //
  // (`stop` 은 클레임을 회수하므로 하트비트 자체가 NERV_LEASE_EXPIRED 로 끝난다 —
  //  그 오류가 곧 정지 신호다. 여기서 보는 것은 클레임이 살아 있는 `steer` 다.)
  it('사람이 보낸 지시가 하트비트에 실려 나간다 — 한 번만 (REQ-API-072)', async () => {
    const taskId = await makeTask('TSK-steer');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    await sessions.steer({
      projectId,
      sessionId: sessionHana,
      kind: 'steer',
      message: '그 방향은 아니다',
      userId: hana,
    });

    const beat = await tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionHana, hana) });
    expect(beat.pending).toHaveLength(1);
    expect(beat.pending[0]).toMatchObject({ kind: 'steer', message: '그 방향은 아니다' });

    // 두 번 주면 에이전트가 같은 지시를 두 번 따른다
    expect(
      (await tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionHana, hana) })).pending,
    ).toEqual([]);
  });

  it('지시가 답변보다 앞선다 — 방향을 바꾸라는 말이 먼저 읽혀야 한다', async () => {
    const taskId = await makeTask('TSK-steer-order');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const asked = await questions.create({
      projectId,
      sessionId: sessionHana,
      title: '이대로 진행할까요?',
    });
    await questions.answer({
      projectId,
      questionId: asked.question_id,
      userId: hana,
      answerMd: '그렇게 하자',
    });
    await sessions.steer({
      projectId,
      sessionId: sessionHana,
      kind: 'steer',
      message: '아니, 이쪽이다',
      userId: hana,
    });

    const beat = await tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionHana, hana) });
    expect(beat.pending.map((p) => (p as Record<string, unknown>)['kind'])).toEqual([
      'steer',
      'question_answered',
    ]);
  });

  it('만료된 리스로 하트비트하면 NERV_LEASE_EXPIRED', async () => {
    const taskId = await makeTask('TSK-expired');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 minute' WHERE id=$1`,
      [claim.claimId],
    );

    await expect(
      tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionHana, hana) }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.LEASE_EXPIRED,
    });
  });
});

describe('E04-S04 만료 자동 회수 (성공 기준 0-4)', () => {
  it('TTL 을 넘긴 클레임을 회수하고 Task 를 ready 로 되돌린다 — 사람 개입 0회', async () => {
    const taskId = await makeTask('CLV-T-TRA25N');
    const claim = await tasks.claim(claimInput(taskId, sessionYuna, yuna));
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 second' WHERE id=$1`,
      [claim.claimId],
    );

    const reclaimed = await drizzleDb.transaction(async (tx) => claims.reclaimExpired(tx));
    expect(reclaimed).toBe(1);

    expect(await scalarText(`SELECT status::text FROM task WHERE id='${taskId}'`)).toBe('ready');
    expect(await scalarText(`SELECT status::text FROM claim WHERE id='${claim.claimId}'`)).toBe(
      'expired',
    );
    expect(
      await scalarText(`SELECT release_reason::text FROM claim WHERE id='${claim.claimId}'`),
    ).toBe('expired');
  });

  it('회수된 Task 는 다른 세션이 다시 잡을 수 있다 — 소유자는 항상 1명', async () => {
    const taskId = await makeTask('TSK-recycle');
    const first = await tasks.claim(claimInput(taskId, sessionYuna, yuna));
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 second' WHERE id=$1`,
      [first.claimId],
    );

    // 클레임 경로가 겹침 검사 전에 스스로 회수한다(spec-workflow §4.3 단계 1)
    const second = await tasks.claim(claimInput(taskId, sessionHana, hana));
    expect(second.claimId).not.toBe(first.claimId);
    expect(await count(`SELECT count(*)::int AS n FROM claim WHERE status='active'`)).toBe(1);
  });

  it('만료된 클레임은 겹침 판정의 비교 대상이 아니다 — 죽은 리스가 산 작업을 막지 않는다', async () => {
    const t1 = await makeTask('TSK-dead');
    const t2 = await makeTask('TSK-alive');
    const dead = await tasks.claim(
      claimInput(t1, sessionDohyun, dohyun, { specIds: [specA], fileGlobs: [] }),
    );
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 second' WHERE id=$1`,
      [dead.claimId],
    );

    // 직접 겹치는 스펙인데도 차단되지 않아야 한다
    const r = await tasks.claim(
      claimInput(t2, sessionHana, hana, { specIds: [specA], fileGlobs: [] }),
    );
    expect(r.warnings).toEqual([]);
  });
});

describe('전이의 주인 (EP-TASK-09)', () => {
  it('남의 클레임이 걸린 Task 는 옮기지 못한다 — planner·admin 은 예외다', async () => {
    const taskId = await makeTask('TSK-tr-own');
    await tasks.claim(claimInput(taskId, sessionHana, hana));

    await expect(
      tasks.transition({
        projectId,
        taskId,
        status: 'in_progress',
        userId: dohyun,
        sessionId: sessionDohyun,
        roles: ['developer'],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_assignee' } });

    // planner 는 남의 작업도 정리한다(전표의 "담당자·planner·admin")
    await expect(
      tasks.transition({
        projectId,
        taskId,
        status: 'in_progress',
        userId: dohyun,
        roles: ['planner'],
      }),
    ).resolves.toMatchObject({ status: 'in_progress' });
  });

  it('만료된 리스로는 옮기지 못한다 — 그 사이 다른 세션이 잡았을 수 있다', async () => {
    const taskId = await makeTask('TSK-tr-lease');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 minute' WHERE id=$1`,
      [claim.claimId],
    );

    await expect(
      tasks.transition({
        projectId,
        taskId,
        status: 'done',
        userId: hana,
        sessionId: sessionHana,
        roles: ['developer'],
        specImpact: { none: true },
        evidence: [{ kind: 'pr', locator: 'https://pr/1' }],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.LEASE_EXPIRED });
  });

  it('어휘 밖의 상태는 500 이 아니라 거절이다', async () => {
    const taskId = await makeTask('TSK-tr-enum');
    await expect(
      tasks.transition({ projectId, taskId, status: 'shipped', userId: hana }),
    ).rejects.toMatchObject({ details: { kind: 'invalid_input', field: 'status' } });
  });

  it('done 은 이 문으로 되돌아오지 않는다', async () => {
    const taskId = await makeTask('TSK-tr-done');
    await tasks.transition({
      projectId,
      taskId,
      status: 'done',
      userId: hana,
      specImpact: { none: true },
      evidence: [{ kind: 'pr', locator: 'https://pr/2' }],
    });
    await expect(
      tasks.transition({ projectId, taskId, status: 'in_progress', userId: hana }),
    ).rejects.toMatchObject({ details: { kind: 'not_allowed' } });
  });
});

describe('클레임의 주인 (EP-TASK-07·08)', () => {
  // claim_id 는 비밀이 아니다 — 이벤트 피드·화면·로그가 그대로 싣는다. 예전에는 그 값
  // 하나면 남의 리스를 연장하고(그 세션 앞으로 온 지시를 **소비하고**) 남의 클레임을
  // 풀어 Task 를 ready 로 되돌릴 수 있었다.
  it('남의 세션은 하트비트로 리스를 연장하지 못한다', async () => {
    const taskId = await makeTask('TSK-own-hb');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));

    await expect(
      tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionDohyun, dohyun) }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_owner' } });

    // 보유자는 그대로 된다
    const beat = await tasks.heartbeat({ claimId: claim.claimId, actor: actor(sessionHana, hana) });
    expect(beat.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('남의 클레임은 해제하지 못하고 Task 도 그대로다', async () => {
    const taskId = await makeTask('TSK-own-rel');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));

    await expect(
      tasks.release({
        claimId: claim.claimId,
        reason: 'abandon',
        userId: dohyun,
        actor: actor(sessionDohyun, dohyun),
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'not_owner' } });
    expect(await scalarText(`SELECT status::text FROM task WHERE id='${taskId}'`)).toBe('claimed');
  });

  it('admin 은 해제할 수 있다 — 전표가 그렇게 적었다(해제만)', async () => {
    const taskId = await makeTask('TSK-own-admin');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));

    // 하트비트는 admin 에게도 열려 있지 않다 — 리스는 일하는 쪽이 쥔다
    await expect(
      tasks.heartbeat({ claimId: claim.claimId, actor: actor(null, dohyun, true) }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });

    const r = await tasks.release({
      claimId: claim.claimId,
      reason: 'abandon',
      userId: dohyun,
      actor: actor(null, dohyun, true),
    });
    expect(r.taskStatus).toBe('ready');
  });

  it('다른 프로젝트의 클레임은 없는 것으로 답한다 — 존재를 알려 주지 않는다', async () => {
    const taskId = await makeTask('TSK-own-tenant');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));

    await expect(
      tasks.heartbeat({
        claimId: claim.claimId,
        actor: { projectId: newId(), userId: hana, sessionId: sessionHana, isAdmin: true },
      }),
    ).rejects.toMatchObject({ details: { kind: 'not_active' } });
  });
});

describe('클레임 해제', () => {
  it('abandon 은 Task 를 ready 로 회수한다', async () => {
    const taskId = await makeTask('TSK-rel');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const r = await tasks.release({
      claimId: claim.claimId,
      reason: 'abandon',
      userId: hana,
      actor: actor(sessionHana, hana),
    });
    expect(r.taskStatus).toBe('ready');
    expect(await count(`SELECT count(*)::int AS n FROM event WHERE type='claim.released'`)).toBe(1);
  });

  it('done 은 Task 상태를 건드리지 않는다 — done 전이는 게이트가 따로 판정한다', async () => {
    const taskId = await makeTask('TSK-rel2');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const r = await tasks.release({
      claimId: claim.claimId,
      reason: 'done',
      userId: hana,
      actor: actor(sessionHana, hana),
    });
    expect(r.taskStatus).toBe('unchanged');
    expect(await scalarText(`SELECT status::text FROM task WHERE id='${taskId}'`)).toBe('claimed');
  });
});

describe('E04-S05 ready 큐', () => {
  it('선행 의존이 done 이 아니면 후보가 아니다', async () => {
    const blocker = await makeTask('TSK-dep', { status: 'in_progress' });
    const blocked = await makeTask('TSK-waiter');
    await pool.query(
      `INSERT INTO task_dependency (task_id, depends_on_task_id, kind) VALUES ($1,$2,'blocks')`,
      [blocked, blocker],
    );

    const candidates = await tasks.next({ projectId });
    expect(candidates.map((c) => c.id)).not.toContain(blocked);

    await pool.query(
      `UPDATE task SET status='done', done_at=now(), spec_impact='{"none":true}' WHERE id=$1`,
      [blocker],
    );
    const after = await tasks.next({ projectId });
    expect(after.map((c) => c.id)).toContain(blocked);
  });

  it('이미 활성 클레임이 있는 Task 는 후보가 아니다', async () => {
    const taskId = await makeTask('TSK-taken');
    expect((await tasks.next({ projectId })).map((c) => c.id)).toContain(taskId);
    await tasks.claim(claimInput(taskId, sessionHana, hana));
    expect((await tasks.next({ projectId })).map((c) => c.id)).not.toContain(taskId);
  });

  it('후보는 위임 명세 4요소를 실어 준다 — 에이전트가 그대로 읽는다', async () => {
    await makeTask('TSK-full');
    const [candidate] = await tasks.next({ projectId });
    expect(candidate).toMatchObject({
      goal_md: expect.any(String),
      output_format_md: expect.any(String),
      tools_sources_md: expect.any(String),
      boundaries_md: expect.any(String),
    });
  });
});

// ── 도우미 ─────────────────────────────────────────────────────────────────

function claimInput(
  taskId: string,
  sessionId: string,
  userId: string,
  scope: { specIds: string[]; fileGlobs: string[] } = { specIds: [], fileGlobs: [] },
  leaseSeconds?: number,
) {
  return {
    projectId,
    taskId,
    sessionId,
    userId,
    scope,
    ...(leaseSeconds === undefined ? {} : { leaseSeconds }),
  };
}

async function makeTask(key: string, over: { status?: string } = {}): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,$3,$4,'목표','PR 1건','nerv_spec_get','경계')`,
    [id, projectId, key, over.status ?? 'ready'],
  );
  return id;
}

async function count(query: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(query);
  return rows[0]?.n ?? 0;
}

async function scalarText(query: string): Promise<string | null> {
  const { rows } = await pool.query<Record<string, string>>(query);
  return Object.values(rows[0] ?? {})[0] ?? null;
}

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  hana = newId();
  dohyun = newId();
  yuna = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [id, email, name] of [
    [hana, 'hana@example.com', '하나'],
    [dohyun, 'dohyun@example.com', '도현'],
    [yuna, 'yuna@example.com', '유나'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );

  // 세션 3개 — 두 호스트(mac-07 · mac-02)와 CI 러너
  sessionHana = newId();
  sessionDohyun = newId();
  sessionYuna = newId();
  for (const [id, user, host, type] of [
    [sessionHana, hana, 'mac-07', 'claude-code'],
    [sessionDohyun, dohyun, 'mac-02', 'claude-code'],
    [sessionYuna, yuna, 'linux-ci-01', 'codex'],
  ] as const) {
    await pool.query(
      `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [id, projectId, user, type, host],
    );
  }

  // 스펙 트리 — 부모 1 + 자식 2 (폐포 확장 검증용)
  specParent = newId();
  specA = newId();
  specB = newId();
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'area','channel-web-chat','채널 · 웹챗')`,
    [specParent, projectId],
  );
  for (const [id, key, title] of [
    [specA, 'SPC-CWC-007', '웹챗 위젯 임베드 v2'],
    [specB, 'SPC-CWC-012', '세션 복원 API'],
  ] as const) {
    await pool.query(
      `INSERT INTO spec (id, project_id, parent_id, type, key, title) VALUES ($1,$2,$3,'feature',$4,$5)`,
      [id, projectId, specParent, key, title],
    );
  }
  void sql;
}

/**
 * **플랜 승인 게이트**(G2 · D-06 ② · REQ-API-095 — 2026-09-05 사람 결정: 구현한다).
 *
 * 정본이 정한 조건 둘 — **파생 Task 4건 이상** 또는 **T3 티어 스펙**. 위치도 정본이 정한
 * 자리다(`ready → claimed`, 착수 전). 감사 전까지 `'plan'` 결재를 만드는 호출자가 저장소에
 * 하나도 없어, 명세가 MVP 3유형으로 적은 카드가 실물로는 존재하지 않았다.
 */
describe('G2 플랜 승인 — 대형 작업은 착수 전에 사람을 거친다', () => {
  async function makeTask(key: string, specVersionId: string | null): Promise<string> {
    const id = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,$3,'ready',$4,'목표','PR','저장소','건드리지 않을 것')`,
      [id, projectId, key, specVersionId],
    );
    return id;
  }

  it('파생 Task 가 넷이 되면 막고, 그 자리에서 카드를 만든다', async () => {
    const version = await makeApprovedSpecVersion('SPC-PLAN-A');
    const first = await makeTask('TSK-PLAN-1', version);
    for (const key of ['TSK-PLAN-2', 'TSK-PLAN-3', 'TSK-PLAN-4']) await makeTask(key, version);

    await expect(tasks.claim(claimInput(first, sessionHana, hana))).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'plan_approval_required', reason: 'derived_tasks' },
    });

    // **카드가 남아 있어야 한다** — 거절만 하고 결재를 만들지 않으면 그 작업은 영영 막힌다
    const { rows } = await pool.query(
      `SELECT id FROM approval WHERE subject_type = 'plan' AND subject_id = $1`,
      [first],
    );
    expect(rows).toHaveLength(1);
  });

  it('다시 클레임해도 카드는 하나다 — 막힐 때마다 쌓이면 받은 요청이 못 쓰게 된다', async () => {
    const version = await makeApprovedSpecVersion('SPC-PLAN-B');
    const first = await makeTask('TSK-DUP-1', version);
    for (const key of ['TSK-DUP-2', 'TSK-DUP-3', 'TSK-DUP-4']) await makeTask(key, version);

    for (let i = 0; i < 3; i += 1) {
      await expect(tasks.claim(claimInput(first, sessionHana, hana))).rejects.toMatchObject({
        details: { kind: 'plan_approval_required' },
      });
    }
    const { rows } = await pool.query(
      `SELECT id FROM approval WHERE subject_type = 'plan' AND subject_id = $1`,
      [first],
    );
    expect(rows).toHaveLength(1);
  });

  it('승인되면 지나간다 — 게이트는 한 번 지나면 다시 서지 않는다', async () => {
    const version = await makeApprovedSpecVersion('SPC-PLAN-C');
    const first = await makeTask('TSK-OK-1', version);
    for (const key of ['TSK-OK-2', 'TSK-OK-3', 'TSK-OK-4']) await makeTask(key, version);

    await expect(tasks.claim(claimInput(first, sessionHana, hana))).rejects.toMatchObject({
      details: { kind: 'plan_approval_required' },
    });

    await pool.query(
      `UPDATE approval SET decision = 'approve', decided_at = now()
        WHERE subject_type = 'plan' AND subject_id = $1`,
      [first],
    );
    await expect(tasks.claim(claimInput(first, sessionHana, hana))).resolves.toMatchObject({
      replayed: false,
    });
  });

  it('셋까지는 그냥 지나간다 — 게이트는 "대형" 에만 선다', async () => {
    const version = await makeApprovedSpecVersion('SPC-SMALL');
    const only = await makeTask('TSK-SMALL-1', version);
    for (const key of ['TSK-SMALL-2', 'TSK-SMALL-3']) await makeTask(key, version);

    await expect(tasks.claim(claimInput(only, sessionHana, hana))).resolves.toMatchObject({
      replayed: false,
    });
  });

  it('기준 버전이 없는 작업은 판단할 근거가 없어 걸지 않는다', async () => {
    const loose = await makeTask('TSK-LOOSE', null);
    await expect(tasks.claim(claimInput(loose, sessionHana, hana))).resolves.toMatchObject({
      replayed: false,
    });
  });

  it('T3 스펙에서 나온 작업은 파생이 하나여도 막는다', async () => {
    const version = await makeApprovedSpecVersion('SPC-T3', 'T3');
    const lone = await makeTask('TSK-T3-1', version);
    await expect(tasks.claim(claimInput(lone, sessionHana, hana))).rejects.toMatchObject({
      details: { kind: 'plan_approval_required', reason: 'tier_t3' },
    });
  });

  /** 승인된 판 하나 — 티어를 주면 그 판정을 이벤트로 남긴다(실제 승인 경로가 그렇게 한다) */
  async function makeApprovedSpecVersion(key: string, tier?: string): Promise<string> {
    const specId = newId();
    const versionId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
      [specId, projectId, key],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', sha256($3::bytea), $4)`,
      [versionId, specId, key, hana],
    );
    if (tier !== undefined) {
      await pool.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id, payload)
         VALUES ($1,$2,'spec.submitted','spec_version',$3,$4::jsonb)`,
        [newId(), projectId, versionId, JSON.stringify({ gate_tier: tier })],
      );
    }
    return versionId;
  }
});

/**
 * **구현 축은 파생값이다**(D-03 · spec-workflow §1.3 — REQ-API-097).
 *
 * 그 문장은 처음부터 있었는데 파생하는 코드가 없었다(실측 2026-09-05: `impl_status` 를 바꾸는
 * UPDATE 가 저장소에 0건). 요구사항은 임포터가 넣어 준 값에 멈춰 있었고, 웹·에이전트로 만든
 * 요구사항은 영원히 `unimplemented` 였다.
 */
describe('구현 축 — 서버가 관계 그래프에서 파생한다', () => {
  async function reqWithTask(
    refSuffix: string,
    taskKey: string,
  ): Promise<{ reqId: string; taskId: string }> {
    const specId = newId();
    const versionId = newId();
    const specKey = `SPC-IMPL-${refSuffix}`;
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
      [specId, projectId, specKey],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', sha256($3::bytea), $4)`,
      [versionId, specId, specKey, hana],
    );
    const reqId = newId();
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,$4,'WHEN 조건이면 THE SYSTEM SHALL 동작한다','must',$5,$5)`,
      [reqId, projectId, specId, `REQ-IMPL-${refSuffix}`, versionId],
    );
    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, source_requirement_id,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,$3,$3,'ready',$4,'목표','PR','저장소','경계')`,
      [taskId, projectId, taskKey, reqId],
    );
    return { reqId, taskId };
  }

  const statusOf = async (reqId: string): Promise<string> => {
    const { rows } = await pool.query<{ s: string }>(
      `SELECT impl_status::text AS s FROM requirement WHERE id = $1`,
      [reqId],
    );
    return rows[0]?.s ?? '';
  };

  it('클레임이 `unimplemented → in_progress` 를 만든다', async () => {
    const { reqId, taskId } = await reqWithTask('A', 'TSK-IMPL-A');
    expect(await statusOf(reqId)).toBe('unimplemented');

    await tasks.claim(claimInput(taskId, sessionHana, hana));
    expect(await statusOf(reqId)).toBe('in_progress');
  });

  it('완료하면 `implemented` 가 된다 — Task 가 전부 done 이고 증적이 붙었을 때', async () => {
    const { reqId, taskId } = await reqWithTask('B', 'TSK-IMPL-B');
    await tasks.claim(claimInput(taskId, sessionHana, hana));
    await tasks.transition({
      projectId,
      taskId,
      status: 'done',
      userId: hana,
      sessionId: sessionHana,
      specImpact: { none: true },
      evidence: [{ kind: 'commit', locator: 'abc1234' }],
    });
    expect(await statusOf(reqId)).toBe('implemented');
  });

  it('요구사항에 매이지 않은 Task 는 아무것도 건드리지 않는다', async () => {
    const loose = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status,
                         goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-IMPL-LOOSE','loose','ready','목표','PR','저장소','경계')`,
      [loose, projectId],
    );
    await expect(tasks.claim(claimInput(loose, sessionHana, hana))).resolves.toMatchObject({
      replayed: false,
    });
  });

  it('이미 `verified` 인 행은 내리지 않는다 — 그 칸의 조건은 여기서 판정하지 않는다', async () => {
    const { reqId, taskId } = await reqWithTask('V', 'TSK-IMPL-V');
    await pool.query(`UPDATE requirement SET impl_status = 'verified' WHERE id = $1`, [reqId]);
    await tasks.claim(claimInput(taskId, sessionHana, hana));
    expect(await statusOf(reqId)).toBe('verified');
  });
});
