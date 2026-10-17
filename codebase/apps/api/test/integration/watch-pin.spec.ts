// 워치와 핀 — 서버에 남기고 워처에게 알림을 보낸다
// (2026-10-16 · 사람 결정 D5 = B · Phase 2 E17-S02 · api.md REQ-API-342 ~ 345 · database.md REQ-DB-051)
//
// 워치: 스펙 · 작업 · 영역에 사람이 건다(자동 등록은 없다). 영역 워치는 그 아래 문서와 작업까지 포함한다. 알림 카탈로그(spec-workflow
// §6.3)의 「워처」 수신자를 관여 라우팅과 같은 자리에서 산출한다 — 겹치면 한 번 · 행위자와 비멤버는 받지 않는다 · low 등급은 알림을
// 만들지 않는다. 핀: 사람마다 프로젝트를 넘는 한 목록이고 기기를 바꿔도 남는다.

import { NERV_ERROR, NERV_EVENT, newId, PIN_LIMIT } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { WatchService } from '../../src/modules/event/watch.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let watches: WatchService;
let notifications: NotificationService;
let orgId: string;
let projectId: string;
let otherProjectId: string;

/** 사람들 — 역할 큐(admin · planner)와 워처가 겹치는지를 보려고 역할을 나눴다 */
const U = {
  admin: newId(),
  planner: newId(),
  /** 문서 하나를 워치한다(그 문서의 작성자이기도 하다 — 관여자와 겹친다) */
  writer: newId(),
  /** 영역을 워치한다 */
  areaWatcher: newId(),
  /** 작업 하나를 워치한다 */
  taskWatcher: newId(),
  /** 다른 영역을 워치한다 */
  elsewhere: newId(),
  /** 일을 한 사람 — 행위자 */
  actor: newId(),
  /** 워치 행은 있지만 지금 멤버가 아니다 */
  outsider: newId(),
};
const tokens: Record<string, string> = {};

/** 문서 트리 — 영역 A ⊃ 기능 F ⊃ 설계 G, 그리고 다른 영역 B */
const S = { areaA: newId(), feature: newId(), design: newId(), areaB: newId() };
let featureVersion: string;
let designVersion: string;
let taskId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_watch_pin');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  watches = app.get(WatchService);
  // 방송 없이 파생만 — 알림 행이 진실이다(D-14)
  notifications = new NotificationService(drizzle(pool));
  const auth = app.get(AuthService);
  for (const [name, id] of Object.entries(U)) {
    if (name === 'outsider') continue;
    tokens[name] = (
      await auth.issueToken({ projectId, userId: id, name, scopes: ['spec:read'] })
    ).token;
  }
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification_batch_event');
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM watch');
  await pool.query('DELETE FROM pin');
});

async function seed(): Promise<void> {
  orgId = newId();
  projectId = newId();
  otherProjectId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [key, id] of Object.entries(U)) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${key}@example.com`, key],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion'),
            ($3,$2,'sudoku','SUD','sudoku')`,
    [projectId, orgId, otherProjectId],
  );
  for (const [id, role] of [
    [U.admin, 'admin'],
    [U.planner, 'planner'],
    [U.writer, 'designer'],
    [U.areaWatcher, 'qa'],
    [U.taskWatcher, 'developer'],
    [U.elsewhere, 'qa'],
    [U.actor, 'developer'],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      [newId(), orgId, projectId, id, role],
    );
  }
  // 핀이 프로젝트를 넘는지 보려고 writer 는 sudoku 에도 속한다
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'viewer')`,
    [newId(), orgId, otherProjectId, U.writer],
  );
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title, parent_id) VALUES
       ($1,$5,'area','SPC-AREA-A','영역 A',NULL),
       ($2,$5,'feature','SPC-FEAT','기능',$1),
       ($3,$5,'design','SPC-DSGN','설계',$2),
       ($4,$5,'area','SPC-AREA-B','영역 B',NULL)`,
    [S.areaA, S.feature, S.design, S.areaB, projectId],
  );
  await pool.query(
    `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SUD-S-PIN','스도쿠 문서')`,
    [newId(), otherProjectId],
  );
  featureVersion = newId();
  designVersion = newId();
  for (const [id, spec] of [
    [featureVersion, S.feature],
    [designVersion, S.design],
  ] as const) {
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'approved','# 본문', sha256($3::bytea), $4)`,
      [id, spec, `v-${id}`, U.writer],
    );
  }
  taskId = newId();
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, source_spec_version_id,
                       goal_md, output_format_md, tools_sources_md, boundaries_md)
     VALUES ($1,$2,'CLV-T-WATCH1','설계를 구현한다','ready',$3,'목표','PR','도구','경계')`,
    [taskId, projectId, designVersion],
  );
}

