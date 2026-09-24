// 조직 전체 범위는 조직 admin 만 — REQ-API-169 (2026-09-24 사람 결정 · 조직·프로젝트 경계 점검)
//
// 예전 판정은 "그 조직 **어디서든** admin 이면 된다" 였다. 한 프로젝트의 admin 이 조직 전체
// 멤버의 역할을 바꾸고, 조직 전체 초대를 만들 수 있었다. 판정은 `AuthService.assertCanManageScope`
// 한 곳이고 멤버 배정·역할 변경/삭제·초대 생성/회수가 같이 쓴다(D-05). 권한이라 실물로 본다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { InvitationService } from '../../src/modules/auth/invitation.service.js';
import type { NervDb } from '../../src/common/database.module.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let auth: AuthService;
let invitations: InvitationService;
const orgAdmin = newId();
const sudokuAdmin = newId();
const target = newId();
let orgId: string;
let sudokuId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_scopeadmin');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const orm = drizzle(pool) as unknown as NervDb;
  auth = new AuthService(orm);
  invitations = new InvitationService(orm, auth);

  orgId = newId();
  sudokuId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','에이스')`, [
    orgId,
  ]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'sudoku','SUD','스도쿠'), ($3,$2,'clemvion','CLV','clemvion')`,
    [sudokuId, orgId, newId()],
  );
  for (const [id, email, name] of [
    [orgAdmin, 'org@example.com', '조직관리자'],
    [sudokuAdmin, 'sudoku@example.com', '스도쿠관리자'],
    [target, 'yuna@example.com', '유나'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
       ($1,$2,NULL,$3,'admin'), ($4,$2,$5,$6,'admin')`,
    [newId(), orgId, orgAdmin, newId(), sudokuId, sudokuAdmin],
  );
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

/** 권한 거절인가 — 다른 실패(없는 사용자 등)를 권한 통과로 오인하지 않게 코드를 본다 */
async function forbidden(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    return (e as { code?: string }).code === NERV_ERROR.FORBIDDEN;
  }
}

