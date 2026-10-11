// EP-TOK-05 — 토큰의 이름과 권한을 고친다 (2026-10-11 · 사람 결정 · REQ-API-292)
//
// 권한 하나를 더하거나 빼려고 새로 발급하면, 그 토큰을 쓰던 기계마다 설정을 다시 해야 했다. 사람이 정한
// 것은 둘이다 — **주인만** 고치고(조직 admin 은 폐기만), **넓히기와 좁히기 모두** 발급과 같은 규칙으로 받는다.
// 바뀐 권한이 **다음 호출부터** 적용되는지는 실제 검증(`verifyPat`)으로 본다.

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { ValkeyService } from '../../src/modules/event/valkey.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let auth: AuthService;
let orgId: string;
let projectId: string;
/** 프로젝트의 planner — 토큰의 주인 */
let ownerId: string;
/** 같은 조직의 조직 단위 admin — 남의 토큰을 폐기할 수는 있지만 고치지는 못한다 */
let orgAdminId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_token_update');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  const silent = {
    publish: async () => false,
    subscribe: async () => undefined,
  } as unknown as ValkeyService;
  auth = new AuthService(drizzle(pool), new EventService(drizzle(pool), silent));

  orgId = newId();
  projectId = newId();
  ownerId = newId();
  orgAdminId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state)
     VALUES ($1,'owner@example.com','주인','active'), ($2,'admin@example.com','관리','active')`,
    [ownerId, orgAdminId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role)
     VALUES ($1,$2,$3,$4,'planner'), ($5,$2,NULL,$6,'admin')`,
    [newId(), orgId, projectId, ownerId, newId(), orgAdminId],
  );
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE event');
});

async function issue(scopes: string[], name = '노트북'): Promise<{ id: string; token: string }> {
  const issued = await auth.issueToken({ projectId, userId: ownerId, name, scopes });
  return { id: issued.tokenId, token: issued.token };
}