const call = (
  who: keyof typeof U,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload }),
  });

const watchOf = (who: keyof typeof U, targetType: string, target: string) =>
  watches.watch({ userId: U[who], project: 'clemvion', targetType, target });

async function emitEvent(type: string, subjectType: string, subjectId: string): Promise<void> {
  await pool.query(
    `INSERT INTO event (id, project_id, occurred_at, type, actor_user_id, is_agent, subject_type, subject_id)
     VALUES ($1,$2,now(),$3,$4,false,$5,$6)`,
    [newId(), projectId, type, U.actor, subjectType, subjectId],
  );
}

/** 이 이벤트 종류의 알림을 받은 사람 — 같은 사람이 두 줄이면 두 번 나온다 */
async function recipientsOf(type: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT n.user_id FROM notification n JOIN event e ON e.id = n.event_id
      WHERE e.type = $1 ORDER BY n.user_id`,
    [type],
  );
  return rows.map((r) => r.user_id);
}
const sorted = (ids: string[]): string[] => [...ids].sort();

describe('워치 — 걸고 · 풀고 · 본인만 (REQ-API-342)', () => {
  it('스펙 · 작업 · 영역에 걸고 목록에 보인다 — 다시 걸면 새 행이 없고, 풀면 사라진다', async () => {
    const put = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'spec',
      target: 'spc-feat',
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      created: true,
      watch: {
        target_type: 'spec',
        target_id: S.feature,
        key: 'SPC-FEAT',
        project_slug: 'clemvion',
      },
    });
    const again = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'spec',
      target: S.feature,
    });
    expect(again.json()).toMatchObject({ created: false, watch: { id: put.json().watch.id } });
    await watchOf('writer', 'task', 'CLV-T-WATCH1');
    await watchOf('writer', 'area', 'SPC-AREA-A');

    const list = await call('writer', 'GET', '/me/watches?project=clemvion');
    const items = list.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.map((i) => [i['target_type'], i['key']])).toEqual([
      ['area', 'SPC-AREA-A'],
      ['task', 'CLV-T-WATCH1'],
      ['spec', 'SPC-FEAT'],
    ]);
    expect(items[1]).toMatchObject({ title: '설계를 구현한다', type: 'ready' });

    const del = await call('writer', 'DELETE', `/me/watches/${String(put.json().watch.id)}`);
    expect(del.statusCode).toBe(200);
    expect((await call('writer', 'GET', '/me/watches')).json().items).toHaveLength(2);
  });

  it('영역 워치는 영역 문서에만 · 모르는 종류는 400 · 없는 대상 · 내가 속하지 않은 프로젝트는 409', async () => {
    const notArea = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'area',
      target: 'SPC-FEAT',
    });
    expect(notArea.statusCode).toBe(409);
    expect(notArea.json()).toMatchObject({ details: { kind: 'not_area', spec_type: 'feature' } });
    const unknown = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'folder',
      target: 'SPC-FEAT',
    });
    expect(unknown.statusCode).toBe(400);
    const missing = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'spec',
      target: 'SPC-NONE',
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ details: { kind: 'not_found' } });
    // 다른 프로젝트의 문서는 이 프로젝트에 없다
    const crossed = await call('writer', 'PUT', '/me/watches', {
      project: 'clemvion',
      target_type: 'spec',
      target: 'SUD-S-PIN',
    });
    expect(crossed.statusCode).toBe(409);
    const notMine = await call('actor', 'PUT', '/me/watches', {
      project: 'sudoku',
      target_type: 'spec',
      target: 'SUD-S-PIN',
    });
    expect(notMine.statusCode).toBe(409);
    expect((await pool.query('SELECT count(*)::int AS n FROM watch')).rows[0].n).toBe(0);
  });

  it('본인의 것만 — 남의 워치는 보이지 않고 풀 수 없다', async () => {
    const mine = await watchOf('writer', 'spec', 'SPC-FEAT');
    expect((await call('actor', 'GET', '/me/watches')).json().items).toEqual([]);
    const theirs = await call('actor', 'DELETE', `/me/watches/${String(mine.watch['id'])}`);
    expect(theirs.statusCode).toBe(409);
    expect(theirs.json()).toMatchObject({ details: { kind: 'not_found' } });
    expect((await pool.query('SELECT count(*)::int AS n FROM watch')).rows[0].n).toBe(1);
  });
});

describe('워처 알림 — 카탈로그의 「워처」 수신자 (REQ-API-343)', () => {
  it('spec.approved — 그 문서와 조상 영역의 워처가 받는다 · 다른 영역의 워처는 받지 않는다', async () => {
    await watchOf('taskWatcher', 'spec', 'SPC-FEAT');
    await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await watchOf('elsewhere', 'area', 'SPC-AREA-B');
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', featureVersion);
    await notifications.route();
    const got = await recipientsOf(NERV_EVENT.SPEC_APPROVED);
    expect(got).toEqual(sorted([U.admin, U.planner, U.writer, U.taskWatcher, U.areaWatcher]));
    expect(got).not.toContain(U.elsewhere);
  });

  it('영역 워치는 손자 문서까지 — 설계 문서의 거절도 영역 A 워처가 받는다', async () => {
    await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await emitEvent(NERV_EVENT.SPEC_REJECTED, 'spec_version', designVersion);
    await notifications.route();
    expect(await recipientsOf(NERV_EVENT.SPEC_REJECTED)).toContain(U.areaWatcher);
  });

  it('관여자와 겹치면 한 번 — 작성자가 그 문서를 워치해도 알림은 한 줄이다', async () => {
    await watchOf('writer', 'spec', 'SPC-FEAT');
    await watchOf('writer', 'area', 'SPC-AREA-A');
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', featureVersion);
    await notifications.route();
    expect(
      (await recipientsOf(NERV_EVENT.SPEC_APPROVED)).filter((u) => u === U.writer),
    ).toHaveLength(1);
  });

  it('spec.comment_added — 본문 코멘트(대상이 문서)도 그 문서의 워처에게 간다', async () => {
    await watchOf('taskWatcher', 'spec', 'SPC-DSGN');
    await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await emitEvent(NERV_EVENT.SPEC_COMMENT_ADDED, 'spec', S.design);
    await notifications.route();
    const got = await recipientsOf(NERV_EVENT.SPEC_COMMENT_ADDED);
    expect(got).toContain(U.taskWatcher);
    expect(got).toContain(U.areaWatcher);
  });

  it('task.ready — 그 작업의 워처와 기준 문서의 조상 영역 워처가 받는다 · 역할 큐는 그대로', async () => {
    await watchOf('taskWatcher', 'task', 'CLV-T-WATCH1');
    await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await watchOf('elsewhere', 'area', 'SPC-AREA-B');
    // 문서 워치는 그 문서의 작업까지 넓히지 않는다
    await watchOf('writer', 'spec', 'SPC-DSGN');
    await emitEvent(NERV_EVENT.TASK_READY, 'task', taskId);
    await notifications.route();
    expect(await recipientsOf(NERV_EVENT.TASK_READY)).toEqual(
      sorted([U.admin, U.planner, U.taskWatcher, U.areaWatcher]),
    );
  });

  it('행위자 · 지금 멤버가 아닌 사람은 받지 않는다 — 워치 행이 남아 있어도', async () => {
    await watchOf('actor', 'spec', 'SPC-FEAT');
    await pool.query(
      `INSERT INTO watch (id, user_id, project_id, target_type, target_id) VALUES ($1,$2,$3,'spec',$4)`,
      [newId(), U.outsider, projectId, S.feature],
    );
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', featureVersion);
    await notifications.route();
    const got = await recipientsOf(NERV_EVENT.SPEC_APPROVED);
    expect(got).not.toContain(U.actor);
    expect(got).not.toContain(U.outsider);
  });

  it('low 등급(task.claimed · task.done · 세션 시작 · 끝)은 워처에게도 알림을 만들지 않는다', async () => {
    await watchOf('taskWatcher', 'task', 'CLV-T-WATCH1');
    await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await emitEvent(NERV_EVENT.TASK_CLAIMED, 'task', taskId);
    await emitEvent(NERV_EVENT.TASK_DONE, 'task', taskId);
    await notifications.route();
    expect((await pool.query('SELECT count(*)::int AS n FROM notification')).rows[0].n).toBe(0);
  });

  it('워치를 풀면 다음 이벤트부터 받지 않는다', async () => {
    const w = await watchOf('areaWatcher', 'area', 'SPC-AREA-A');
    await watches.unwatch({ userId: U.areaWatcher, watchId: String(w.watch['id']) });
    await emitEvent(NERV_EVENT.SPEC_APPROVED, 'spec_version', featureVersion);
    await notifications.route();
    expect(await recipientsOf(NERV_EVENT.SPEC_APPROVED)).not.toContain(U.areaWatcher);
  });
});

describe('핀 — 서버에 남고 프로젝트를 넘는다 (REQ-API-344 · 345)', () => {
  const pinOf = (who: keyof typeof U, project: string, targetType: string, target: string) =>
    call(who, 'PUT', '/me/pins', { project, target_type: targetType, target });

  it('새 핀이 맨 위다 — 같은 대상을 다시 고정하면 자리를 바꾸지 않는다', async () => {
    expect((await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT')).json()).toMatchObject({
      created: true,
      pin: { key: 'SPC-FEAT' },
    });
    await pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1');
    await pinOf('writer', 'sudoku', 'spec', 'SUD-S-PIN');
    expect((await pinOf('writer', 'clemvion', 'spec', 'spc-feat')).json()).toMatchObject({
      created: false,
    });
    const list = (await call('writer', 'GET', '/me/pins')).json<{
      items: Record<string, unknown>[];
    }>();
    // 프로젝트를 넘는 한 목록이다 — 스위처 줄이 쓰는 값(키 · 제목 · 종류 · 상태 · 프로젝트)을 함께 준다
    expect(list.items.map((i) => [i['project_slug'], i['key']])).toEqual([
      ['sudoku', 'SUD-S-PIN'],
      ['clemvion', 'CLV-T-WATCH1'],
      ['clemvion', 'SPC-FEAT'],
    ]);
    expect(list.items[2]).toMatchObject({
      target_type: 'spec',
      title: '기능',
      type: 'feature',
      doc_status: 'approved',
      org_slug: 'nerv',
    });
  });

  it('지금 멤버가 아닌 프로젝트의 핀은 보이지 않는다 — 다시 멤버가 되면 돌아온다', async () => {
    await pinOf('writer', 'sudoku', 'spec', 'SUD-S-PIN');
    await pool.query(`DELETE FROM membership WHERE user_id = $1 AND project_id = $2`, [
      U.writer,
      otherProjectId,
    ]);
    expect((await call('writer', 'GET', '/me/pins')).json().items).toEqual([]);
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'viewer')`,
      [newId(), orgId, otherProjectId, U.writer],
    );
    expect((await call('writer', 'GET', '/me/pins')).json().items).toHaveLength(1);
  });

  it('본인의 것만 — 남의 핀은 보이지 않고 풀 수 없다', async () => {
    const mine = (await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT')).json();
    expect((await call('actor', 'GET', '/me/pins')).json().items).toEqual([]);
    const theirs = await call('actor', 'DELETE', `/me/pins/${String(mine.pin.id)}`);
    expect(theirs.statusCode).toBe(409);
    expect((await call('writer', 'DELETE', `/me/pins/${String(mine.pin.id)}`)).statusCode).toBe(
      200,
    );
    expect((await call('writer', 'GET', '/me/pins')).json().items).toEqual([]);
  });

  it('브라우저의 핀을 옮기면 받은 순서대로 지금 핀 아래에 두고, 있는 것 · 찾지 못한 것은 건너뛴다', async () => {
    await pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1');
    const res = await call('writer', 'POST', '/me/pins/import', {
      items: [
        { project: 'clemvion', target_type: 'spec', target: 'SPC-FEAT' },
        { project: 'clemvion', target_type: 'task', target: 'CLV-T-WATCH1' },
        { project: 'clemvion', target_type: 'spec', target: 'SPC-GONE' },
        { project: 'sudoku', target_type: 'spec', target: 'SUD-S-PIN' },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      imported: 2,
      skipped: [
        { target: 'CLV-T-WATCH1', reason: 'exists' },
        { target: 'SPC-GONE', reason: 'not_found' },
      ],
    });
    const keys = (await call('writer', 'GET', '/me/pins'))
      .json<{ items: Record<string, unknown>[] }>()
      .items.map((i) => i['key']);
    expect(keys).toEqual(['CLV-T-WATCH1', 'SPC-FEAT', 'SUD-S-PIN']);
  });

  it(`한 사람에 ${PIN_LIMIT}개까지 — 넘치면 409 이고 옮기기는 넘친 것만 건너뛴다`, async () => {
    const specIds: string[] = [];
    for (let i = 0; i < PIN_LIMIT; i += 1) specIds.push(newId());
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title)
       SELECT id, $2, 'feature', 'SPC-LIM-' || n, '한도 ' || n
         FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, n)`,
      [specIds, projectId],
    );
    await pool.query(
      `INSERT INTO pin (id, user_id, project_id, target_type, target_id, position)
       SELECT gen_random_uuid(), $1, $2, 'spec', id, n
         FROM unnest($3::uuid[]) WITH ORDINALITY AS u(id, n)`,
      [U.writer, projectId, specIds],
    );
    const over = await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT');
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'pin_limit' },
    });
    const moved = await call('writer', 'POST', '/me/pins/import', {
      items: [{ project: 'clemvion', target_type: 'spec', target: 'SPC-FEAT' }],
    });
    expect(moved.json()).toEqual({
      imported: 0,
      skipped: [{ target: 'SPC-FEAT', reason: 'pin_limit' }],
    });
  });
});

describe('핀 순서 바꾸기 — 보낸 핀들의 자리만 서로 바꾼다 (2026-10-17 · REQ-API-358)', () => {
  const pinOf = (who: keyof typeof U, project: string, targetType: string, target: string) =>
    call(who, 'PUT', '/me/pins', { project, target_type: targetType, target });
  const listOf = async (who: keyof typeof U): Promise<Record<string, unknown>[]> =>
    (await call(who, 'GET', '/me/pins')).json<{ items: Record<string, unknown>[] }>().items;
  const keysOf = async (who: keyof typeof U): Promise<unknown[]> =>
    (await listOf(who)).map((i) => i['key']);

  it('바라는 순서로 다시 놓고 바뀐 목록을 준다 — 다음 읽기도 그 순서다', async () => {
    await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT');
    await pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1');
    await pinOf('writer', 'clemvion', 'spec', 'SPC-AREA-A');
    const before = await listOf('writer');
    expect(before.map((i) => i['key'])).toEqual(['SPC-AREA-A', 'CLV-T-WATCH1', 'SPC-FEAT']);
    const ids = before.map((i) => String(i['id']));
    const res = await call('writer', 'PUT', '/me/pins/order', {
      ids: [ids[2], ids[0], ids[1]],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: Record<string, unknown>[] }>().items.map((i) => i['key'])).toEqual([
      'SPC-FEAT',
      'SPC-AREA-A',
      'CLV-T-WATCH1',
    ]);
    expect(await keysOf('writer')).toEqual(['SPC-FEAT', 'SPC-AREA-A', 'CLV-T-WATCH1']);
    // 그다음 새로 고정한 것도 맨 위다 — 자리를 다시 나눠도 「새 핀이 위」는 그대로다
    await pinOf('writer', 'clemvion', 'spec', 'SPC-DSGN');
    expect((await keysOf('writer'))[0]).toBe('SPC-DSGN');
  });

  it('보내지 않은 핀은 자리를 지킨다 — 보이지 않는 프로젝트의 핀이 끝으로 밀리지 않는다', async () => {
    await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT');
    await pinOf('writer', 'sudoku', 'spec', 'SUD-S-PIN');
    await pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1');
    // 위에서부터 CLV-T-WATCH1 · SUD-S-PIN · SPC-FEAT — 화면이 sudoku 를 보지 못한 채 clemvion 둘만 바꾼다
    const all = await listOf('writer');
    const id = (key: string): string => String(all.find((i) => i['key'] === key)!['id']);
    await call('writer', 'PUT', '/me/pins/order', { ids: [id('SPC-FEAT'), id('CLV-T-WATCH1')] });
    expect(await keysOf('writer')).toEqual(['SPC-FEAT', 'SUD-S-PIN', 'CLV-T-WATCH1']);
  });

  it('남의 핀 · 없는 핀이 섞이면 아무것도 바꾸지 않고 409 · 같은 핀을 두 번 주면 400', async () => {
    await pinOf('writer', 'clemvion', 'spec', 'SPC-FEAT');
    await pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1');
    const mine = (await listOf('writer')).map((i) => String(i['id']));
    const theirs = (await pinOf('actor', 'clemvion', 'spec', 'SPC-FEAT')).json<{
      pin: { id: string };
    }>().pin.id;
    const ghost = newId();
    const mixed = await call('writer', 'PUT', '/me/pins/order', {
      ids: [mine[1], theirs, ghost, mine[0]],
    });
    expect(mixed.statusCode).toBe(409);
    expect(mixed.json()).toMatchObject({
      code: NERV_ERROR.PRECONDITION,
      details: { kind: 'not_found', pins: [theirs, ghost] },
    });
    expect(await keysOf('writer')).toEqual(['CLV-T-WATCH1', 'SPC-FEAT']);
    const twice = await call('writer', 'PUT', '/me/pins/order', { ids: [mine[0], mine[0]] });
    expect(twice.statusCode).toBe(400);
    const empty = await call('writer', 'PUT', '/me/pins/order', { ids: [] });
    expect(empty.statusCode).toBe(400);
  });

  it('동시에 옮기고 고정해도 자리가 섞이지 않는다 — 사람별 잠금 하나', async () => {
    for (const key of ['SPC-FEAT', 'SPC-AREA-A', 'SPC-DSGN']) {
      await pinOf('writer', 'clemvion', 'spec', key);
    }
    const ids = (await listOf('writer')).map((i) => String(i['id']));
    const [a, b] = await Promise.all([
      call('writer', 'PUT', '/me/pins/order', { ids: [...ids].reverse() }),
      pinOf('writer', 'clemvion', 'task', 'CLV-T-WATCH1'),
    ]);
    expect(a.statusCode).toBe(200);
    expect([200, 201]).toContain(b.statusCode);
    const { rows } = await pool.query<{ n: number; d: number }>(
      `SELECT count(*)::int AS n, count(DISTINCT position)::int AS d FROM pin WHERE user_id = $1`,
      [U.writer],
    );
    // 넷 다 남고 자리가 겹치지 않는다
    expect(rows[0]).toEqual({ n: 4, d: 4 });
  });
});
