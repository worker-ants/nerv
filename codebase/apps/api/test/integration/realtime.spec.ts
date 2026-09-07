// E05-S02 — WS·SSE 게이트웨이 + Valkey 구독 팬아웃.
//
//   WHEN 이벤트가 nerv_events 에 PUBLISH 되면, THE SYSTEM SHALL 각 파드가 자기 소켓의
//   해당 룸과 SSE 스트림으로 emit 하고 상태 전이→보드 반영 지연 p95 ≤ 5초를 유지한다 (NFR-02)
//
// 팬아웃 경로 전체를 실물로 태운다: 도메인 트랜잭션 → event 행 → 커밋 후 Valkey PUBLISH →
// 파드 구독 → 룸 계산 → SSE 스트림. 중간을 mock 으로 끊으면 "커밋 후에만 나간다"도
// "룸 밖으로는 안 나간다"도 검증되지 않는다.

import { request as httpRequest } from 'node:http';
import { WS_ERROR_EVENT, NERV_ERROR, NERV_EVENT, newId, sessionState } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { EventService } from '../../src/modules/event/event.service.js';
import { FanoutService } from '../../src/modules/event/fanout.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { TaskService } from '../../src/modules/task/task.service.js';
import { WsGateway } from '../../src/modules/event/ws.gateway.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let events: EventService;
let fanout: FanoutService;
let token: string;
let otherToken: string;
let projectId: string;
let otherProjectId: string;
/** 두 조직이 같은 slug('shared')를 쓴다 — REQ-API-152 */
let sharedHereId: string;
let sharedTwinId: string;
let sharedHereToken: string;
let sharedTwinToken: string;
let userId: string;
/** SSE 는 실제 소켓을 요구한다(@Sse() 가 setKeepAlive 를 부른다) — inject 로는 태울 수 없다 */
let port: number;

beforeAll(async () => {
  db = await createScratchDb('nerv_rt');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.getHttpServer().address() as { port: number }).port;

  events = app.get(EventService);
  fanout = app.get(FanoutService);

  const auth = app.get(AuthService);
  token = (await auth.issueToken({ projectId, userId, name: 'rt', scopes: ['spec:read'] })).token;
  otherToken = (
    await auth.issueToken({ projectId: otherProjectId, userId, name: 'rt2', scopes: ['spec:read'] })
  ).token;
  sharedHereToken = (
    await auth.issueToken({ projectId: sharedHereId, userId, name: 'rt3', scopes: ['spec:read'] })
  ).token;
  sharedTwinToken = (
    await auth.issueToken({ projectId: sharedTwinId, userId, name: 'rt4', scopes: ['spec:read'] })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

/** 팬아웃 도착까지 기다린다 — 방송은 비동기다. */
async function waitFor(predicate: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

/** 팬아웃 구독자 한 명을 흉내낸다 — SSE·WS 가 쓰는 것과 같은 등록 경로다. */
function subscribe(rooms: string[]): { received: { type: string }[]; off: () => void } {
  const received: { type: string }[] = [];
  const off = fanout.add({
    rooms: new Set(rooms as `project:${string}`[]),
    deliver: (envelope) => received.push(envelope),
  });
  return { received, off };
}

describe('Valkey 구독 → 파드 팬아웃', () => {
  it('상태 전이가 커밋되면 해당 프로젝트 룸으로 흘러온다', async () => {
    const sub = subscribe([`project:${projectId}`]);
    const started = Date.now();

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.TASK_CLAIMED,
        projectId,
        subjectType: 'task',
        subjectId: newId(),
      }),
    );

    const arrived = await waitFor(() => sub.received.length > 0);
    const latency = Date.now() - started;

    expect(arrived).toBe(true);
    expect(sub.received[0]?.type).toBe(NERV_EVENT.TASK_CLAIMED);
    // NFR-02 — 보드 반영 p95 ≤ 5초. 로컬 팬아웃은 그보다 두 자릿수 빠르다
    expect(latency).toBeLessThan(5000);
    sub.off();
  });

  it('다른 프로젝트 룸으로는 새지 않는다', async () => {
    const mine = subscribe([`project:${projectId}`]);
    const theirs = subscribe([`project:${otherProjectId}`]);

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SPEC_APPROVED,
        projectId,
        subjectType: 'spec_version',
        subjectId: newId(),
      }),
    );

    await waitFor(() => mine.received.length > 0);
    await new Promise((r) => setTimeout(r, 200));

    expect(mine.received.length).toBe(1);
    expect(theirs.received.length).toBe(0);
    mine.off();
    theirs.off();
  });

  it('해제한 구독자에게는 더 보내지 않는다', async () => {
    const sub = subscribe([`project:${projectId}`]);
    sub.off();

    await events.transact(async (_tx, emit) =>
      emit({ type: NERV_EVENT.TASK_READY, projectId, subjectType: 'task', subjectId: newId() }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(sub.received.length).toBe(0);
  });

  it('한 구독자가 던져도 다른 구독자는 받는다', async () => {
    const bad = fanout.add({
      rooms: new Set([`project:${projectId}` as const]),
      deliver: () => {
        throw new Error('나쁜 연결');
      },
    });
    const good = subscribe([`project:${projectId}`]);

    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SESSION_STARTED,
        projectId,
        subjectType: 'agent_session',
        subjectId: newId(),
      }),
    );

    expect(await waitFor(() => good.received.length > 0)).toBe(true);
    bad();
    good.off();
  });
});