async function updatedEvents(): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT actor_user_id, subject_id, payload FROM event WHERE type = $1`,
    [NERV_EVENT.TOKEN_UPDATED],
  );
  return rows;
}

describe('토큰 고치기 (EP-TOK-05 · REQ-API-292)', () => {
  it('주인이 이름과 권한을 고치면 다음 호출부터 그 권한이다 — 넓히기와 좁히기 모두', async () => {
    const { id, token } = await issue(['spec:read', 'task:claim']);
    expect((await auth.verifyPat(token)).scopes).toEqual(['spec:read', 'task:claim']);

    // 넓힌다 — planner 는 spec:approve 를 고를 수 있다(옵트인 · 2026-10-11)
    const widened = await auth.updateToken({
      tokenId: id,
      userId: ownerId,
      name: '  사무실 Claude Code  '.trim(),
      scopes: ['spec:read', 'task:claim', 'spec:approve'],
    });
    expect(widened).toMatchObject({ id, name: '사무실 Claude Code', changed: true });
    expect([...(widened['scopes'] as string[])].sort()).toEqual([
      'spec:approve',
      'spec:read',
      'task:claim',
    ]);
    expect([...(await auth.verifyPat(token)).scopes].sort()).toEqual([
      'spec:approve',
      'spec:read',
      'task:claim',
    ]);

    // 좁힌다 — 같은 토큰 값이 그대로 쓰이고, 뺀 권한은 바로 사라진다
    await auth.updateToken({ tokenId: id, userId: ownerId, scopes: ['spec:read'] });
    expect((await auth.verifyPat(token)).scopes).toEqual(['spec:read']);

    // 감사에 바꾸기 전과 뒤가 남는다 — 값(원문)은 남기지 않는다
    const events = await updatedEvents();
    expect(events).toHaveLength(2);
    const last = events.find(
      (e) => ((e['payload'] as Record<string, unknown>)['removed'] as string[]).length > 0,
    );
    expect(last).toMatchObject({ actor_user_id: ownerId, subject_id: id });
    expect(last?.['payload']).toMatchObject({
      before: { name: '사무실 Claude Code' },
      after: { name: '사무실 Claude Code', scopes: ['spec:read'] },
      added: [],
    });
    expect(
      [...((last?.['payload'] as Record<string, unknown>)['removed'] as string[])].sort(),
    ).toEqual(['spec:approve', 'task:claim']);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('이름만 · 권한만 고칠 수 있고, 바뀐 것이 없으면 감사를 내지 않는다', async () => {
    const { id } = await issue(['spec:read'], '처음 이름');
    const renamed = await auth.updateToken({ tokenId: id, userId: ownerId, name: '새 이름' });
    expect(renamed).toMatchObject({ name: '새 이름', scopes: ['spec:read'], changed: true });

    // 같은 값 — 순서만 다르거나 중복이어도 같은 것이다
    const same = await auth.updateToken({
      tokenId: id,
      userId: ownerId,
      name: '새 이름',
      scopes: ['spec:read', 'spec:read'],
    });
    expect(same['changed']).toBe(false);
    expect(await updatedEvents()).toHaveLength(1);
  });

  it('남의 토큰은 고치지 못한다 — 조직 admin 도 (주인만 · 사람 결정)', async () => {
    const { id, token } = await issue(['spec:read']);
    await expect(
      auth.updateToken({ tokenId: id, userId: orgAdminId, scopes: ['spec:read', 'spec:draft'] }),
    ).rejects.toMatchObject({ code: NERV_ERROR.PRECONDITION, details: { kind: 'not_found' } });
    // 조직 admin 은 여전히 폐기는 한다(REQ-API-173) — 고치기와 폐기는 다른 권한이다
    expect((await auth.verifyPat(token)).scopes).toEqual(['spec:read']);
    await auth.revokeToken(id, orgAdminId);
    expect(await updatedEvents()).toHaveLength(0);
  });

  it('발급과 같은 검사 — 사람 전용 권한은 403, 어휘 밖은 409, 어느 쪽이든 아무것도 바뀌지 않는다', async () => {
    const { id, token } = await issue(['spec:read'], '그대로');
    await expect(
      auth.updateToken({
        tokenId: id,
        userId: ownerId,
        name: '바뀌면 안 된다',
        scopes: ['spec:read', 'approval:decide'],
      }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.FORBIDDEN,
      details: { kind: 'human_only_scope', scopes: ['approval:decide'] },
    });
    await expect(
      auth.updateToken({ tokenId: id, userId: ownerId, scopes: ['spec:write'] }),
    ).rejects.toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'unknown_scope', scopes: ['spec:write'] },
    });
    const { rows } = await pool.query<{ name: string; scopes: string[] }>(
      `SELECT name, scopes FROM api_token WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ name: '그대로', scopes: ['spec:read'] });
    expect((await auth.verifyPat(token)).scopes).toEqual(['spec:read']);
  });

  it('폐기했거나 만료된 토큰은 고치지 못한다 — 되살리는 길이 아니다', async () => {
    const revoked = await issue(['spec:read']);
    await auth.revokeToken(revoked.id, ownerId);
    await expect(
      auth.updateToken({ tokenId: revoked.id, userId: ownerId, name: '되살리기' }),
    ).rejects.toMatchObject({ details: { kind: 'token_inactive', revoked: true } });

    const expired = await issue(['spec:read']);
    await pool.query(
      `UPDATE api_token SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.id],
    );
    await expect(
      auth.updateToken({
        tokenId: expired.id,
        userId: ownerId,
        scopes: ['spec:read', 'spec:draft'],
      }),
    ).rejects.toMatchObject({ details: { kind: 'token_inactive', expired: true } });
  });

  it('프로젝트를 떠난 사람은 자기 토큰도 고치지 못한다 — 발급과 같은 규칙', async () => {
    const leaver = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'leaver@example.com','떠난 사람','active')`,
      [leaver],
    );
    const membership = newId();
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
      [membership, orgId, projectId, leaver],
    );
    const issued = await auth.issueToken({
      projectId,
      userId: leaver,
      name: '떠나기 전',
      scopes: ['spec:read'],
    });
    await pool.query(`DELETE FROM membership WHERE id = $1`, [membership]);
    await expect(
      auth.updateToken({
        tokenId: issued.tokenId,
        userId: leaver,
        scopes: ['spec:read', 'spec:draft'],
      }),
    ).rejects.toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });

  it('역할 밖 권한은 저장되지만 유효 권한은 여전히 역할이 상한이다', async () => {
    const dev = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dev@example.com','개발','active')`,
      [dev],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
      [newId(), orgId, projectId, dev],
    );
    const issued = await auth.issueToken({
      projectId,
      userId: dev,
      name: 'dev',
      scopes: ['spec:read'],
    });
    // developer 에게 spec:approve 는 역할 밖이다 — 발급처럼 저장은 하고, 검증이 그 순간의 역할로 자른다
    await auth.updateToken({
      tokenId: issued.tokenId,
      userId: dev,
      scopes: ['spec:read', 'spec:approve'],
    });
    expect((await auth.verifyPat(issued.token)).scopes).toEqual(['spec:read']);
  });
});
