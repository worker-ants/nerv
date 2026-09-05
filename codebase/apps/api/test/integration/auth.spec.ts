// E03-S02 — PAT 발급·검증.
//
//   WHEN 폐기된 PAT 또는 권한 밖 프로젝트로 호출하면,
//   THE SYSTEM SHALL NERV_UNAUTHENTICATED 또는 NERV_FORBIDDEN 으로 거부한다
//
// 토큰은 (사용자, 프로젝트, 역할, 소속) 튜플에 바인딩되고 권한은 소유 사용자의 부분집합을
// 넘지 못한다(D-08). 그 성질들을 실제 DB 상대로 확인한다 — 해시 저장·원문 미저장 포함.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService, hashToken } from '../../src/modules/auth/auth.service.js';
import { dbConstraintError } from '../../src/common/db-error.js';
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

  it('사람 전용 권한은 부여 자체가 불가능하다 — 정책이 아니라 불변식이다', async () => {
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

  it('알 수 없는 권한은 거부한다', async () => {
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

describe('권한·프로젝트 경계', () => {
  it('권한이 없으면 NERV_FORBIDDEN — 역할 판정에 AND 로 추가된다', async () => {
    const issued = await auth.issueToken({ projectId, userId, name: 's', scopes: ['spec:read'] });
    const principal = await auth.verifyPat(issued.token);

    expect(() => auth.assertScope(principal, 'spec:read')).not.toThrow();
    expect(() => auth.assertScope(principal, 'task:claim')).toThrowError(
      expect.objectContaining({ code: NERV_ERROR.FORBIDDEN }),
    );
  });

  it('토큰의 프로젝트 밖은 거부한다 (NFR-03 토큰 프로젝트 소속)', async () => {
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

describe('멤버십 판정 — 겸직은 합집합, 조직은 경계다 (2026-08-24)', () => {
  it('조직 단위 멤버십(project_id NULL)은 그 조직의 모든 프로젝트에 적용된다', async () => {
    const orgUser = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'orgadmin@example.com','조직관리','active')`,
      [orgUser],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, NULL, $2, 'admin' FROM project WHERE id = $3`,
      [newId(), orgUser, projectId],
    );

    // 프로젝트 소속 행이 하나도 없는데도 admin 이어야 한다 — 화면이 이 사람을
    // "아무 역할 없음"으로 읽어 스펙 메타 편집을 잠갔던 것이 사람 보고의 원인이었다.
    expect(await auth.assertMembership(orgUser, projectId)).toEqual(['admin']);
    expect(await auth.assertMembership(orgUser, otherProjectId)).toEqual(['admin']);
  });

  it('겸직은 합집합이다 — 프로젝트 역할과 조직 역할을 함께 준다', async () => {
    const bothUser = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'both@example.com','겸직','active')`,
      [bothUser],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, NULL, $2, 'admin' FROM project WHERE id = $3`,
      [newId(), bothUser, projectId],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'planner' FROM project WHERE id = $3`,
      [newId(), bothUser, projectId],
    );
    expect((await auth.assertMembership(bothUser, projectId)).sort()).toEqual(['admin', 'planner']);
  });

  it('**다른 조직의** 조직 단위 역할은 새지 않는다 — 조직이 경계다', async () => {
    // `project_id IS NULL` 만 보고 org_id 를 보지 않으면, A 조직의 admin 이 B 조직의
    // 프로젝트에서도 admin 이 된다. 멤버십 판정은 표면 셋(REST·WS·SSE)이 공유하는
    // 한 곳이라 여기가 새면 전부 샌다.
    const otherOrg = newId();
    const foreignProject = newId();
    const crossUser = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme-sep','Acme')`, [
      otherOrg,
    ]);
    await pool.query(
      `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'acme-app','ACM','acme app')`,
      [foreignProject, otherOrg],
    );
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'cross@example.com','교차','active')`,
      [crossUser],
    );
    // 우리 조직에서는 조직 단위 admin
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, NULL, $2, 'admin' FROM project WHERE id = $3`,
      [newId(), crossUser, projectId],
    );
    // 남의 조직에서는 그 프로젝트의 viewer 일 뿐이다
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'viewer')`,
      [newId(), otherOrg, foreignProject, crossUser],
    );

    expect(await auth.assertMembership(crossUser, foreignProject)).toEqual(['viewer']);
  });
});

describe('조직 경계 — 토큰의 역할·명부·폐기 (2026-09-02 보안 점검)', () => {
  it('PAT 의 역할 산출도 조직을 본다 — 남의 조직 admin 이 이 토큰의 권한이 되지 않는다', async () => {
    // `assertMembership` 은 2026-08-24 에 "조직이 경계다" 로 고쳤는데 `verifyPat` 의
    // 역할 서브쿼리만 project_id IS NULL 로 남아 있었다. 유효 권한의 상한이 역할이므로
    // 그 구멍은 그대로 권한이 됐다.
    const otherOrg = newId();
    const crossUser = newId();
    await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'acme-pat','Acme')`, [
      otherOrg,
    ]);
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'crosspat@example.com','교차','active')`,
      [crossUser],
    );
    // 남의 조직에서는 조직 단위 admin
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,NULL,$3,'admin')`,
      [newId(), otherOrg, crossUser],
    );
    // 우리 프로젝트에서는 viewer 일 뿐이다
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'viewer' FROM project WHERE id = $3`,
      [newId(), crossUser, projectId],
    );

    const { token } = await auth.issueToken({
      projectId,
      userId: crossUser,
      name: 'cross',
      scopes: ['spec:read', 'spec:draft'],
    });
    const principal = await auth.verifyPat(token);
    expect(principal.roles).toEqual(['viewer']);
    // viewer 는 읽기뿐이다 — 토큰이 더 실었어도 유효 권한은 역할이 상한이다
    expect(principal.scopes).toEqual(['spec:read']);
  });

  it('조직 명부는 그 조직의 멤버만 읽는다 (EP-MBR-01)', async () => {
    const outsider = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'outsider@example.com','외부','active')`,
      [outsider],
    );
    await expect(auth.members('nerv', outsider)).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'no_membership' },
    });

    const rows = await auth.members('nerv', userId);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('토큰 폐기는 본인 또는 admin 이다 (EP-TOK-03)', async () => {
    const owner = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'owner@example.com','주인','active')`,
      [owner],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'developer' FROM project WHERE id = $3`,
      [newId(), owner, projectId],
    );
    const stranger = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'stranger@example.com','타인','active')`,
      [stranger],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'developer' FROM project WHERE id = $3`,
      [newId(), stranger, projectId],
    );

    const projectAdmin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'padmin@example.com','관리','active')`,
      [projectAdmin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'admin' FROM project WHERE id = $3`,
      [newId(), projectAdmin, projectId],
    );

    const issued = await auth.issueToken({
      projectId,
      userId: owner,
      name: 'leaked',
      scopes: ['spec:read'],
    });
    // 남은 못 지운다
    await expect(auth.revokeToken(issued.tokenId, stranger)).rejects.toMatchObject({
      details: { kind: 'not_found' },
    });
    // admin 은 지운다 — 유출된 토큰을 끊을 사람이 소유자뿐이면 대응이 연락으로 끝난다
    await auth.revokeToken(issued.tokenId, projectAdmin);
    await expect(auth.verifyPat(issued.token)).rejects.toMatchObject({
      code: NERV_ERROR.UNAUTHENTICATED,
    });
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
      actor: { userId, isAgent: false },
      projectId: String(project['id']),
      roles: ['admin'],
      archived: true,
    });
    await expect(auth.deleteOrg({ userId, orgSlug: 'busy' })).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
    });
  });

  /**
   * `X-NERV-Project` — 오배치를 잡는다(REQ-API-094 · 2026-09-05 사람 결정).
   *
   * 이 헤더는 명세가 "토큰의 프로젝트와 대조" 라고 적어 두었는데 **서버가 어디서도 읽지
   * 않았다**(2026-09-05 감사 · `apps/api/src` 전체 grep 0건). 그래서 매뉴얼의 진단표는
   * 아무 일도 안 하는 헤더를 고치라고 사람을 보내고 있었다.
   *
   * 권한의 근거는 지금도 토큰이다 — 헤더는 **틀렸을 때 멈추는** 장치일 뿐이다.
   */
  describe('X-NERV-Project — 권한의 근거가 아니라 오배치 검사다', () => {
    it('헤더가 없으면 지금처럼 통과한다 — 배포된 설정을 막지 않는다', async () => {
      const { token } = await auth.issueToken({
        projectId,
        userId,
        name: 'no-header',
        scopes: ['spec:read'],
      });
      await expect(auth.verifyPat(token)).resolves.toMatchObject({ isAgent: true });
    });

    it('헤더가 토큰의 프로젝트와 같으면 통과한다', async () => {
      const { token } = await auth.issueToken({
        projectId,
        userId,
        name: 'same-header',
        scopes: ['spec:read'],
      });
      await expect(auth.verifyPat(token, null, 'clemvion')).resolves.toMatchObject({
        isAgent: true,
      });
    });

    it('어긋나면 거절하고 **두 값을 모두** 말한다 — 어느 쪽을 고칠지는 나란히 봐야 안다', async () => {
      const { token } = await auth.issueToken({
        projectId,
        userId,
        name: 'wrong-header',
        scopes: ['spec:read'],
      });
      await expect(auth.verifyPat(token, null, 'some-other-project')).rejects.toMatchObject({
        code: NERV_ERROR.FORBIDDEN,
        details: {
          kind: 'project_mismatch',
          header: 'some-other-project',
          token: 'clemvion',
        },
      });
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
    await auth.setProjectArchived({
      actor: { userId, isAgent: false },
      projectId,
      roles: ['admin'],
      archived: true,
    });
    expect(await listed(false)).not.toContain('to-archive');
    expect(await listed(true)).toContain('to-archive');
    // 주소를 아는 사람은 그대로 들어간다 — 보관은 숨김이지 삭제가 아니다.
    //
    // **slug 로도 확인한다.** 예전에는 id 로만 봤고(`auth.project`), 실제 경로는
    // `resolveProject(slug)` 를 거치는데 그쪽이 `archived_at IS NULL` 로 걸러
    // 보관한 프로젝트의 모든 경로가 409 였다 — 복구 엔드포인트까지 프로젝트 경로라
    // **보관이 되돌릴 수 없는 일**이 됐다(사람 보고 2026-08-27). 테스트가 지나가는
    // 길과 사람이 지나가는 길이 달랐던 것이다.
    expect(await auth.project(projectId)).toMatchObject({ slug: 'to-archive' });
    expect(await auth.resolveProject('to-archive')).toMatchObject({ id: projectId, key: 'ARC' });
    expect((await auth.resolveProject('to-archive'))?.archivedAt).not.toBeNull();

    await auth.setProjectArchived({
      actor: { userId, isAgent: false },
      projectId,
      roles: ['admin'],
      archived: false,
    });
    expect(await listed(false)).toContain('to-archive');
    expect((await auth.resolveProject('to-archive'))?.archivedAt).toBeNull();
  });

  // 2026-08-28 사람 보고 — slug 는 미리 확인하는데 **key 는 아니어서** 유니크 제약이 그대로
  // 올라와 "internal server error" 였다. 미리 확인을 제약마다 심는 대신 표면이 한 번에
  // 받는다(§1.4a) — 그래서 이 테스트가 보는 것은 "key 라고 말하는가"이다.
  it('같은 key 도 500 이 아니라 이유다 — 어느 필드인지 말한다', async () => {
    await auth.createOrg({ userId, slug: 'keyclash', name: 'KeyClash' });
    await auth.createProject({
      userId,
      orgSlug: 'keyclash',
      slug: 'first',
      key: 'DUP',
      name: '먼저',
    });

    // slug 는 다르고 key 만 같다 — 미리 확인이 없는 경로다
    const raw = await auth
      .createProject({ userId, orgSlug: 'keyclash', slug: 'second', key: 'DUP', name: '다시' })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(raw).not.toBeNull();

    // 번역은 **표면**이 한다(REST 필터 · MCP 컨트롤러). 여기서 그 변환을 직접 부르는 이유는
    // 이 테스트가 지켜야 하는 것이 파서이기 때문이다 — 단위 테스트의 pg 오류는 손으로 만든
    // 것이고, SQLSTATE·`detail` 문자열의 **실제 모양**은 진짜 드라이버만 알려준다.
    const translated = dbConstraintError(raw);
    expect(translated?.code).toBe(NERV_ERROR.PRECONDITION);
    expect(translated?.details['kind']).toBe('unique_violation');
    expect(translated?.details['fields']).toContain('key');
    expect(translated?.details['constraint']).toBe('project_org_key_uq');
    // 사람에게는 고칠 수 있는 필드만 부른다
    expect(translated?.message).toContain('key');
  });

  it('이미 쓰는 slug 는 500 이 아니라 이유다 — 보관된 것이 쥐고 있으면 그렇게 말한다', async () => {
    await auth.createOrg({ userId, slug: 'clash', name: 'Clash' });
    const made = await auth.createProject({
      userId,
      orgSlug: 'clash',
      slug: 'taken',
      key: 'TKN',
      name: '먼저',
    });

    const again = (): Promise<unknown> =>
      auth.createProject({ userId, orgSlug: 'clash', slug: 'taken', key: 'TK2', name: '다시' });

    await expect(again()).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'slug_taken' },
    });

    // 보관한 것이 자리를 쥐고 있으면 **그 사실을 말해야** 복구라는 길이 보인다 —
    // 예전에는 유니크 제약 위반이 그대로 올라와 "internal error" 였다.
    await auth.setProjectArchived({
      actor: { userId, isAgent: false },
      projectId: String(made['id']),
      roles: ['admin'],
      archived: true,
    });
    await expect(again()).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'slug_archived' },
    });
  });

  it('admin 이 아니면 보관할 수 없다', async () => {
    await expect(
      auth.setProjectArchived({
        actor: { userId, isAgent: false },
        projectId,
        roles: ['developer'],
        archived: true,
      }),
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
