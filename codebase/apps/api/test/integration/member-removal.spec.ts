// 한 번에 빼기 — 미리보기 · 프로젝트에서 빼기 · 조직에서 내보내기 (2026-09-27 · 사람 결정 P2 · REQ-API-226·227)
//
// 화면이 토큰 폐기와 멤버십 삭제를 하나씩 부르던 동안, 중간에 실패하면 일부만 지워졌고 프로젝트 admin 은
// 조직 토큰 표를 읽지 못해 뺀 사람의 토큰을 끊지 못했다. 서버가 한 트랜잭션에서 멤버십을 지우고, 그 사람이
// 더는 볼 수 없게 된 프로젝트의 살아 있는 토큰을 폐기하고, 맡은 작업의 담당자를 비운다. 진행 중 클레임과
// 지정된 결재는 건드리지 않는다. 동시성(두 조직 admin 이 서로를 내보낸다)은 실물로 본다.

import { randomBytes } from 'node:crypto';
import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import type { ValkeyService } from '../../src/modules/event/valkey.service.js';
import type { NervDb } from '../../src/common/database.module.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let auth: AuthService;
let orgId: string;
const sudoku = newId();
const coser = newId();
/** 조직 admin */
const admin = newId();
/** sudoku 만의 admin */
const sudokuAdmin = newId();
/** 뺄 사람 — 테스트마다 새로 만든다(감사 이벤트가 사람을 참조해 지울 수 없다) */
let carol: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_member_removal');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  const drizzleDb = drizzle(pool) as unknown as NervDb;
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  auth = new AuthService(drizzleDb, new EventService(drizzleDb, silent));
  orgId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'getit','getit')`, [
    orgId,
  ]);
  for (const [id, name] of [
    [admin, '관리자'],
    [sudokuAdmin, '서연'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${id.slice(-8)}@example.com`, name],
    );
  }
  for (const [id, slug, key] of [
    [sudoku, 'sudoku', 'SUD'],
    [coser, 'coser', 'COS'],
  ] as const) {
    await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,$3)`, [
      id,
      orgId,
      slug,
      key,
    ]);
  }
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  for (const table of ['approval', 'claim', 'task', 'api_token', 'membership']) {
    await pool.query(`DELETE FROM ${table}`);
  }
  await grant(admin, 'admin', null);
  await grant(sudokuAdmin, 'admin', sudoku);
  carol = await person();
});

async function grant(user: string, role: string, project: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
    [newId(), orgId, project, user, role],
  );
}

async function person(): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,'사람','active')`,
    [id, `${id.slice(-8)}@example.com`],
  );
  return id;
}

async function token(user: string, project: string): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO api_token (id, project_id, user_id, name, token_hash, prefix)
     VALUES ($1,$2,$3,'노트북',$4,'nerv_x')`,
    [id, project, user, randomBytes(16)],
  );
  return id;
}

async function task(project: string, assignee: string, status = 'ready'): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, assignee_user_id,
                       goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'작업',$4::task_status,$5,'목표','PR','도구','경계')`,
    [id, project, `T-${id.slice(-6)}`, status, assignee],
  );
  return id;
}

