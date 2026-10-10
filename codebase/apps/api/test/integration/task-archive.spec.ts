/**
 * 작업 보관 — 진행하지 않기로 한 작업을 정리한다 (2026-10-10 · 사람 결정 · REQ-API-284 · 285 · 286).
 *
 * clemvion 백로그에 다른 작업으로 대체된 중복 셋이 남았다(CLE-T-V54M21 · 2K6CDJ · CYS6YF). 작업에는 보관도 취소도
 * 없어 사람도 에이전트도 정리할 길이 없었다. 에이전트는 시작한 적 없는 작업을 대신할 작업과 함께만 보관하고,
 * 그 밖의 보관과 복원은 사람이 한다.
 */
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { TaskTools } from '../../src/modules/task/task.tools.js';
import type { ToolContext } from '../../src/mcp/tool-context.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let userId: string;
let sessionId: string;
let token: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_task_archive');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'archive',
      scopes: ['task:update', 'task:claim'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM task_dependency');
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM task');
  await pool.query('TRUNCATE event');
});

const tasks = (): TaskService => app.get(TaskService);
const human = { userId: '', isAgent: false };

/** 도구를 에이전트로 부른다 — 세션이 있는 에이전트다 */
function update(roles: string[] = ['developer']) {
  const t = app.get(TaskTools).tools.find((x) => x.name === 'nerv_task_update')!;
  const ctx = {
    projectId,
    sessionId,
    principal: { userId, isAgent: true, roles, scopes: ['task:update'] },
  } as unknown as ToolContext;
  return (input: Record<string, unknown>): Promise<Record<string, unknown>> =>
    t.handler(input, ctx).catch((e: unknown) => e) as Promise<Record<string, unknown>>;
}

async function task(key: string, over: { status?: string } = {}): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                       tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,$3,$4,'목표','PR','도구','경계')`,
    [id, projectId, key, over.status ?? 'ready'],
  );
  return id;
}

async function row(key: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT status::text AS status, archived_at, archive_reason::text AS archive_reason,
            archive_note, superseded_by_task_id, archived_by_user_id, archived_by_session_id
       FROM task WHERE key = $1`,
    [key],
  );
  return rows[0] as Record<string, unknown>;
}

