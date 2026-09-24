// 조직의 마지막 admin 은 뗄 수 없다 — REQ-API-174 (2026-09-24 · UI/UX 검토 SET-04)
//
// 역할 칩 하나가 멤버십 행 하나라, 유일한 조직 admin 이 자기 조직 전체 줄의 admin 칩을 끄면
// 조직에 admin 이 0 명이 됐다. 멤버십을 다루는 문이 전부 admin 에게만 열려 있어 그 조직은
// 되살릴 길이 없다. 동시성(두 admin 이 서로를 동시에 뗀다)은 mock 으로 볼 수 없어 실물로 본다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import type { NervDb } from '../../src/common/database.module.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let auth: AuthService;
let orgId: string;
let projectId: string;
const alice = newId();
const bob = newId();

beforeAll(async () => {
  db = await createScratchDb('nerv_lastadmin');
  await runMigrations(db.url);
  // 동시 요청 둘이 각자 커넥션을 잡아야 잠금을 본다
  pool = new pg.Pool({ connectionString: db.url, max: 8 });
  auth = new AuthService(drizzle(pool) as unknown as NervDb);
  orgId = newId();
  projectId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','에이스')`, [
    orgId,
  ]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'sudoku','SUD','스도쿠')`,
    [projectId, orgId],
  );
  for (const [id, email, name] of [
    [alice, 'alice@example.com', '앨리스'],
    [bob, 'bob@example.com', '밥'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM membership WHERE org_id = $1`, [orgId]);
});

async function grant(user: string, role: string, project: string | null = null): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
    [id, orgId, project, user, role],
  );
  return id;
}

async function orgAdmins(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM membership
      WHERE org_id = $1 AND project_id IS NULL AND role = 'admin'`,
    [orgId],
  );
  return rows[0]?.n ?? 0;
}

/** 마지막 admin 이라서 거절됐는가 — 다른 실패를 이 거절로 오인하지 않게 코드와 kind 를 본다 */
async function refusedAsLast(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    const err = e as { code?: string; details?: Record<string, unknown> };
    return err.code === NERV_ERROR.PRECONDITION && err.details?.['kind'] === 'last_org_admin';
  }
}

const remove = (membershipId: string): Promise<unknown> =>
  auth.removeMembership({ membershipId, actorRoles: ['admin'], actorUserId: alice });

describe('조직의 마지막 admin (REQ-API-174)', () => {
  it('유일한 조직 admin 의 admin 행은 지울 수 없다 — 다른 역할이 있어도', async () => {
    const admin = await grant(alice, 'admin');
    await grant(alice, 'planner');
    expect(await refusedAsLast(remove(admin))).toBe(true);
    expect(await orgAdmins()).toBe(1);
  });

  it('유일한 조직 admin 의 역할을 admin 이 아닌 것으로 바꿀 수 없다', async () => {
    const admin = await grant(alice, 'admin');
    expect(
      await refusedAsLast(
        auth.updateMembership({ membershipId: admin, role: 'planner', actorRoles: ['admin'] }),
      ),
    ).toBe(true);
    expect(await orgAdmins()).toBe(1);
  });

  it('다른 조직 admin 이 있으면 뗄 수 있다', async () => {
    const a = await grant(alice, 'admin');
    await grant(bob, 'admin');
    await expect(remove(a)).resolves.toEqual({ ok: true });
    expect(await orgAdmins()).toBe(1);
  });

  it('프로젝트 admin 은 조직 admin 으로 세지 않는다 — 그것만 남기고 떼지 못한다', async () => {
    const a = await grant(alice, 'admin');
    await grant(bob, 'admin', projectId);
    expect(await refusedAsLast(remove(a))).toBe(true);
  });

  it('프로젝트의 마지막 admin 은 이 규칙 밖이다 — 조직 admin 이 남는다', async () => {
    await grant(alice, 'admin');
    const projectAdmin = await grant(bob, 'admin', projectId);
    await expect(remove(projectAdmin)).resolves.toEqual({ ok: true });
  });

  it('두 admin 이 서로를 동시에 떼어도 한 명은 남는다', async () => {
    // 잠금이 없으면 둘 다 "다른 admin 이 하나 있다" 를 보고 지나간다 — 한 번의 우연으로는
    // 경쟁을 잡지 못하므로 여러 번 돈다
    for (let round = 0; round < 20; round += 1) {
      await pool.query(`DELETE FROM membership WHERE org_id = $1`, [orgId]);
      const a = await grant(alice, 'admin');
      const b = await grant(bob, 'admin');
      const results = await Promise.allSettled([remove(a), remove(b)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult | undefined)?.reason?.details?.['kind']).toBe(
        'last_org_admin',
      );
      expect(await orgAdmins()).toBe(1);
    }
  });

  it('떼기와 역할 바꾸기가 동시에 와도 한 명은 남는다', async () => {
    for (let round = 0; round < 20; round += 1) {
      await pool.query(`DELETE FROM membership WHERE org_id = $1`, [orgId]);
      const a = await grant(alice, 'admin');
      const b = await grant(bob, 'admin');
      await Promise.allSettled([
        remove(a),
        auth.updateMembership({ membershipId: b, role: 'viewer', actorRoles: ['admin'] }),
      ]);
      expect(await orgAdmins()).toBe(1);
    }
  });
});
