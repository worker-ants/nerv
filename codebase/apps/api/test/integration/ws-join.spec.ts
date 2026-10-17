// E05-S02 — 브라우저가 쓰는 WS 경로 그대로: 세션 쿠키로 붙고, 프로젝트 룸에 들어가 그 룸의 이벤트를 받는다
//
// **실제 소켓으로 본다**(2026-10-17). 다른 실시간 시험은 SSE 로 팬아웃을 보고 WS 의 join 은 단위 시험만 있었다.
// 그 사이에 전역 AuthGuard 가 게이트웨이 메시지에도 걸려 HTTP 헤더를 읽다 TypeError 를 던졌고, 모든 프로젝트 룸
// 참가가 `exception`(Internal server error)으로 끝났다. 소켓은 붙어 있어 화면의 폴링 폴백도 돌지 않았고, 프로젝트
// 화면은 다시 열 때만 바뀌었다. 가드를 고치자 연결 직후의 `join` 이 핸드셰이크 인증보다 먼저 도착해 UNAUTHENTICATED
// 로 거절됐다 — 화면도 연결되자마자 룸을 다시 잡는다(lib/ws.ts). 부하 시험(E21-S04)이 보드 반영을 재려다 둘을 찾았다.
// 소켓 인증은 게이트웨이의 핸드셰이크가, 룸 참가는 멤버십 판정이 맡는다(api.md §3.1 · §3.2 · REQ-API-353).

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { DEFAULT_ORIGIN } from '../../src/common/origins.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let events: EventService;
let url: string;
let cookie: string;
let memberProject: string;
let otherProject: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  db = await createScratchDb('nerv_wsjoin');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  events = app.get(EventService);

  const signUp = await fetch(`${url}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: DEFAULT_ORIGIN },
    body: JSON.stringify({ email: 'ws@example.com', password: 'nerv-ws-password', name: '소켓' }),
  });
  expect(signUp.status).toBe(200);
  cookie = signUp.headers
    .getSetCookie()
    .map((line) => line.split(';')[0] ?? '')
    .join('; ');
  expect(cookie).toContain('better-auth.session_token=');
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE email = 'ws@example.com'`,
  );
  const userId = rows[0]?.id ?? '';

  const orgId = newId();
  memberProject = newId();
  otherProject = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'mine','MIN','내 것'), ($3,$2,'other','OTH','남의 것')`,
    [memberProject, orgId, otherProject],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, memberProject, userId],
  );
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await app.close();
  await pool.end();
  await db.drop();
});

/** 화면의 소켓과 같은 설정 — `lib/ws.ts` 의 경로 · 전송 · 쿠키 */
async function connect(): Promise<Socket> {
  const socket = io(url, {
    path: '/ws',
    transports: ['websocket'],
    extraHeaders: { cookie, origin: DEFAULT_ORIGIN },
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((done, fail) => {
    socket.once('connect', () => done());
    socket.once('connect_error', fail);
  });
  return socket;
}

/** ack 를 기다린다 — 핸들러가 던지면 ack 대신 `exception` 이 오므로 그것도 답으로 받는다(기다리다 시간 초과로 끝나지 않게) */
function join(socket: Socket, room: string): Promise<unknown> {
  return new Promise((done) => {
    const onException = (body: unknown): void => done({ exception: body });
    socket.once('exception', onException);
    socket.emit('join', { room }, (ack: unknown) => {
      socket.off('exception', onException);
      done(ack);
    });
  });
}

describe('WS 프로젝트 룸 참가', () => {
  it('멤버인 프로젝트 룸에 들어가고 그 룸의 이벤트를 받는다', async () => {
    const socket = await connect();
    const ack = await join(socket, `project:${memberProject}`);
    expect(ack).toEqual({ ok: true, room: `project:${memberProject}` });

    const taskId = newId();
    const arrived = new Promise<{ type: string; subject_id: string }>((done) =>
      socket.on(NERV_EVENT.TASK_CLAIMED, done),
    );
    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId: memberProject,
        subjectType: 'task',
        subjectId: taskId,
      }),
    );
    const envelope = await arrived;
    expect(envelope.subject_id).toBe(taskId);
  });

  it('멤버가 아닌 프로젝트 룸은 거절 ack 로 답한다 — 예외가 아니다', async () => {
    const socket = await connect();
    const ack = await join(socket, `project:${otherProject}`);
    expect(ack).toEqual({ ok: false, code: NERV_ERROR.FORBIDDEN });
  });
});