describe('에이전트의 보관 — 시작한 적 없는 작업을 대신할 작업과 함께 (REQ-API-284)', () => {
  it('CLE-T-CYS6YF — 다시 만든 작업을 가리켜 옛것을 보관하면 목록 · 작업 큐 · 클레임에서 빠진다', async () => {
    const old = await task('CLV-T-CYS6YF', { status: 'backlog' });
    const fresh = await task('CLV-T-6SKVRM');
    const out = await update()({
      task_id: 'CLV-T-CYS6YF',
      archive: {
        reason: 'duplicate',
        superseded_by: 'CLV-T-6SKVRM',
        note: '네 칸을 채워 다시 만들었다',
      },
    });
    expect(out).toMatchObject({
      key: 'CLV-T-CYS6YF',
      archived: true,
      archive_reason: 'duplicate',
      superseded_by: 'CLV-T-6SKVRM',
    });
    expect(await row('CLV-T-CYS6YF')).toMatchObject({
      status: 'backlog',
      archive_reason: 'duplicate',
      superseded_by_task_id: fresh,
      archived_by_user_id: userId,
      archived_by_session_id: sessionId,
    });

    // 상세는 키로 그대로 읽힌다 — 대신할 작업은 키로, 보관한 사람은 이름으로
    const detail = await tasks().get({ projectId, taskKey: 'CLV-T-CYS6YF' });
    expect(detail).toMatchObject({
      archive_reason: 'duplicate',
      superseded_by: 'CLV-T-6SKVRM',
      archived_by_name: '도현',
    });
    expect(detail['archived_at']).not.toBeNull();

    const listed = await tasks().list({ projectId });
    expect(listed.items.map((t) => t['key'])).toEqual(['CLV-T-6SKVRM']);
    // 보관한 작업은 보관 보기로만 나온다
    const withArchived = await tasks().list({ projectId, archived: 'only' });
    expect(withArchived.items.map((t) => t['key'])).toEqual(['CLV-T-CYS6YF']);

    // 클레임은 대신할 작업을 알려 주며 거절한다
    await pool.query(`UPDATE task SET status = 'ready' WHERE id = $1`, [old]);
    const next = await tasks().next({ projectId });
    expect(next.map((c) => c['key'])).toEqual(['CLV-T-6SKVRM']);
    await expect(
      tasks().claim({
        projectId,
        taskId: 'CLV-T-CYS6YF',
        sessionId,
        userId,
        scope: { specIds: [], fileGlobs: [] },
      }),
    ).rejects.toMatchObject({
      details: { kind: 'task_archived', superseded_by: 'CLV-T-6SKVRM' },
    });

    const { rows: events } = await pool.query(`SELECT type, payload FROM event WHERE type = $1`, [
      NERV_EVENT.TASK_ARCHIVED,
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ reason: 'duplicate', superseded_by: 'CLV-T-6SKVRM' }),
      }),
    ]);
  });

  it('기다리던 작업은 대신할 작업을 기다리게 된다', async () => {
    const old = await task('CLV-T-OLD001', { status: 'backlog' });
    const fresh = await task('CLV-T-NEW001');
    const waiting = await task('CLV-T-WAIT01', { status: 'backlog' });
    await pool.query(`INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES ($1,$2)`, [
      waiting,
      old,
    ]);
    const out = await update()({
      task_id: 'CLV-T-OLD001',
      archive: { reason: 'superseded', superseded_by: 'CLV-T-NEW001' },
    });
    expect(out['dependencies_moved']).toEqual(['CLV-T-WAIT01']);
    const { rows } = await pool.query(
      `SELECT depends_on_task_id FROM task_dependency WHERE task_id = $1`,
      [waiting],
    );
    expect(rows).toEqual([{ depends_on_task_id: fresh }]);
  });

  it('에이전트는 대신할 작업이 없는 사유 · 시작한 작업 · 복원을 하지 못한다', async () => {
    await task('CLV-T-RSN001', { status: 'backlog' });
    await task('CLV-T-REP001');
    const noReplacement = await tasks()
      .archive({
        projectId,
        taskKey: 'CLV-T-RSN001',
        actor: { userId, isAgent: true, sessionId },
        reason: 'obsolete',
        note: '필요 없어졌다',
      })
      .catch((e: unknown) => e);
    expect(noReplacement).toMatchObject({
      code: NERV_ERROR.HUMAN_ONLY,
      details: { kind: 'human_only', action: 'task_archive', why: 'reason' },
    });

    // 한 번이라도 클레임됐거나 증적이 붙은 작업은 사람이 판단한다
    const claimed = await task('CLV-T-CLM001');
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at,
                          released_at, release_reason)
       VALUES ($1,$2,$3,$4,$5,'released', now(), now(), 'handoff')`,
      [newId(), projectId, claimed, sessionId, userId],
    );
    const started = await update()({
      task_id: 'CLV-T-CLM001',
      archive: { reason: 'duplicate', superseded_by: 'CLV-T-REP001' },
    });
    expect(started).toMatchObject({ code: NERV_ERROR.HUMAN_ONLY, details: { why: 'started' } });
    expect((await row('CLV-T-CLM001'))['archived_at']).toBeNull();

    // 다른 인자와 함께 보내지 않는다
    const mixed = await update()({
      task_id: 'CLV-T-RSN001',
      status: 'ready',
      archive: { reason: 'duplicate', superseded_by: 'CLV-T-REP001' },
    });
    expect(mixed['details']).toMatchObject({ field: 'archive', conflicts_with: ['status'] });

    // 역할이 없으면 막는다
    const qa = await update(['qa'])({
      task_id: 'CLV-T-RSN001',
      archive: { reason: 'duplicate', superseded_by: 'CLV-T-REP001' },
    });
    expect(qa).toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });
});

describe('사람의 보관과 복원 (REQ-API-284 · 285 · 286)', () => {
  it('사유마다 필요한 칸을 받고, 끝난 작업 · 쥔 작업 · 보관한 대신할 작업은 거절한다', async () => {
    await task('CLV-T-H00001', { status: 'backlog' });
    const archive = (over: Record<string, unknown>): Promise<unknown> =>
      tasks()
        .archive({
          projectId,
          taskKey: 'CLV-T-H00001',
          actor: { ...human, userId },
          reason: 'obsolete',
          ...over,
        } as Parameters<TaskService['archive']>[0])
        .catch((e: unknown) => e);

    expect(await archive({})).toMatchObject({ details: { kind: 'invalid_input', field: 'note' } });
    expect(await archive({ reason: 'duplicate' })).toMatchObject({
      details: { kind: 'invalid_input', field: 'superseded_by' },
    });
    expect(await archive({ reason: 'cancelled', note: 'x' })).toMatchObject({
      details: { kind: 'invalid_input', field: 'reason' },
    });
    expect(await archive({ reason: 'duplicate', supersededBy: 'CLV-T-H00001' })).toMatchObject({
      details: { field: 'superseded_by', reason: 'self' },
    });

    const done = await task('CLV-T-DONE01');
    await pool.query(
      `UPDATE task SET status = 'done', done_at = now(), spec_impact = '{"none":true}' WHERE id = $1`,
      [done],
    );
    expect(
      await tasks()
        .archive({
          projectId,
          taskKey: 'CLV-T-DONE01',
          actor: { ...human, userId },
          reason: 'obsolete',
          note: 'x',
        })
        .catch((e: unknown) => e),
    ).toMatchObject({ details: { kind: 'done_is_final' } });

    const held = await task('CLV-T-HELD01');
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, held, sessionId, userId],
    );
    expect(
      await tasks()
        .archive({
          projectId,
          taskKey: 'CLV-T-HELD01',
          actor: { ...human, userId },
          reason: 'obsolete',
          note: 'x',
        })
        .catch((e: unknown) => e),
    ).toMatchObject({ details: { kind: 'release_required' } });

    await task('CLV-T-GONE01', { status: 'backlog' });
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-GONE01',
      actor: { ...human, userId },
      reason: 'wont_do',
      note: '범위 밖',
    });
    expect(await archive({ reason: 'duplicate', supersededBy: 'CLV-T-GONE01' })).toMatchObject({
      details: { kind: 'superseded_by_archived', superseded_by: 'CLV-T-GONE01' },
    });
  });

  it('대신할 작업 없이 보관하면 기다리던 의존이 풀리고, 복원하면 상태 그대로 돌아온다', async () => {
    const old = await task('CLV-T-OBS001');
    const waiting = await task('CLV-T-WAIT02', { status: 'backlog' });
    await pool.query(`INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES ($1,$2)`, [
      waiting,
      old,
    ]);
    const out = await tasks().archive({
      projectId,
      taskKey: 'CLV-T-OBS001',
      actor: { ...human, userId },
      reason: 'obsolete',
      note: '요구사항이 빠졌다',
    });
    expect(out).toMatchObject({ archived: true, dependencies_released: ['CLV-T-WAIT02'] });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM task_dependency`);
    expect(rows[0].n).toBe(0);
    // 다시 보관해도 처음 기록을 덮지 않는다
    expect(
      await tasks().archive({
        projectId,
        taskKey: 'CLV-T-OBS001',
        actor: { ...human, userId },
        reason: 'wont_do',
        note: '다른 이유',
      }),
    ).toMatchObject({ unchanged: true });
    expect((await row('CLV-T-OBS001'))['archive_reason']).toBe('obsolete');

    // 에이전트는 복원하지 못한다
    expect(
      await tasks()
        .restore({ projectId, taskKey: 'CLV-T-OBS001', actor: { userId, isAgent: true } })
        .catch((e: unknown) => e),
    ).toMatchObject({ code: NERV_ERROR.HUMAN_ONLY, details: { why: 'restore' } });

    const restored = await tasks().restore({
      projectId,
      taskKey: 'CLV-T-OBS001',
      actor: { ...human, userId },
    });
    expect(restored).toMatchObject({ archived: false, status: 'ready' });
    expect(await row('CLV-T-OBS001')).toMatchObject({
      status: 'ready',
      archived_at: null,
      archive_reason: null,
      archive_note: null,
      archived_by_user_id: null,
    });
    expect((await tasks().next({ projectId })).map((c) => c['key'])).toContain('CLV-T-OBS001');
  });

  it('REST — 에이전트 토큰의 보관은 같은 조건을 지나고, 복원은 사람만 한다', async () => {
    await task('CLV-T-RST001', { status: 'backlog' });
    await task('CLV-T-RST002');
    const post = (path: string, payload?: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/projects/clemvion/tasks/${path}`,
        headers:
          payload === undefined
            ? { authorization: `Bearer ${token}` }
            : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(payload === undefined ? {} : { payload }),
      });
    const agentObsolete = await post('CLV-T-RST001/archive', { reason: 'obsolete', note: 'x' });
    expect((agentObsolete.json() as { details: { why: string } }).details.why).toBe('reason');
    const ok = await post('CLV-T-RST001/archive', {
      reason: 'duplicate',
      superseded_by: 'CLV-T-RST002',
    });
    expect(ok.statusCode).toBeLessThan(300);
    const restore = await post('CLV-T-RST001/restore');
    expect((restore.json() as { code: string }).code).toBe(NERV_ERROR.HUMAN_ONLY);
    const unknownField = await post('CLV-T-RST002/archive', { reason: 'duplicate', why: 'x' });
    expect(unknownField.statusCode).toBe(400);
  });
});

describe('보관한 작업이 빠지는 자리 (REQ-API-286)', () => {
  /** 승인된 문서 하나와 요구사항 하나 — 작업이 그 요구사항에서 나온다 */
  async function requirement(key: string): Promise<{ versionId: string; requirementId: string }> {
    const specId = newId();
    const versionId = newId();
    const requirementId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature',$3,$3)`,
      [specId, projectId, key],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', sha256($3::bytea), $4)`,
      [versionId, specId, key, userId],
    );
    await pool.query(
      `INSERT INTO requirement (id, project_id, spec_id, ref, statement_md, priority,
                                introduced_in_version_id, current_version_id)
       VALUES ($1,$2,$3,$4,'WHEN 조건이면 THE SYSTEM SHALL 동작한다','must',$5,$5)`,
      [requirementId, projectId, specId, `REQ-${key}-001`, versionId],
    );
    return { versionId, requirementId };
  }
  async function derived(
    key: string,
    req: { versionId: string; requirementId: string },
    status: string,
  ): Promise<string> {
    const id = await task(key, { status: status === 'done' ? 'ready' : status });
    await pool.query(
      `UPDATE task SET source_spec_version_id = $2, source_requirement_id = $3 WHERE id = $1`,
      [id, req.versionId, req.requirementId],
    );
    if (status === 'done') {
      await pool.query(
        `UPDATE task SET status = 'done', done_at = now(), spec_impact = '{"none":true}' WHERE id = $1`,
        [id],
      );
    }
    return id;
  }
  const implStatus = async (requirementId: string): Promise<string> =>
    (
      await pool.query(`SELECT impl_status::text AS s FROM requirement WHERE id = $1`, [
        requirementId,
      ])
    ).rows[0].s;

  it('구현 현황 — 보관한 진행 중 작업이 요구사항을 붙잡지 않고, 보관한 작업만 남으면 구현됐다고 하지 않는다', async () => {
    const req = await requirement('IMPL-A');
    const done = await derived('CLV-T-IMPLD1', req, 'done');
    await pool.query(
      `INSERT INTO evidence (id, project_id, task_id, kind, locator, source)
       VALUES ($1,$2,$3,'pr','https://github.com/o/r/pull/1','agent')`,
      [newId(), projectId, done],
    );
    await derived('CLV-T-IMPLR1', req, 'in_review');
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-IMPLR1',
      actor: { ...human, userId },
      reason: 'duplicate',
      supersededBy: 'CLV-T-IMPLD1',
    });
    expect(await implStatus(req.requirementId)).toBe('implemented');

    // 작업이 모두 보관됐으면 작업이 하나도 없는 요구사항처럼 손대지 않는다 — 임포트가 정한 값을 중복 하나 보관한
    // 일로 지우지 않는다
    const lone = await requirement('IMPL-B');
    await derived('CLV-T-IMPLB1', lone, 'backlog');
    await pool.query(`UPDATE requirement SET impl_status = 'implemented' WHERE id = $1`, [
      lone.requirementId,
    ]);
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-IMPLB1',
      actor: { ...human, userId },
      reason: 'wont_do',
      note: '범위에서 뺐다',
    });
    expect(await implStatus(lone.requirementId)).toBe('implemented');
  });

  it('계획 승인 — 보관한 작업은 형제로 세지 않고, 보관한 작업의 클레임은 결재 카드를 만들지 않는다', async () => {
    const req = await requirement('PLAN-A');
    for (const k of ['CLV-T-PLN001', 'CLV-T-PLN002', 'CLV-T-PLN003'])
      await derived(k, req, 'ready');
    const dup = await derived('CLV-T-PLN004', req, 'ready');
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-PLN004',
      actor: { ...human, userId },
      reason: 'duplicate',
      supersededBy: 'CLV-T-PLN001',
    });
    // 살아 있는 형제는 셋이라 계획 승인이 걸리지 않는다
    const claimed = await tasks().claim({
      projectId,
      taskId: 'CLV-T-PLN002',
      sessionId,
      userId,
      scope: { specIds: [], fileGlobs: [] },
    });
    expect(claimed.claimId).toEqual(expect.any(String));
    await expect(
      tasks().claim({
        projectId,
        taskId: dup,
        sessionId,
        userId,
        scope: { specIds: [], fileGlobs: [] },
      }),
    ).rejects.toMatchObject({ details: { kind: 'task_archived' } });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM approval WHERE subject_id = $1`,
      [dup],
    );
    expect(rows[0].n).toBe(0);
  });

  it('수정으로 보관한 작업에 의존을 다시 걸지 못한다 — 대신할 작업을 알려 준다', async () => {
    await task('CLV-T-DEP001', { status: 'backlog' });
    await task('CLV-T-DEP002');
    await task('CLV-T-DEP003', { status: 'backlog' });
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-DEP001',
      actor: { ...human, userId },
      reason: 'superseded',
      supersededBy: 'CLV-T-DEP002',
    });
    await expect(
      tasks().update({
        projectId,
        taskKey: 'CLV-T-DEP003',
        dependsOnKeys: ['CLV-T-DEP001'],
        userId,
      }),
    ).rejects.toMatchObject({
      details: {
        kind: 'depends_on_archived',
        archived: ['CLV-T-DEP001'],
        superseded_by: { 'CLV-T-DEP001': 'CLV-T-DEP002' },
      },
    });
    // 보관한 작업 자체도 고치지 않는다
    await expect(
      tasks().update({ projectId, taskKey: 'CLV-T-DEP001', title: '새 제목', userId }),
    ).rejects.toMatchObject({ details: { kind: 'task_archived', superseded_by: 'CLV-T-DEP002' } });
  });
});

describe('보관의 가장자리 (검토 반영)', () => {
  it('옮기면 고리가 생기는 의존은 옮기지 않고 푼다 — 대신할 작업 자신의 의존도 푼다', async () => {
    const x = await task('CLV-T-CYC00X', { status: 'backlog' });
    const d = await task('CLV-T-CYC00D', { status: 'backlog' });
    const r = await task('CLV-T-CYC00R', { status: 'backlog' });
    const e = await task('CLV-T-CYC00E', { status: 'backlog' });
    await pool.query(
      `INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES ($1,$2),($3,$4),($5,$2),($6,$2)`,
      [d, x, r, d, r, e],
    );
    // D → X, R → D, R → X, E → X. X 를 R 로 대신하면 D → R 은 고리(R → D)라 풀고, R → X 는 자기 자신이라 푼다
    const out = await tasks().archive({
      projectId,
      taskKey: 'CLV-T-CYC00X',
      actor: { ...human, userId },
      reason: 'superseded',
      supersededBy: 'CLV-T-CYC00R',
    });
    expect(out).toMatchObject({
      dependencies_moved: ['CLV-T-CYC00E'],
      dependencies_released: ['CLV-T-CYC00D', 'CLV-T-CYC00R'],
    });
    const { rows } = await pool.query(
      `SELECT task_id, depends_on_task_id FROM task_dependency ORDER BY task_id`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { task_id: r, depends_on_task_id: d },
        { task_id: e, depends_on_task_id: r },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('리스가 끝난 클레임은 먼저 회수하고 보관한다 — 화면이 연 [보관]을 서버가 막지 않는다', async () => {
    const held = await task('CLV-T-EXP001');
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() - interval '1 minute')`,
      [newId(), projectId, held, sessionId, userId],
    );
    const out = await tasks().archive({
      projectId,
      taskKey: 'CLV-T-EXP001',
      actor: { ...human, userId },
      reason: 'obsolete',
      note: '필요 없어졌다',
    });
    expect(out).toMatchObject({ archived: true });
  });

  it('보관한 동안 기준이 밀려났으면 복원할 때 재브리핑 표시를 다시 단다', async () => {
    const specId = newId();
    const v1 = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','RB-A','RB-A')`,
      [specId, projectId],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', sha256('rb'::bytea), $3)`,
      [v1, specId, userId],
    );
    const id = await task('CLV-T-RBF001');
    await pool.query(`UPDATE task SET source_spec_version_id = $2 WHERE id = $1`, [id, v1]);
    await tasks().archive({
      projectId,
      taskKey: 'CLV-T-RBF001',
      actor: { ...human, userId },
      reason: 'obsolete',
      note: '잠시 미룬다',
    });
    await pool.query(`UPDATE spec_version SET status = 'superseded' WHERE id = $1`, [v1]);
    await tasks().restore({ projectId, taskKey: 'CLV-T-RBF001', actor: { ...human, userId } });
    const { rows } = await pool.query(`SELECT rebrief_required_at FROM task WHERE id = $1`, [id]);
    expect(rows[0].rebrief_required_at).not.toBeNull();
  });

  it('MCP 목록의 archived 는 모르는 값을 조용히 버리지 않는다', async () => {
    const t = app.get(TaskTools).tools.find((x) => x.name === 'nerv_task_list')!;
    const ctx = {
      projectId,
      sessionId,
      principal: {
        userId,
        isAgent: true,
        roles: ['developer'],
        scopes: ['spec:read', 'task:claim'],
      },
    } as unknown as ToolContext;
    const bad = await t.handler({ archived: true }, ctx).catch((e: unknown) => e);
    expect(bad).toMatchObject({ details: { kind: 'invalid_input', field: 'archived' } });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  sessionId = newId();
  human.userId = userId;
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','도현','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO agent_session (id, project_id, user_id, agent_type, hostname, state)
     VALUES ($1,$2,$3,'claude-code','mac-07','active')`,
    [sessionId, projectId, userId],
  );
}