async function liveTokens(user: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM api_token WHERE user_id = $1 AND revoked_at IS NULL ORDER BY id`,
    [user],
  );
  return rows.map((r) => r.id);
}

async function scopesOf(user: string): Promise<string[]> {
  const { rows } = await pool.query<{ scope: string }>(
    `SELECT coalesce(p.slug, '조직 전체') || ':' || m.role AS scope
       FROM membership m LEFT JOIN project p ON p.id = m.project_id
      WHERE m.user_id = $1 ORDER BY 1`,
    [user],
  );
  return rows.map((r) => r.scope);
}

async function refused(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; details?: Record<string, unknown> };
    return `${String(err.code)}:${String(err.details?.['kind'] ?? '')}`;
  }
}

describe('한 프로젝트에서 빼기 (REQ-API-226·227)', () => {
  it('미리보기와 빼기가 같은 수를 센다 — 토큰 · 작업은 정리하고 클레임 · 결재는 두고, 다른 프로젝트는 그대로다', async () => {
    await grant(carol, 'viewer', sudoku);
    await grant(carol, 'developer', coser);
    const sudokuToken = await token(carol, sudoku);
    const coserToken = await token(carol, coser);
    const open = await task(sudoku, carol);
    const working = await task(sudoku, carol, 'in_progress');
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, user_id, lease_expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '1 hour')`,
      [newId(), sudoku, working, carol],
    );
    await pool.query(
      `INSERT INTO approval (id, project_id, subject_type, subject_id, requested_by_user_id, assignee_user_id)
       VALUES ($1,$2,'spec_version',$3,$4,$5)`,
      [newId(), sudoku, newId(), sudokuAdmin, carol],
    );
    const input = { orgSlug: 'getit', targetUserId: carol, project: 'sudoku' };

    const preview = await auth.memberRemovalPreview({ ...input, actorUserId: sudokuAdmin });
    expect(preview).toEqual({
      roles: ['viewer'],
      org_roles: [],
      keeps_access: false,
      left_org: false,
      tokens: 1,
      tasks: 1,
      active_claims: 1,
      assigned_approvals: 1,
    });

    // 프로젝트 admin 도 뺄 수 있고, 조직 토큰 표를 읽지 못해도 그 프로젝트의 토큰이 끊긴다
    const result = await auth.removeMember({ ...input, actorUserId: sudokuAdmin });
    expect(result).toEqual({
      ok: true,
      roles: 1,
      tokens_revoked: 1,
      tasks_unassigned: 1,
      keeps_access: false,
      left_org: false,
    });
    expect(await scopesOf(carol)).toEqual(['coser:developer']);
    expect(await liveTokens(carol)).toEqual([coserToken]);
    expect(await liveTokens(carol)).not.toContain(sudokuToken);
    const { rows } = await pool.query<{ id: string; assignee_user_id: string | null }>(
      `SELECT id, assignee_user_id FROM task WHERE project_id = $1 AND status <> 'done'`,
      [sudoku],
    );
    // 잡고 있는 작업은 담당자를 그대로 둔다 — 세션이 일하는 도중이다
    expect(Object.fromEntries(rows.map((r) => [r.id, r.assignee_user_id]))).toEqual({
      [open]: null,
      [working]: carol,
    });
    const { rows: approvals } = await pool.query(
      `SELECT 1 FROM approval WHERE assignee_user_id = $1 AND decision IS NULL`,
      [carol],
    );
    expect(approvals).toHaveLength(1);
  });

  it('조직 전체 역할이 남으면 역할만 지운다 — 계속 보므로 토큰 · 작업은 건드리지 않는다 (사람 결정 P3)', async () => {
    const dave = await person();
    await grant(dave, 'planner', null);
    await grant(dave, 'viewer', sudoku);
    const kept = await token(dave, sudoku);
    await task(sudoku, dave);
    const preview = await auth.memberRemovalPreview({
      orgSlug: 'getit',
      targetUserId: dave,
      project: 'sudoku',
      actorUserId: admin,
    });
    expect(preview).toMatchObject({
      keeps_access: true,
      org_roles: ['planner'],
      tokens: 0,
      tasks: 0,
    });
    const result = await auth.removeMember({
      orgSlug: 'getit',
      targetUserId: dave,
      project: sudoku,
      actorUserId: admin,
    });
    expect(result).toMatchObject({
      roles: 1,
      tokens_revoked: 0,
      tasks_unassigned: 0,
      keeps_access: true,
    });
    expect(await scopesOf(dave)).toEqual(['조직 전체:planner']);
    expect(await liveTokens(dave)).toEqual([kept]);
  });

  it('그 조직의 마지막 소속을 빼면 조직에서 나간다 — 조직의 모든 토큰을 끊는다', async () => {
    const erin = await person();
    await grant(erin, 'viewer', sudoku);
    await token(erin, sudoku);
    await token(erin, coser); // 멤버십 없이 남은 토큰(옛 소속) — 이것도 끊는다
    const result = await auth.removeMember({
      orgSlug: 'getit',
      targetUserId: erin,
      project: 'sudoku',
      actorUserId: admin,
    });
    expect(result).toMatchObject({ left_org: true, tokens_revoked: 2 });
    expect(await scopesOf(erin)).toEqual([]);
    expect(await liveTokens(erin)).toEqual([]);
  });

  it('감사는 프로젝트마다 한 건이다 — 누가 누구를 빼고 무엇을 정리했는지', async () => {
    await grant(carol, 'viewer', sudoku);
    await grant(carol, 'qa', sudoku);
    await grant(carol, 'viewer', coser);
    await token(carol, sudoku);
    await auth.removeMember({
      orgSlug: 'getit',
      targetUserId: carol,
      project: 'sudoku',
      actorUserId: admin,
    });
    const { rows } = await pool.query<{ project_id: string; payload: Record<string, unknown> }>(
      `SELECT project_id, payload FROM event WHERE type = $1 AND subject_id = $2`,
      [NERV_EVENT.MEMBER_REMOVED, carol],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_id).toBe(sudoku);
    expect(rows[0]?.payload).toMatchObject({
      scope: 'project',
      tokens_revoked: 1,
      left_org: false,
    });
    expect((rows[0]?.payload['roles'] as string[]).sort()).toEqual(['qa', 'viewer']);
  });
});

