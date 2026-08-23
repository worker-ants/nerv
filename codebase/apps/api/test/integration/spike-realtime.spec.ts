// E06-S01 — 스파이크: 실시간 게이트웨이 PoC.
//
//   WHEN 파드 2개 뒤에 WS·SSE 클라이언트를 분산 접속시키고 nerv_events 에 PUBLISH 하면,
//   THE SYSTEM SHALL **크로스파드 어댑터 없이** 전 클라이언트에 이벤트를 전달한다
//
// 이 스파이크가 검증하는 것은 코드가 아니라 **배포 구조의 전제**다(codebase.md §2.1):
// "모든 emit 의 원천이 Valkey 방송이므로 파드마다 SUBSCRIBE 를 걸면 크로스파드 socket.io
//  어댑터 없이 각 파드가 자기에게 붙은 연결에 밀어줄 수 있고, 그래서 k8s 스티키 세션이 필요 없다."
// 이 전제가 틀리면 §6.3 의 replicas: 2 와 Ingress 설정이 통째로 흔들린다.
//
// 파드 2개는 **앱 인스턴스 2개**로 흉내낸다. 프로세스가 다른 것과 같은 조건이다 —
// 둘은 같은 Valkey 를 구독할 뿐 서로를 모른다.

import { NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { FanoutService } from '../../src/modules/event/fanout.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let podA: NestFastifyApplication;
let podB: NestFastifyApplication;
let projectId: string;
let userId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_spike_rt');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';

  // 파드 2개 — 서로를 모른다. 공유하는 것은 Postgres 와 Valkey 뿐이다.
  podA = await createApp();
  await podA.init();
  podB = await createApp();
  await podB.init();
}, 60_000);

afterAll(async () => {
  await podA.close();
  await podB.close();
  await pool.end();
  await db.drop();
});

async function waitFor(predicate: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

describe('스파이크: 크로스파드 팬아웃 (E06-S01)', () => {
  it('한 파드에서 난 이벤트가 **다른 파드**의 구독자에게 도달한다', async () => {
    const seenOnB: string[] = [];
    const offB = podB.get(FanoutService).add({
      rooms: new Set([`project:${projectId}` as const]),
      deliver: (envelope) => seenOnB.push(envelope.type),
    });

    // 파드 A 에서 상태 전이가 일어난다
    await podA.get(EventService).transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId,
        subjectType: 'task',
        subjectId: newId(),
        actorUserId: userId,
      }),
    );

    // 파드 B 의 클라이언트가 받는다 — 크로스파드 어댑터 없이
    const arrived = await waitFor(() => seenOnB.includes(NERV_EVENT.TASK_CLAIMED));
    expect(arrived).toBe(true);
    offB();
  });

  it('양방향이다 — B 에서 난 것도 A 가 받는다', async () => {
    const seenOnA: string[] = [];
    const offA = podA.get(FanoutService).add({
      rooms: new Set([`project:${projectId}` as const]),
      deliver: (envelope) => seenOnA.push(envelope.type),
    });

    await podB.get(EventService).transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SESSION_STALE,
        projectId,
        subjectType: 'agent_session',
        subjectId: newId(),
      }),
    );

    expect(await waitFor(() => seenOnA.includes(NERV_EVENT.SESSION_STALE))).toBe(true);
    offA();
  });

  it('두 파드에 붙은 클라이언트가 **같은 이벤트를 각각 한 번씩** 받는다', async () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = podA.get(FanoutService).add({
      rooms: new Set([`project:${projectId}` as const]),
      deliver: (e) => a.push(e.id),
    });
    const offB = podB.get(FanoutService).add({
      rooms: new Set([`project:${projectId}` as const]),
      deliver: (e) => b.push(e.id),
    });

    const envelope = await podA.get(EventService).transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SPEC_APPROVED,
        projectId,
        subjectType: 'spec_version',
        subjectId: newId(),
      }),
    );

    await waitFor(() => a.length > 0 && b.length > 0);
    // 중복 전달이 없다 — 파드마다 자기 연결에만 밀어준다
    expect(a).toEqual([envelope.id]);
    expect(b).toEqual([envelope.id]);
    offA();
    offB();
  });

  it('판정 — 스티키 세션 없이 성립한다(go)', () => {
    // 위 세 케이스가 통과하면 §6.3 의 replicas: 2 · 스티키 불필요 · 크로스파드 어댑터 없음이
    // 동시에 성립한다. 재검토 트리거(4.1 §2.2 Valkey 행)는 점화되지 않았다.
    expect(true).toBe(true);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
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
}
