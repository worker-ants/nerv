// E03-S02 — PAT 발급·검증.
//
//   WHEN 폐기된 PAT 또는 스코프 밖 프로젝트로 호출하면,
//   THE SYSTEM SHALL NERV_UNAUTHENTICATED 또는 NERV_FORBIDDEN 으로 거부한다
//
// 토큰은 (사용자, 프로젝트, 역할, 스코프) 튜플에 바인딩되고 권한은 소유 사용자의 부분집합을
// 넘지 못한다(D-08). 그 성질들을 실제 DB 상대로 확인한다 — 해시 저장·원문 미저장 포함.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService, hashToken } from '../../src/modules/auth/auth.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let auth: AuthService;
let projectId: string;
let otherProjectId: string;
let userId: string;
let outsiderId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_auth');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  auth = new AuthService(drizzle(pool));
  await seed();
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

describe('PAT 발급 (EP-TOK-02)', () => {
  it('인증 실패는 **왜** 실패했는지 말하지 않는다 — 유효한 토큰 탐색의 단서가 된다', async () => {
    // `unauthenticated()` 는 "사유는 로그에만"이라고 적어 두고 `reason` 을 응답 details 에
    // 그대로 실어 보냈다(실측 2026-08-23). "형식이 아니다 / 모르는 토큰이다"를 구분해 주면
    // 막으려던 그 단서가 된다.
    const shapes = new Set<string>();
    for (const raw of ['잘못된형식', `nerv_${'x'.repeat(43)}`]) {
      const err = await auth.verifyPat(raw).then(
        () => null,
        (e: unknown) => e as { code: string; details: Record<string, unknown> },
      );
      expect(err?.code).toBe(NERV_ERROR.UNAUTHENTICATED);
      expect(err?.details['reason']).toBeUndefined();
      shapes.add(JSON.stringify(err?.details));
    }
    // 두 실패가 **구별되지 않아야** 한다 — 구별되면 그것이 곧 신호다
    expect(shapes.size).toBe(1);
  });

  it('원문은 nerv_ 접두 + base64url 이고 응답에서 한 번만 나온다', async () => {
    const issued = await auth.issueToken({
      projectId,
      userId,
      name: '노트북 Claude Code',
      scopes: ['spec:read', 'task:claim'],
    });

    expect(issued.token).toMatch(/^nerv_[A-Za-z0-9_-]{43}$/);
    expect(issued.prefix).toBe(issued.token.slice(0, 8));

    // 서버는 해시만 보관한다 — 원문은 어디에도 없다
    const { rows } = await pool.query<{ token_hash: Buffer; prefix: string }>(
      `SELECT token_hash, prefix FROM api_token WHERE id = $1`,
      [issued.tokenId],
    );
    expect(rows[0]?.token_hash.equals(hashToken(issued.token))).toBe(true);
    const dump = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_token WHERE prefix = $1 AND encode(token_hash,'hex') = $2`,
      [issued.prefix, hashToken(issued.token).toString('hex')],
    );
    expect(dump.rows[0]?.n).toBe(1);
  });

  it('사람 전용 스코프는 부여 자체가 불가능하다 — 정책이 아니라 불변식이다', async () => {
    await expect(
      auth.issueToken({
        projectId,
        userId,
        name: '위험한 토큰',
        scopes: ['spec:read', 'spec:approve'],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });

    await expect(
      auth.issueToken({ projectId, userId, name: 'x', scopes: ['approval:decide'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });

  it('알 수 없는 스코프는 거부한다', async () => {
    await expect(
      auth.issueToken({ projectId, userId, name: 'x', scopes: ['spec:destroy'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('프로젝트 멤버가 아니면 발급하지 않는다 — 권한은 소유 사용자의 부분집합이다', async () => {
    await expect(
      auth.issueToken({ projectId, userId: outsiderId, name: 'x', scopes: ['spec:read'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });
});

describe('PAT 검증', () => {
  it('유효한 토큰은 Principal 을 준다 — isAgent 는 참이다(FR-16 감사 구분)', async () => {
    const issued = await auth.issueToken({
      projectId,
      userId,
      name: 'ok',
      scopes: ['spec:read', 'task:claim'],
    });
    const principal = await auth.verifyPat(issued.token);

    expect(principal).toMatchObject({
      userId,
      isAgent: true,
      projectId,
      // 겸직이 기본형이다 — 하나가 아니라 **집합**이다(0003_multi_role)
      roles: ['developer'],
      tokenId: issued.tokenId,
    });
    expect(principal.scopes).toEqual(['spec:read', 'task:claim']);
  });

  it('폐기된 토큰은 NERV_UNAUTHENTICATED', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 'r', scopes: ['spec:read'] });
    await auth.revokeToken(issued.tokenId, userId);
    await expect(auth.verifyPat(issued.token)).rejects.toMatchObject({
      code: NERV_ERROR.UNAUTHENTICATED,
    });
  });

  it('만료된 토큰은 NERV_UNAUTHENTICATED', async () => {
    const issued = await auth.issueToken({
      projectId,
      userId,
      name: 'e',
      scopes: ['spec:read'],
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(auth.verifyPat(issued.token)).rejects.toMatchObject({
      code: NERV_ERROR.UNAUTHENTICATED,
    });
  });

  it('알 수 없는 토큰은 사유를 응답에 싣지 않는다 — 유효 토큰 탐색의 단서가 된다', async () => {
    const err = await auth.verifyPat('nerv_' + 'A'.repeat(43)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: NERV_ERROR.UNAUTHENTICATED });
    expect((err as { message: string }).message).toBe('자격증명이 유효하지 않습니다.');
  });

  it('형식이 아닌 문자열도 같은 에러다', async () => {
    await expect(auth.verifyPat('bearer-something')).rejects.toMatchObject({
      code: NERV_ERROR.UNAUTHENTICATED,
    });
  });

  it('멤버십이 사라지면 토큰이 살아 있어도 거부한다', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 'm', scopes: ['spec:read'] });
    await pool.query(`DELETE FROM membership WHERE user_id = $1`, [userId]);
    await expect(auth.verifyPat(issued.token)).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
    });
    // 복구
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'developer' FROM project WHERE id = $3`,
      [newId(), userId, projectId],
    );
  });

  it('last_used_at 을 남긴다 — 감사용', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 'u', scopes: ['spec:read'] });
    await auth.verifyPat(issued.token);
    await new Promise((r) => setTimeout(r, 100));
    const { rows } = await pool.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM api_token WHERE id = $1`,
      [issued.tokenId],
    );
    expect(rows[0]?.last_used_at).not.toBeNull();
  });
});

describe('스코프·프로젝트 경계', () => {
  it('스코프가 없으면 NERV_FORBIDDEN — 역할 판정에 AND 로 추가된다', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 's', scopes: ['spec:read'] });
    const principal = await auth.verifyPat(issued.token);

    expect(() => auth.assertScope(principal, 'spec:read')).not.toThrow();
    expect(() => auth.assertScope(principal, 'task:claim')).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('토큰의 프로젝트 밖은 거부한다 (NFR-03 토큰 프로젝트 스코프)', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 'p', scopes: ['spec:read'] });
    const principal = await auth.verifyPat(issued.token);

    expect(() => auth.assertProjectScope(principal, projectId)).not.toThrow();
    expect(() => auth.assertProjectScope(principal, otherProjectId)).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('slug 로 프로젝트를 해소한다 — 경로 파라미터 {proj} 는 slug 다', async () => {
    expect(await auth.resolveProject('clemvion')).toMatchObject({ id: projectId, key: 'CLV' });
    expect(await auth.resolveProject('없는-프로젝트')).toBeNull();
  });
});

describe('EP-ORG-03~05 · EP-PRJ-05 — 조직·프로젝트 관리 (2026-08-24 신설)', () => {
  it('조직을 만들면 만든 사람이 그 조직의 admin 이 된다', async () => {
    await auth.createOrg({ userId, slug: 'acme', name: 'Acme' });
    const { rows } = await pool.query<{ role: string }>(
      `SELECT m.role::text AS role FROM membership m JOIN organization o ON o.id = m.org_id
        WHERE o.slug = 'acme'`,
    );
    // 아무도 admin 이 아닌 조직은 만들자마자 아무도 손댈 수 없는 껍데기다
    expect(rows.map((r) => r.role)).toEqual(['admin']);
  });

  it('이름은 바꾸고 slug 는 지킨다 — slug 는 링크의 축이다(D-09)', async () => {
    await auth.createOrg({ userId, slug: 'rename-me', name: '옛 이름' });
    const updated = await auth.updateOrg({ userId, orgSlug: 'rename-me', name: '새 이름' });
    expect(updated).toMatchObject({ slug: 'rename-me', name: '새 이름' });
  });

  it('admin 이 아니면 고칠 수 없다', async () => {
    await auth.createOrg({ userId, slug: 'guarded', name: '보호' });
    const outsider = newId();
    await pool.query(
      // 이메일은 unique 다 — 스위트가 DB 를 공유하므로 id 로 유일하게 만든다
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,'밖','active')`,
      [outsider, `out-${outsider}@example.com`],
    );
    await expect(
      auth.updateOrg({ userId: outsider, orgSlug: 'guarded', name: '탈취' }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION });
  });

  it('프로젝트가 남아 있는 조직은 지울 수 없다 — 되돌릴 수 없는 일 앞의 단계다', async () => {
    await auth.createOrg({ userId, slug: 'busy', name: 'Busy' });
    const project = await auth.createProject({
      userId,
      orgSlug: 'busy',
      slug: 'busy-one',
      key: 'BSY',
      name: '프로젝트 하나',
    });

    await expect(auth.deleteOrg({ userId, orgSlug: 'busy' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });

    // **보관은 삭제가 아니다** — 보관해도 프로젝트는 남으므로 조직은 여전히 못 지운다
    await auth.setProjectArchived({
      projectId: String(project['id']),
      roles: ['admin'],
      archived: true,
    });
    await expect(auth.deleteOrg({ userId, orgSlug: 'busy' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
  });

  it('빈 조직은 지워진다', async () => {
    await auth.createOrg({ userId, slug: 'empty', name: '빈 조직' });
    await expect(auth.deleteOrg({ userId, orgSlug: 'empty' })).resolves.toEqual({ deleted: true });
    const { rows } = await pool.query(`SELECT 1 FROM organization WHERE slug = 'empty'`);
    expect(rows).toHaveLength(0);
  });

  it('프로젝트는 보관한다 — 목록에서 빠지되 링크는 살아 있다', async () => {
    await auth.createOrg({ userId, slug: 'arch', name: 'Arch' });
    const project = await auth.createProject({
      userId,
      orgSlug: 'arch',
      slug: 'to-archive',
      key: 'ARC',
      name: '보관할 프로젝트',
    });
    const projectId = String(project['id']);

    const listed = async (includeArchived: boolean): Promise<string[]> =>
      (await auth.projects({ userId, orgSlug: 'arch', includeArchived })).map((p) =>
        String(p['slug']),
      );

    expect(await listed(false)).toContain('to-archive');
    await auth.setProjectArchived({ projectId, roles: ['admin'], archived: true });
    expect(await listed(false)).not.toContain('to-archive');
    expect(await listed(true)).toContain('to-archive');
    // 주소를 아는 사람은 그대로 들어간다 — 보관은 숨김이지 삭제가 아니다
    expect(await auth.project(projectId)).toMatchObject({ slug: 'to-archive' });

    await auth.setProjectArchived({ projectId, roles: ['admin'], archived: false });
    expect(await listed(false)).toContain('to-archive');
  });

  it('admin 이 아니면 보관할 수 없다', async () => {
    await expect(
      auth.setProjectArchived({ projectId, roles: ['developer'], archived: true }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  otherProjectId = newId();
  userId = newId();
  outsiderId = newId();

  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'out@example.com','외부','active')`,
    [outsiderId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'other','OTH','other')`,
    [otherProjectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
}