describe('권한과 거절', () => {
  it('프로젝트 admin 은 다른 프로젝트에서 빼거나 조직에서 내보낼 수 없다', async () => {
    await grant(carol, 'viewer', coser);
    await grant(carol, 'viewer', sudoku);
    expect(
      await refused(
        auth.removeMember({
          orgSlug: 'getit',
          targetUserId: carol,
          project: 'coser',
          actorUserId: sudokuAdmin,
        }),
      ),
    ).toMatch(/^NERV_FORBIDDEN/);
    expect(
      await refused(
        auth.removeMember({
          orgSlug: 'getit',
          targetUserId: carol,
          project: null,
          actorUserId: sudokuAdmin,
        }),
      ),
    ).toMatch(/^NERV_FORBIDDEN/);
    expect(await scopesOf(carol)).toEqual(['coser:viewer', 'sudoku:viewer']);
  });

  it('자기 자신 · 속하지 않은 프로젝트 · 모르는 사람은 거절한다', async () => {
    await grant(carol, 'viewer', coser);
    const base = { orgSlug: 'getit', actorUserId: admin };
    expect(await refused(auth.removeMember({ ...base, targetUserId: admin, project: null }))).toBe(
      `${NERV_ERROR.PRECONDITION}:self_removal`,
    );
    expect(
      await refused(auth.removeMember({ ...base, targetUserId: carol, project: 'sudoku' })),
    ).toBe(`${NERV_ERROR.PRECONDITION}:not_found`);
    expect(
      await refused(auth.removeMember({ ...base, targetUserId: 'nobody', project: null })),
    ).toBe(`${NERV_ERROR.PRECONDITION}:not_found`);
    expect(
      await refused(auth.removeMember({ ...base, targetUserId: carol, project: 'nowhere' })),
    ).toBe(`${NERV_ERROR.PRECONDITION}:not_found`);
  });
});

describe('조직에서 내보내기 (REQ-API-227)', () => {
  it('멤버십 전부 · 조직의 토큰 전부 · 맡은 작업을 한 번에 정리한다', async () => {
    await grant(carol, 'viewer', sudoku);
    await grant(carol, 'developer', coser);
    await token(carol, sudoku);
    await token(carol, coser);
    await task(coser, carol);
    const preview = await auth.memberRemovalPreview({
      orgSlug: 'getit',
      targetUserId: carol,
      project: null,
      actorUserId: admin,
    });
    expect(preview).toMatchObject({ left_org: true, tokens: 2, tasks: 1 });
    const result = await auth.removeMember({
      orgSlug: 'getit',
      targetUserId: carol,
      project: null,
      actorUserId: admin,
    });
    expect(result).toEqual({
      ok: true,
      roles: 2,
      tokens_revoked: 2,
      tasks_unassigned: 1,
      keeps_access: false,
      left_org: true,
    });
    expect(await scopesOf(carol)).toEqual([]);
    expect(await liveTokens(carol)).toEqual([]);
  });

  it('마지막 조직 admin 은 내보낼 수 없다 — 두 admin 이 서로를 동시에 내보내도 한 명은 남는다', async () => {
    const other = await person();
    await grant(other, 'admin', null);
    const results = await Promise.all([
      refused(
        auth.removeMember({
          orgSlug: 'getit',
          targetUserId: other,
          project: null,
          actorUserId: admin,
        }),
      ),
      refused(
        auth.removeMember({
          orgSlug: 'getit',
          targetUserId: admin,
          project: null,
          actorUserId: other,
        }),
      ),
    ]);
    // 한쪽은 지나가고, 다른 쪽은 마지막 admin 이라서 — 또는 이미 권한을 잃어서 — 거절된다
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership
        WHERE org_id = $1 AND project_id IS NULL AND role = 'admin'`,
      [orgId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
