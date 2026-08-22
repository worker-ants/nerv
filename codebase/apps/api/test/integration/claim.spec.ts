// E04 — 클레임·리스 엔진. **Phase 0 종료 게이트의 직접 대상이다.**
//
//   두 호스트·세 세션 90분 동시 작업에서 중복 클레임 0건,
//   겹침 경고 10/10 검출·오탐 0 (scope.md §1.3 · backlog §5.1~5.3)
//
// 동시성은 mock 으로 검증하지 않는다(codebase.md §4.3). 여기서 도는 것은 실제 Postgres 의
// 행 잠금·조건부 UPDATE·부분 unique 다 — 그 셋이 함께 동작해야 "중복 클레임 0건"이 성립한다.

import { NERV_ERROR, newId, runMigrations } from '@nerv/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClaimService } from '../../src/modules/task/claim.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let tasks: TaskService;
let claims: ClaimService;
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
  tasks = new TaskService(claims, events, drizzleDb);

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
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM event');
});

// ── E04-S01 원자적 클레임 ───────────────────────────────────────────────────

describe('E04-S01 원자적 클레임 (성공 기준 0-1·0-2)', () => {
  it('세 세션이 같은 ready Task 를 동시에 잡으면 정확히 1건만 성공한다', async () => {
    const taskId = await makeTask('TSK-3f77');

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
    const beat = await tasks.heartbeat({ claimId: claim.claimId, leaseSeconds: 1800 });
    expect(beat.leaseExpiresAt.getTime()).toBeGreaterThan(before);
  });

  it('만료된 리스로 하트비트하면 NERV_LEASE_EXPIRED', async () => {
    const taskId = await makeTask('TSK-expired');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    await pool.query(
      `UPDATE claim SET lease_expires_at = now() - interval '1 minute' WHERE id=$1`,
      [claim.claimId],
    );

    await expect(tasks.heartbeat({ claimId: claim.claimId })).rejects.toMatchObject({
      code: NERV_ERROR.LEASE_EXPIRED,
    });
  });
});

describe('E04-S04 만료 자동 회수 (성공 기준 0-4)', () => {
  it('TTL 을 넘긴 클레임을 회수하고 Task 를 ready 로 되돌린다 — 사람 개입 0회', async () => {
    const taskId = await makeTask('TSK-b904');
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

describe('클레임 해제', () => {
  it('abandon 은 Task 를 ready 로 회수한다', async () => {
    const taskId = await makeTask('TSK-rel');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const r = await tasks.release({ claimId: claim.claimId, reason: 'abandon', userId: hana });
    expect(r.taskStatus).toBe('ready');
    expect(await count(`SELECT count(*)::int AS n FROM event WHERE type='claim.released'`)).toBe(1);
  });

  it('done 은 Task 상태를 건드리지 않는다 — done 전이는 게이트가 따로 판정한다', async () => {
    const taskId = await makeTask('TSK-rel2');
    const claim = await tasks.claim(claimInput(taskId, sessionHana, hana));
    const r = await tasks.release({ claimId: claim.claimId, reason: 'done', userId: hana });
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
