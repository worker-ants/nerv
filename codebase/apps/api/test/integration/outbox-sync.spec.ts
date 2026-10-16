// L2 — 복구 뒤 자동 동기화와 실패 보고 (E21-S01 · NFR-05 · api.md REQ-API-322 · plugin.md REQ-PLG-032 · 033)
//
//   WHEN 서버가 다시 응답하면, THE SYSTEM SHALL 세션 시작이나 다음 스킬 턴을 기다리지 않고 `.nerv/outbox/` 를
//   `queued_at` 순으로 원래 멱등 키 그대로 보내고 중복 레코드 0을 유지한다
//   WHEN 재전송이 4xx 로 끝나면, THE SYSTEM SHALL 그 항목을 `outbox/failed/` 로 옮기고 사람에게 보고한다
//
// **플러그인의 스크립트를 이 서버에 그대로 붙인다.** 스크립트의 규칙(잠금 · 백그라운드 · 멈춤)은 L1(`plugin-test/outbox.spec.ts`)이
// 가짜 서버로 본다. 여기서 세는 것은 DB 의 행이다 — 같은 항목을 두 번 보내도 레코드가 하나인지, 거절이 사람의 알림이
// 되는지, 남의 세션에 붙지 않는지(AGENTS.md 테스트 규약 — 중복 0 은 mock 으로 증명할 수 없다).

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NERV_ERROR, NERV_EVENT_PHASE2, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/event/notification.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const PLUGIN_BIN = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugin/bin');

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let server: string;
let token: string;
let otherToken: string;
let projectId: string;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_outbox_sync');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await app.listen(0, '127.0.0.1');
  server = await app.getUrl();

  const scopes = ['spec:read', 'task:claim', 'task:update', 'agent-session:launch'];
  token = (await app.get(AuthService).issueToken({ projectId, userId, name: 'outbox', scopes }))
    .token;
  otherToken = (
    await app.get(AuthService).issueToken({
      projectId,
      userId: otherUserId,
      name: 'other',
      scopes,
    })
  ).token;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notification');
  await pool.query('TRUNCATE event');
  await pool.query('DELETE FROM idempotency_key');
  await pool.query('DELETE FROM task');
  await pool.query('DELETE FROM activity');
  await pool.query('DELETE FROM agent_session');
});

// ── 도우미 ──────────────────────────────────────────────────────────────────

/** NERV 를 설정한 작업 저장소(`.mcp.json` 의 `nerv`) — 포워더와 큐는 그런 저장소에서만 보낸다(4.6 REQ-PLG-041) */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nerv-outbox-l2-'));
  writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"nerv":{}}}\n');
  mkdirSync(join(dir, '.nerv', 'outbox'), { recursive: true });
  return dir;
}

const outboxOf = (dir: string): string => join(dir, '.nerv', 'outbox');

function item(
  dir: string,
  key: string,
  tool: string,
  input: Record<string, unknown>,
  { at = '2026-10-16T05:00:00Z', session = '' } = {},
): string {
  const name = `${at.replace(/:/g, '-')}-${key}.json`;
  const text = JSON.stringify({
    tool,
    input,
    idempotency_key: key,
    session_id: session,
    queued_at: at,
    attempts: 1,
  });
  writeFileSync(join(outboxOf(dir), name), text);
  return text;
}

const pending = (dir: string): string[] =>
  readdirSync(outboxOf(dir)).filter((name) => name.endsWith('.json'));

const failedFiles = (dir: string): Record<string, unknown>[] =>
  readdirSync(join(outboxOf(dir), 'failed'))
    .filter((name) => name.endsWith('.json'))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(outboxOf(dir), 'failed', name), 'utf8')) as Record<
          string,
          unknown
        >,
    );