describe('SSE 계약 (EP-SSE-01·02 · api.md §3.5)', () => {
  /**
   * SSE 는 node:http 로 직접 연다 — agent: false 로 **커넥션 풀을 쓰지 않는다**.
   *
   * 이유 둘. ① app.inject() 의 가짜 소켓은 @Sse() 가 부르는 setKeepAlive 를 갖지 않아
   * 거부 경로까지 500 이 된다. ② fetch(undici)는 커넥션을 풀링하는데, 앞 테스트가 abort 한
   * 스트림이 그 커넥션에 남아 다음 요청이 **직전 응답의 헤더를 다시 읽는다**(실측: 403 이어야
   * 할 요청이 200 text/event-stream 을 받았다). 요청마다 새 소켓이면 둘 다 사라진다.
   */
  interface OpenResponse {
    status: number;
    contentType: string;
    /** 조건을 만족할 때까지(또는 시한까지) 누적 본문을 기다린다 */
    until: (predicate: (text: string) => boolean, ms?: number) => Promise<string>;
    /** 응답이 끝날 때까지 기다린다 — 스트림이 아닌 응답용 */
    ended: Promise<string>;
    close: () => void;
  }

  function request(path: string, headers: Record<string, string> = {}): Promise<OpenResponse> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path, method: 'GET', headers, agent: false },
        (res) => {
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
          });
          const ended = new Promise<string>((done) => {
            res.on('end', () => done(buffer));
            res.on('close', () => done(buffer));
          });
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            until: async (predicate, ms = 5000) => {
              const deadline = Date.now() + ms;
              while (Date.now() < deadline && !predicate(buffer)) {
                await new Promise((r) => setTimeout(r, 20));
              }
              return buffer;
            },
            ended,
            close: () => res.destroy(),
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  async function body(
    path: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await request(path, headers);
    const text = await res.ended;
    res.close();
    return { status: res.status, json: JSON.parse(text || '{}') as Record<string, unknown> };
  }

  it('타 프로젝트 PAT 는 스트림을 열지 않는다 — 403 이지 빈 스트림이 아니다', async () => {
    // 전제 확인 — 이 토큰이 정말 다른 프로젝트에 묶여 있어야 이 테스트가 의미를 갖는다
    const principal = await app.get(AuthService).verifyPat(otherToken);
    expect(principal.projectId).toBe(otherProjectId);
    expect(otherProjectId).not.toBe(projectId);

    const res = await body('/sse/projects/clemvion', { authorization: `Bearer ${otherToken}` });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: NERV_ERROR.FORBIDDEN });
  });

  it('자격증명이 없으면 401', async () => {
    expect((await body('/sse/projects/clemvion')).status).toBe(401);
  });

  it('없는 프로젝트는 409', async () => {
    expect((await body('/sse/projects/nope', { authorization: `Bearer ${token}` })).status).toBe(
      409,
    );
  });

  /**
   * **두 스트림이 동시에 열려야 한다**(REQ-API-152). 해소가 slug 의 첫 행을 고르던 동안
   * 같은 slug 를 쓰는 두 조직 중 한쪽만 열렸다 — 어느 쪽이 열리는지는 행 순서가 정했고,
   * 못 연 쪽은 403 을 봤다. 그래서 둘을 **한 검사 안에서** 본다: 하나만 여는 구현으로는
   * 행 순서가 어떻든 이 검사를 통과할 수 없다.
   */
  it('같은 slug 가 두 조직에 있어도 각자의 스트림이 열린다 (REQ-API-152)', async () => {
    // PAT 은 slug 이 아니라 id 를 들고 있다 — 바인딩이 좁힌다
    const here = await request('/sse/projects/shared', {
      authorization: `Bearer ${sharedHereToken}`,
    });
    expect(here.status).toBe(200);
    here.close();

    // EventSource 는 헤더를 싣지 못한다 — 한정자는 질의로도 온다
    const twin = await request('/sse/projects/shared?org=aaa', {
      authorization: `Bearer ${sharedTwinToken}`,
    });
    expect(twin.status).toBe(200);
    expect(twin.contentType).toContain('text/event-stream');
    twin.close();
  });

  it('스트림이 열리고 방송이 끝까지 흘러온다 — 팬아웃 경로 전체', async () => {
    const res = await request('/sse/projects/clemvion', { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/event-stream');

    await new Promise((r) => setTimeout(r, 200));
    await events.transact(async (_tx, emit) =>
      emit({
        type: NERV_EVENT.SPEC_APPROVED,
        projectId,
        subjectType: 'spec_version',
        subjectId: newId(),
      }),
    );

    const text = await res.until((t) => t.includes(NERV_EVENT.SPEC_APPROVED));
    res.close();

    // 메시지마다 event: = Event type, id: = event id, data: = 봉투(§3.3·§3.5)
    expect(text).toContain('event: spec.approved');
    expect(text).toContain('data: ');
    expect(text).not.toContain('body_md'); // 본문은 싣지 않는다

    // **봉투가 무엇이 바뀌었는지 말해야 한다**(2026-08-29 실측). 예전에는 방송이
    // {id,type,project_id} 세 필드로 잘려 나가서, 받는 쪽은 subject 를 몰랐고 화면은
    // `['spec', undefined]` 를 무효화하고 있었다 — 새로고침해야 보이는 이유가 이것이었다.
    const line = text.split('\n').find((l) => l.startsWith('data: ')) ?? '';
    const wire = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(
      [
        'actor_user_id',
        'id',
        'is_agent',
        'occurred_at',
        'project_id',
        'subject_id',
        'subject_key',
        'subject_type',
        'type',
      ].sort(),
    );
    expect(typeof wire['subject_id']).toBe('string');
  });

  it('/sse/me 는 본인 스트림을 연다', async () => {
    const res = await request('/sse/me', { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/event-stream');
    res.close();
  });

  it('Last-Event-ID 를 무시한다 — replay 는 없다(D-14)', async () => {
    const res = await request('/sse/projects/clemvion', {
      authorization: `Bearer ${token}`,
      'last-event-id': 'whatever',
    });
    // 헤더가 있어도 그냥 새 스트림을 연다 — 재개하지 않는다
    expect(res.status).toBe(200);
    res.close();
  });
});

describe('E05-S03 세션 보드 (EP-SES-01)', () => {
  it('카드에 신원 3요소·클레임·리스 잔여·scope 가 실린다', async () => {
    const sessions = app.get(SessionService);
    const boot = await sessions.bootstrap({
      projectId,
      userId,
      agentType: 'claude-code',
      hostname: 'mac-07',
      branch: 'fix/loader-cache',
      externalSessionId: 'S-board',
    });

    const taskId = newId();
    await pool.query(
      `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md, tools_sources_md, boundaries_md)
       VALUES ($1,$2,'TSK-board','보드','ready','목표','PR','도구','경계')`,
      [taskId, projectId],
    );
    await app.get(TaskService).claim({
      projectId,
      taskId,
      sessionId: boot.session_id,
      userId,
      scope: { specIds: [], fileGlobs: ['codebase/loader/**'] },
    });

    // 봉투가 됐다(2026-09-06 · REQ-API-120) — 세션도 자라는 목록이라 커서를 준다
    const { items: cards } = await sessions.board({ projectId });
    const card = cards.find((c) => c.id === boot.session_id);

    expect(card).toMatchObject({
      user_name: '하나',
      hostname: 'mac-07',
      agent_type: 'claude-code',
      state: 'active',
      task_key: 'TSK-board',
      branch: 'fix/loader-cache',
    });
    // 리스 잔여는 남은 초로 준다 — 카운트다운은 클라이언트 시계가 한다
    expect(card?.lease_remaining_seconds).toBeGreaterThan(0);
    expect(card?.scope_file_globs).toEqual(['codebase/loader/**']);
  });

  it('상태 필터와 요약 집계가 맞는다', async () => {
    const sessions = app.get(SessionService);
    const summary = await sessions.boardSummary(projectId);
    expect(summary['active']).toBeGreaterThan(0);

    const onlyStale = await sessions.board({ projectId, states: ['stale'] });
    expect(onlyStale.items.every((c) => c.state === 'stale')).toBe(true);
  });

  /**
   * **없는 것과 0 인 것은 다르다**(REQ-WEB-139 · 2026-09-05 사람 요청).
   *
   * `GROUP BY` 는 그 프로젝트에 실제로 있는 상태만 돌려준다 — 실측(sudoku)에서 응답이
   * `complete`·`stale` 둘뿐이라 나머지 넷은 화면에 아예 없었고, 보는 사람은 "오류가
   * 0건" 인지 "오류라는 상태가 없는" 것인지 구별할 수 없었다.
   */
  it('요약은 어휘 전부를 어휘 순서로 싣는다 — 0 인 상태도 빠지지 않는다', async () => {
    const summary = await app.get(SessionService).boardSummary(projectId);
    expect(Object.keys(summary)).toEqual([...sessionState.enumValues]);
    // 이 프로젝트에 없는 상태도 자리를 지킨다(빠지지 않고 0 이다)
    for (const state of sessionState.enumValues) {
      expect(typeof summary[state]).toBe('number');
    }
  });

  it('REST 표면이 프로젝트 소속을 판정한다 — 타 프로젝트 토큰은 403', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/clemvion/sessions',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('WS 룸 join (api.md §3.2)', () => {
  it('세션 쿠키가 없으면 연결을 끊는다 — PAT 접속은 지원하지 않는다', async () => {
    const gateway = app.get(WsGateway);
    const emitted: { event: string; payload: unknown }[] = [];
    let disconnected = false;
    await gateway.handleConnection({
      id: 's1',
      handshake: { headers: {} },
      emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
      disconnect: () => {
        disconnected = true;
      },
      data: {},
    } as never);

    expect(disconnected).toBe(true);
    // 예약어(`connect_error`)를 쓰지 않는다 — 서버가 emit 하면 socket.io 가 예외를 던지고
    // 연결 핸들러의 예외는 프로세스를 죽인다(실측: 미인증 탭 하나가 API 를 크래시 루프에 넣었다)
    expect(emitted[0]).toMatchObject({
      event: WS_ERROR_EVENT,
      payload: { code: NERV_ERROR.UNAUTHENTICATED },
    });
    expect(emitted[0]?.event).not.toBe('connect_error');
  });

  it('인증 전 join 은 거절한다', async () => {
    const gateway = app.get(WsGateway);
    const ack = await gateway.join({ room: `project:${projectId}` }, { data: {} } as never);
    expect(ack).toMatchObject({ ok: false, code: NERV_ERROR.UNAUTHENTICATED });
  });

  it('비멤버 프로젝트 룸은 ack 로 거절한다 — 연결은 끊지 않는다', async () => {
    const gateway = app.get(WsGateway);
    const socket = {
      data: {
        principal: { userId: newId(), isAgent: false, projectId: null, scopes: [] },
        rooms: new Set<string>(),
      },
    };
    const ack = await gateway.join({ room: `project:${projectId}` }, socket as never);
    expect(ack).toMatchObject({ ok: false, code: NERV_ERROR.FORBIDDEN });
  });

  it('멤버는 join 되고, 상한을 넘으면 429 코드로 거절한다', async () => {
    const gateway = app.get(WsGateway);
    const rooms = new Set<string>();
    const socket = {
      data: { principal: { userId, isAgent: false, projectId: null, scopes: [] }, rooms },
    };

    const ack = await gateway.join({ room: `project:${projectId}` }, socket as never);
    expect(ack).toMatchObject({ ok: true });
    expect(rooms.has(`project:${projectId}`)).toBe(true);

    // 상한(8)까지 채운 뒤 하나 더
    for (let i = 0; i < 8; i += 1) rooms.add(`project:filler-${i}`);
    const over = await gateway.join({ room: `project:${projectId}` }, socket as never);
    expect(over).toMatchObject({ ok: false, code: NERV_ERROR.RATE_LIMIT });
  });

  it('leave 는 룸에서 뺀다', () => {
    const gateway = app.get(WsGateway);
    const rooms = new Set<string>([`project:${projectId}`]);
    gateway.leave({ room: `project:${projectId}` }, { data: { rooms } } as never);
    expect(rooms.size).toBe(0);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  otherProjectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'hana@example.com','하나','active')`,
    [userId],
  );
  for (const [id, slug, key] of [
    [projectId, 'clemvion', 'CLV'],
    [otherProjectId, 'other', 'OTH'],
  ] as const) {
    await pool.query(`INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,$3,$4,$3)`, [
      id,
      orgId,
      slug,
      key,
    ]);
  }
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, projectId, userId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
    [newId(), orgId, otherProjectId, userId],
  );

  // **같은 slug 를 쓰는 두 조직**(REQ-API-152). 두 번째 조직 slug 을 'aaa' 로 두는 것은
  // 의도다 — 정렬상 'nerv' 보다 앞이라, 좁히지 않는 해소는 이쪽을 고른다.
  const twinOrgId = newId();
  sharedHereId = newId();
  sharedTwinId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'aaa','쌍둥이')`, [
    twinOrgId,
  ]);
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'shared','SHN','여기 공유')`,
    [sharedHereId, orgId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'shared','SHA','저기 공유')`,
    [sharedTwinId, twinOrgId],
  );
  for (const [org, project] of [
    [orgId, sharedHereId],
    [twinOrgId, sharedTwinId],
  ] as const) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'developer')`,
      [newId(), org, project, userId],
    );
  }
}
