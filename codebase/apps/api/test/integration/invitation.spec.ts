// 조직 초대 — 사람 결정 2026-08-27 (api.md §2.1b)
//
// 여기서 지키는 것 넷: **초대한 이메일로만** · 7일 만료 · 회수 · 수락이 멤버십을 만든다.
// 첫째가 이 기능의 안전선이다 — 링크는 메신저를 타고 흐르고, 새면 아무나 들어온다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { InvitationService } from '../../src/modules/auth/invitation.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let invitations: InvitationService;
let adminId: string;
let guestId: string;
let strangerId: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_invite');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  invitations = new InvitationService(drizzle(pool), new AuthService(drizzle(pool)));
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

const invite = (over: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
  invitations.create({
    actorUserId: adminId,
    orgSlug: 'acme',
    email: 'guest@example.com',
    role: 'developer',
    ...over,
  } as never);

describe('초대 생성 (EP-INV-01)', () => {
  it('토큰 원문은 **이 응답에서 한 번만** 나간다 — DB 에는 해시만 있다', async () => {
    const made = await invite();
    expect(String(made['token']).length).toBeGreaterThan(20);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation WHERE token_hash::text LIKE '%' || $1 || '%'`,
      [String(made['token']).slice(0, 8)],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('admin 이 아니면 부를 수 없다 — 밖에서는 조직의 존재조차 알리지 않는다', async () => {
    // 멤버인데 admin 이 아니면 **금지**다
    const member = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','개발','active')`,
      [member],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,NULL,$3,'developer')`,
      [newId(), orgId, member],
    );
    await expect(invite({ actorUserId: member })).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
    });

    // 아예 멤버가 아니면 **없는 조직**이다 — 밖에서 조직 목록을 훑을 수 있으면 안 된다
    await expect(invite({ actorUserId: strangerId })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'not_found' },
    });
  });

  it('다시 부르면 앞의 대기 초대를 회수하고 새로 만든다 — 오타를 고치는 것이 실제 사용이다', async () => {
    const first = await invite();
    const second = await invite();
    expect(second['token']).not.toBe(first['token']);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation
        WHERE email = 'guest@example.com' AND accepted_at IS NULL AND revoked_at IS NULL`,
    );
    // 대기 중인 것은 언제나 하나다(부분 unique)
    expect(rows[0]?.n).toBe(1);
  });

  it('이미 그 역할이면 초대하지 않는다 — 눌러도 아무 일 없는 링크를 쥐여 주지 않는다', async () => {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,NULL,$3,'qa')`,
      [newId(), orgId, guestId],
    );
    await expect(invite({ role: 'qa' })).rejects.toMatchObject({
      details: { kind: 'already_member' },
    });
  });
});

describe('수락 (EP-INV-04·05)', () => {
  it('로그인 전 미리보기는 조직과 역할을 말하되 **이메일은 가린다**', async () => {
    const made = await invite();
    const preview = await invitations.preview(String(made['token']));
    expect(preview).toMatchObject({ org_slug: 'acme', role: 'developer', state: 'pending' });
    expect(preview['email_hint']).toBe('g***@example.com');
    expect(preview['email_hint']).not.toContain('guest@');
  });

  it('**초대한 이메일로만** 수락된다 — 링크를 주운 사람은 들어오지 못한다', async () => {
    const made = await invite();
    await expect(
      invitations.accept({ token: String(made['token']), userId: strangerId }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN, details: { kind: 'email_mismatch' } });
  });

  it('수락하면 멤버십이 선다 — 초대에 적힌 소속과 역할 그대로', async () => {
    const made = await invite({ projectSlug: 'app', role: 'planner' });
    await invitations.accept({ token: String(made['token']), userId: guestId });

    const { rows } = await pool.query<{ role: string; project_id: string | null }>(
      `SELECT role::text AS role, project_id FROM membership
        WHERE user_id = $1 AND role = 'planner'`,
      [guestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.project_id).toBe(projectId);
  });

  it('두 번 수락되지 않는다', async () => {
    const made = await invite({ role: 'designer' });
    await invitations.accept({ token: String(made['token']), userId: guestId });
    await expect(
      invitations.accept({ token: String(made['token']), userId: guestId }),
    ).rejects.toMatchObject({ details: { kind: 'accepted' } });
  });

  it('7일이 지나면 만료다 — 되찾는 길은 재발급이다', async () => {
    const made = await invite({ role: 'viewer' });
    await pool.query(
      `UPDATE invitation SET expires_at = now() - interval '1 day'
        WHERE accepted_at IS NULL AND revoked_at IS NULL`,
    );
    await expect(
      invitations.accept({ token: String(made['token']), userId: guestId }),
    ).rejects.toMatchObject({ details: { kind: 'expired' } });
  });

  it('회수된 초대는 수락되지 않는다 — 기록은 남는다', async () => {
    const made = await invite({ role: 'viewer' });
    const [pending] = (await invitations.list({ actorUserId: adminId, orgSlug: 'acme' })).filter(
      (r) => r.state === 'pending',
    );
    await invitations.revoke({ actorUserId: adminId, invitationId: pending?.id ?? '' });
    await expect(
      invitations.accept({ token: String(made['token']), userId: guestId }),
    ).rejects.toMatchObject({ details: { kind: 'revoked' } });
    // 지우지 않는다 — 누가 누구를 불렀는지가 기록이다(FR-16)
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM invitation WHERE revoked_at IS NOT NULL`,
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });
});

describe('내게 온 초대 (EP-INV-06)', () => {
  it('대기 중인 것만 준다 — 화면 셋이 이 값을 쓴다', async () => {
    await invite({ email: 'stranger@example.com', role: 'viewer' });
    const mine = await invitations.mine(strangerId);
    expect(mine.map((r) => r.org_slug)).toEqual(['acme']);
    expect(mine[0]?.state).toBe('pending');
    // 남의 초대는 보이지 않는다
    expect(await invitations.mine(adminId)).toEqual([]);
  });
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  adminId = newId();
  guestId = newId();
  strangerId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme','Acme')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'app','APP','App')`,
    [projectId, orgId],
  );
  for (const [id, email, name] of [
    [adminId, 'admin@example.com', '관리'],
    [guestId, 'guest@example.com', '손님'],
    [strangerId, 'stranger@example.com', '남'],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, email, name],
    );
  }
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,NULL,$3,'admin')`,
    [newId(), orgId, adminId],
  );
}