/** 서버가 같은 프로세스라 동기 실행은 쓰지 못한다 */
function run(
  script: string,
  args: string[],
  { cwd, input = '', bearer = token }: { cwd: string; input?: string; bearer?: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [join(PLUGIN_BIN, script), ...args], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: cwd,
        NERV_SERVER: server,
        NERV_TOKEN: bearer,
        NERV_PROJECT: 'clemvion',
        NERV_HOSTNAME: 'mac-07',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function until(check: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('기다린 일이 일어나지 않았다');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

const tasks = (title: string): Promise<number> =>
  count(`SELECT count(*)::text AS n FROM task WHERE title = $1`, [title]);

/** 훅으로 세션을 연다 — 큐 파일의 세션 id 로 쓸 NERV 세션 id 를 돌려준다 */
async function openSession(dir: string, external: string, bearer = token): Promise<string> {
  const out = await run('nerv-hook-forward', ['session'], {
    cwd: dir,
    input: JSON.stringify({ session_id: external, cwd: dir, source: 'startup' }),
    bearer,
  });
  return String((JSON.parse(out.stdout) as Record<string, unknown>)['session_id']);
}

async function report(
  body: unknown,
  bearer: string | null = token,
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;
  const res = await app.inject({
    method: 'POST',
    url: '/ingest/hooks/outbox-failed',
    headers,
    payload: body as Record<string, unknown>,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function outboxEvents(): Promise<
  {
    subject_type: string;
    subject_id: string;
    actor_user_id: string;
    payload: Record<string, unknown>;
  }[]
> {
  const { rows } = await pool.query<{
    subject_type: string;
    subject_id: string;
    actor_user_id: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT subject_type, subject_id, actor_user_id, payload FROM event WHERE type = $1 ORDER BY occurred_at`,
    [NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED],
  );
  return rows;
}

// ── 복구 뒤 자동 동기화 ────────────────────────────────────────────────────

describe('E21-S01 — 서버가 다시 응답하면 큐를 원래 멱등 키로 보내고 중복은 0이다', () => {
  it('도구 훅이 2xx 를 받으면 큐가 비워진다 — 세션 시작이나 다음 스킬 턴을 기다리지 않는다', async () => {
    const dir = repo();
    const session = await openSession(dir, 'claude-auto');
    item(
      dir,
      'auto-1',
      'nerv_task_create',
      { project: 'clemvion', title: '오프라인 동안 만든 작업' },
      {
        at: '2026-10-16T05:00:00Z',
        session,
      },
    );
    item(
      dir,
      'auto-2',
      'nerv_task_create',
      { project: 'clemvion', title: '그다음 작업' },
      {
        at: '2026-10-16T05:00:01Z',
        session,
      },
    );

    // 서버가 돌아왔다는 첫 신호 — 도구 훅 하나
    const hook = await run('nerv-hook-forward', ['tool'], {
      cwd: dir,
      input: JSON.stringify({ session_id: 'claude-auto', tool_name: 'Bash', tool_input: {} }),
    });
    expect(hook.code).toBe(0);

    await until(() => pending(dir).length === 0);
    expect(await tasks('오프라인 동안 만든 작업')).toBe(1);
    expect(await tasks('그다음 작업')).toBe(1);
    // queued_at 순서 — 앞의 것이 먼저 만들어졌다
    const { rows } = await pool.query<{ title: string }>(
      `SELECT title FROM task ORDER BY created_at, id`,
    );
    expect(rows.map((r) => r.title)).toEqual(['오프라인 동안 만든 작업', '그다음 작업']);
  });

  it('같은 항목이 두 번 flush 돼도 서버 레코드는 하나다 — 원래 멱등 키를 그대로 쓴다', async () => {
    const dir = repo();
    const text = item(dir, 'twice', 'nerv_task_create', {
      project: 'clemvion',
      title: '두 번 간 쓰기',
    });

    const first = await run('nerv-outbox', ['flush'], { cwd: dir });
    expect(first.stdout).toContain('성공 1');
    // 응답이 끊겨 지우지 못한 것처럼 같은 파일을 되살린다
    writeFileSync(join(outboxOf(dir), '2026-10-16T05-00-00Z-twice.json'), text);
    const second = await run('nerv-outbox', ['flush'], { cwd: dir });
    expect(second.stdout).toContain('성공 1');

    expect(await tasks('두 번 간 쓰기')).toBe(1);
    expect(pending(dir)).toEqual([]);
    expect(await count(`SELECT count(*)::text AS n FROM idempotency_key WHERE key = 'twice'`)).toBe(
      1,
    );
  });
});

// ── 실패 보고 ──────────────────────────────────────────────────────────────

describe('REQ-API-322 — 재전송이 거절되면 failed/ 로 옮기고 사람에게 알린다', () => {
  it('거절된 항목이 그 사람의 세션에 이벤트로 남고 그 사람에게 중요 알림이 간다', async () => {
    const dir = repo();
    const session = await openSession(dir, 'claude-fail');
    item(
      dir,
      'ok-1',
      'nerv_task_create',
      { project: 'clemvion', title: '들어간 쓰기' },
      {
        at: '2026-10-16T05:00:00Z',
        session,
      },
    );
    item(
      dir,
      'bad-1',
      'nerv_task_update',
      { task_id: 'CLV-T-ZZZZZZ', status: 'in_progress' },
      {
        at: '2026-10-16T05:00:01Z',
        session,
      },
    );

    const out = await run('nerv-outbox', ['flush'], { cwd: dir });
    expect(out.stdout).toContain('성공 1 · 실패 1');
    expect(out.stdout).toContain('서버에 알렸다');
    expect(pending(dir)).toEqual([]);
    expect(await tasks('들어간 쓰기')).toBe(1);

    const [failed] = failedFiles(dir);
    expect(failed).toMatchObject({
      idempotency_key: 'bad-1',
      failure: { status: 200, code: NERV_ERROR.PRECONDITION },
    });
    expect(typeof failed?.['reported_at']).toBe('string');

    const events = await outboxEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      subject_type: 'agent_session',
      subject_id: session,
      actor_user_id: userId,
      payload: {
        count: 1,
        items: [
          {
            tool: 'nerv_task_update',
            idempotency_key: 'bad-1',
            queued_at: '2026-10-16T05:00:01.000Z',
            status: 200,
            code: NERV_ERROR.PRECONDITION,
          },
        ],
      },
    });
    // 메시지 원문과 비신뢰 세션 값은 이벤트에 남기지 않는다
    const stored = (events[0]?.payload['items'] as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(stored).sort()).toEqual(
      ['code', 'failed_at', 'idempotency_key', 'kind', 'queued_at', 'status', 'tool'].sort(),
    );

    // 행위자 제외의 예외 — 보고한 사람 자신이 받는다(중요 · 안 읽음)
    await new NotificationService(drizzle(pool)).route();
    const { rows } = await pool.query<{ user_id: string; importance: string; state: string }>(
      `SELECT n.user_id, n.importance::text AS importance, n.state::text AS state
         FROM notification n JOIN event e ON e.id = n.event_id WHERE e.type = $1`,
      [NERV_EVENT_PHASE2.SESSION_OUTBOX_FAILED],
    );
    expect(rows).toEqual([{ user_id: userId, importance: 'immediate', state: 'unread' }]);
  });

  it('같은 실패를 다시 알려도 이벤트는 하나다 — 응답이 끊긴 보고는 다음 flush 가 다시 보낸다', async () => {
    const dir = repo();
    const session = await openSession(dir, 'claude-again');
    const body = {
      items: [
        {
          tool: 'nerv_question_create',
          idempotency_key: 'again-1',
          session_id: session,
          queued_at: '2026-10-16T05:00:00Z',
          status: 200,
          code: NERV_ERROR.FORBIDDEN,
          kind: 'missing_scope',
        },
      ],
    };
    expect((await report(body)).body).toMatchObject({ recorded: 1, duplicates: 0 });
    // 같은 항목과 새 항목 — 새 것만 남는다
    const again = await report({
      items: [...body.items, { ...body.items[0], idempotency_key: 'again-2' }],
    });
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ recorded: 1, duplicates: 1 });

    const events = await outboxEvents();
    expect(
      events.map((e) => (e.payload['items'] as { idempotency_key: string }[])[0]?.idempotency_key),
    ).toEqual(['again-1', 'again-2']);
  });

  it('남의 세션에는 붙지 않는다 — 큐 파일의 세션 값은 비신뢰다', async () => {
    const dir = repo();
    const theirs = await openSession(dir, 'claude-theirs', otherToken);
    const res = await report({
      items: [
        { tool: 'nerv_task_update', idempotency_key: 'not-mine', session_id: theirs, status: 409 },
      ],
    });
    expect(res.status).toBe(202);

    const [event] = await outboxEvents();
    expect(event).toMatchObject({
      subject_type: 'project',
      subject_id: projectId,
      actor_user_id: userId,
    });

    await new NotificationService(drizzle(pool)).route();
    const { rows } = await pool.query<{ user_id: string }>(`SELECT user_id FROM notification`);
    expect(rows.map((r) => r.user_id)).toEqual([userId]);
  });

  it('하네스의 세션 id 로도 자기 세션을 찾는다', async () => {
    const dir = repo();
    const session = await openSession(dir, 'claude-external');
    await report({ items: [{ idempotency_key: 'ext-1', session_id: 'claude-external' }] });
    const [event] = await outboxEvents();
    expect(event).toMatchObject({ subject_type: 'agent_session', subject_id: session });
  });

  it('토큰이 없으면 401, 모양이 틀리면 400 이다 — 아무것도 남기지 않는다', async () => {
    expect((await report({ items: [{ idempotency_key: 'x' }] }, null)).status).toBe(401);

    const invalid: unknown[] = [
      {},
      { items: [] },
      { items: 'x' },
      { items: Array.from({ length: 101 }, (_, i) => ({ idempotency_key: `k${i}` })) },
      { items: [{}] },
      { items: [{ idempotency_key: '' }] },
      { items: [{ idempotency_key: 'k', tool: 'Bash; rm -rf' }] },
      { items: [{ idempotency_key: 'k', status: 1000 }] },
      { items: [{ idempotency_key: 'k', queued_at: 'yesterday' }] },
      { items: [{ idempotency_key: 'k', code: '<script>' }] },
    ];
    for (const body of invalid) {
      const res = await report(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body['code']).toBe(NERV_ERROR.PRECONDITION);
    }
    expect(await outboxEvents()).toEqual([]);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  otherUserId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES
       ($1,'hana@example.com','하나','active'), ($2,'dul@example.com','둘','active')`,
    [userId, otherUserId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES
       ($1,$2,$3,$4,'developer'), ($5,$2,$3,$6,'developer')`,
    [newId(), orgId, projectId, userId, newId(), otherUserId],
  );
}