async function membershipOf(projectId: string | null): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'viewer')`,
    [id, orgId, projectId, target],
  );
  return id;
}

describe('멤버 배정 (EP-MBR-02)', () => {
  const add = (actor: string, project: string | null, role = 'planner') =>
    auth.addMember({
      actorUserId: actor,
      orgSlug: 'acme',
      email: 'yuna@example.com',
      role,
      projectSlug: project,
    });

  it('프로젝트 admin 은 조직 전체로 배정할 수 없다', async () => {
    expect(await forbidden(add(sudokuAdmin, null))).toBe(true);
  });

  it('프로젝트 admin 은 남의 프로젝트에 배정할 수 없다', async () => {
    expect(await forbidden(add(sudokuAdmin, 'clemvion'))).toBe(true);
  });

  it('프로젝트 admin 은 자기 프로젝트에 배정한다', async () => {
    await expect(add(sudokuAdmin, 'sudoku', 'qa')).resolves.toBeDefined();
  });

  it('조직 admin 은 조직 전체로도 배정한다', async () => {
    await expect(add(orgAdmin, null, 'designer')).resolves.toBeDefined();
  });
});

describe('역할 변경·삭제 (EP-MBR-03·04)', () => {
  it('조직 전체 멤버십은 프로젝트 admin 이 건드릴 수 없다', async () => {
    const id = await membershipOf(null);
    expect(await forbidden(auth.assertAdminOfMembership(id, sudokuAdmin))).toBe(true);
    await expect(auth.assertAdminOfMembership(id, orgAdmin)).resolves.toBeUndefined();
  });

  it('자기 프로젝트의 멤버십은 프로젝트 admin 이 다룬다', async () => {
    const id = await membershipOf(sudokuId);
    await expect(auth.assertAdminOfMembership(id, sudokuAdmin)).resolves.toBeUndefined();
  });
});

describe('초대 (EP-INV-01·03)', () => {
  const invite = (actor: string, project: string | null, email: string) =>
    invitations.create({
      actorUserId: actor,
      orgSlug: 'acme',
      email,
      role: 'viewer',
      projectSlug: project,
    });

  it('프로젝트 admin 은 조직 전체 초대를 만들 수 없다', async () => {
    expect(await forbidden(invite(sudokuAdmin, null, 'a@example.com'))).toBe(true);
  });

  it('프로젝트 admin 은 자기 프로젝트로 부른다 — 그 초대는 거둘 수도 있다', async () => {
    const created = (await invite(sudokuAdmin, 'sudoku', 'b@example.com')) as { id: string };
    await expect(
      invitations.revoke({ actorUserId: sudokuAdmin, invitationId: created.id }),
    ).resolves.toEqual({ ok: true });
  });

  it('조직 admin 이 만든 조직 전체 초대는 프로젝트 admin 이 거둘 수 없다', async () => {
    const created = (await invite(orgAdmin, null, 'c@example.com')) as { id: string };
    expect(
      await forbidden(invitations.revoke({ actorUserId: sudokuAdmin, invitationId: created.id })),
    ).toBe(true);
  });
});

// ── 조직 수준 조작도 조직 admin 만 — REQ-API-171 (2026-09-24 사람 결정) ─────────────────
//
// 결정 4 를 멤버십·초대에 적용한 뒤 남아 있던 자리다. 조직 이름·삭제·새 프로젝트는 여전히
// "조직 어디서든 admin" 으로 판정되어, 한 프로젝트의 admin 이 조직 이름을 바꿀 수 있었다.
describe('조직 수준 조작 (EP-ORG-04·05 · EP-PRJ-02)', () => {
  it('프로젝트 admin 은 조직 이름을 바꿀 수 없다 — 조직 admin 은 바꾼다', async () => {
    expect(
      await forbidden(auth.updateOrg({ userId: sudokuAdmin, orgSlug: 'acme', name: '딴이름' })),
    ).toBe(true);
    await expect(
      auth.updateOrg({ userId: orgAdmin, orgSlug: 'acme', name: '에이스' }),
    ).resolves.toBeDefined();
  });

  it('프로젝트 admin 은 조직을 지울 수 없다 — 권한에서 먼저 막힌다(프로젝트가 남았다는 이유가 아니라)', async () => {
    expect(await forbidden(auth.deleteOrg({ userId: sudokuAdmin, orgSlug: 'acme' }))).toBe(true);
  });

  it('프로젝트 admin 은 새 프로젝트를 만들 수 없다 — 조직 admin 은 만든다', async () => {
    const make = (userId: string, slug: string, key: string) =>
      auth.createProject({ userId, orgSlug: 'acme', slug, key, name: slug });
    expect(await forbidden(make(sudokuAdmin, 'side', 'SID'))).toBe(true);
    await expect(make(orgAdmin, 'main-app', 'MAP')).resolves.toBeDefined();
  });
});

// ── 조직 전체 토큰 표도 조직 admin 만 — REQ-API-172 (2026-09-24 사람 결정) ──────────────
describe('조직 전체 토큰 표 (EP-TOK-04)', () => {
  it('프로젝트 admin 은 조직의 모든 토큰을 볼 수 없다 — 조직 admin 은 본다', async () => {
    expect(
      await forbidden(auth.orgTokensBySlug({ actorUserId: sudokuAdmin, orgSlug: 'acme' })),
    ).toBe(true);
    await expect(
      auth.orgTokensBySlug({ actorUserId: orgAdmin, orgSlug: 'acme' }),
    ).resolves.toBeInstanceOf(Array);
  });
});

// ── 같은 부류의 나머지도 조직 admin 만 — REQ-API-173 (2026-09-24 사람 결정) ──────────────
describe('남의 토큰 폐기 (EP-TOK-03)', () => {
  async function tokenOfTarget(): Promise<string> {
    // 앞 절이 이미 같은 멤버십을 만들었을 수 있다 — 순서에 기대지 않는다
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'viewer')
       ON CONFLICT DO NOTHING`,
      [newId(), orgId, sudokuId, target],
    );
    return (
      await auth.issueToken({
        projectId: sudokuId,
        userId: target,
        name: 'leak',
        scopes: ['spec:read'],
      })
    ).tokenId;
  }
  async function revokedAt(tokenId: string): Promise<string | null> {
    const { rows } = await pool.query<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM api_token WHERE id = $1`,
      [tokenId],
    );
    return rows[0]?.revoked_at ?? null;
  }

  it('프로젝트 admin 은 자기 프로젝트라도 남의 토큰을 끊을 수 없다', async () => {
    const tokenId = await tokenOfTarget();
    await expect(auth.revokeToken(tokenId, sudokuAdmin)).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
    expect(await revokedAt(tokenId)).toBeNull();
  });

  it('조직 admin 은 끊는다 — 본인도 자기 것을 끊는다', async () => {
    const byOrg = await tokenOfTarget();
    await expect(auth.revokeToken(byOrg, orgAdmin)).resolves.toBeUndefined();
    expect(await revokedAt(byOrg)).not.toBeNull();
    const own = await tokenOfTarget();
    await expect(auth.revokeToken(own, target)).resolves.toBeUndefined();
    expect(await revokedAt(own)).not.toBeNull();
  });
});

describe('초대 목록 (EP-INV-02)', () => {
  it('프로젝트 admin 은 자기 프로젝트의 초대만 본다 — 조직 전체·남의 프로젝트 초대는 빠진다', async () => {
    const mine = (await invitations.create({
      actorUserId: sudokuAdmin,
      orgSlug: 'acme',
      projectSlug: 'sudoku',
      email: 'mine@example.com',
      role: 'developer',
    })) as { id: string };
    const orgWide = (await invitations.create({
      actorUserId: orgAdmin,
      orgSlug: 'acme',
      projectSlug: null,
      email: 'orgwide@example.com',
      role: 'viewer',
    })) as { id: string };
    const other = (await invitations.create({
      actorUserId: orgAdmin,
      orgSlug: 'acme',
      projectSlug: 'clemvion',
      email: 'other@example.com',
      role: 'viewer',
    })) as { id: string };

    const seen = (await invitations.list({ actorUserId: sudokuAdmin, orgSlug: 'acme' })).map(
      (r) => r.id,
    );
    expect(seen).toContain(mine.id);
    expect(seen).not.toContain(orgWide.id);
    expect(seen).not.toContain(other.id);

    const all = (await invitations.list({ actorUserId: orgAdmin, orgSlug: 'acme' })).map(
      (r) => r.id,
    );
    expect(all).toEqual(expect.arrayContaining([mine.id, orgWide.id, other.id]));
  });
});
