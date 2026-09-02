// E12-S02 — 훅 ingest 5종 (agent-integration.md §3.3 · api.md §2.9)
//
// 훅은 **텔레메트리 평면**이라 실패해도 세션을 멈추지 않는다. 그 성질이 테스트의 형태를
// 정한다: 대부분의 케이스가 "이상한 입력이 와도 202 로 흘려보내되 조용히 삼키지는 않는가"다.
//
// 예외는 Stop 하나다 — 턴 종료 직전의 **동기 판정**이라 서버의 답이 에이전트의 행동을 바꾼다.

import { NERV_ERROR, NERV_EVENT, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SessionService } from '../../src/modules/session/session.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let projectId: string;
let userId: string;
let taskId: string;

const EXTERNAL_SESSION = 'S-b7e9';

beforeAll(async () => {
  db = await createScratchDb('nerv_ingest');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });
  await seed();

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (
    await app.get(AuthService).issueToken({
      projectId,
      userId,
      name: 'hooks',
      scopes: ['agent-session:launch', 'task:claim', 'task:update'],
    })
  ).token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  // FK 순서대로 지운다 — event.actor_session_id 가 agent_session 을 참조한다
  await pool.query('DELETE FROM activity');
  await pool.query('DELETE FROM notification');
  await pool.query('DELETE FROM event');
  await pool.query('DELETE FROM claim');
  await pool.query('DELETE FROM agent_session');
  await pool.query(`UPDATE task SET status = 'ready' WHERE id = $1`, [taskId]);
});

async function hook(
  path: string,
  payload: Record<string, unknown>,
  options: { token?: string | null; host?: string; agent?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const bearer = options.token === undefined ? token : options.token;
  if (bearer !== null) headers['authorization'] = `Bearer ${bearer}`;
  if (options.host !== undefined) headers['x-nerv-host'] = options.host;
  if (options.agent !== undefined) headers['x-nerv-agent'] = options.agent;

  const res = await app.inject({ method: 'POST', url: `/ingest/hooks/${path}`, headers, payload });
  return {
    status: res.statusCode,
    body: res.body === '' ? {} : (res.json() as Record<string, unknown>),
  };
}

describe('인증 — 토큰 없는 이벤트는 버린다 (§6.5)', () => {
  it.each(['session', 'tool', 'subagent', 'stop', 'session-end'])(
    '%s 훅은 401 이다',
    async (path) => {
      const res = await hook(path, { session_id: EXTERNAL_SESSION }, { token: null });
      expect(res.status).toBe(401);
      expect(res.body['code']).toBe(NERV_ERROR.UNAUTHENTICATED);
    },
  );
});

describe('SessionStart — 등록 + 컨텍스트 주입', () => {
  it('세션을 만들고 클레임 없음을 안내한다', async () => {
    const res = await hook(
      'session',
      { session_id: EXTERNAL_SESSION, cwd: '/work/clemvion', agent_type: 'claude-code' },
      { host: 'mac-07' },
    );
    expect(res.status).toBe(202);
    expect(res.body['additionalContext']).toContain('활성 클레임 없음');

    const { rows } = await pool.query<{ hostname: string; state: string; agent_type: string }>(
      `SELECT hostname, state::text AS state, agent_type::text AS agent_type
         FROM agent_session WHERE external_session_id = $1`,
      [EXTERNAL_SESSION],
    );
    expect(rows[0]).toMatchObject({ hostname: 'mac-07', agent_type: 'claude-code' });
  });

  // 2026-08-29 실측 — Claude Code 훅 본문에는 에이전트 종류가 없다. 본문만 읽던 동안
  // 훅으로 만들어진 세션은 **전부 `other`** 였고, 세션 화면은 "누구의 무엇"에 답하지 못했다.
  it('헤더가 말하면 그것을 쓴다 — 훅 본문에는 에이전트 종류가 없다', async () => {
    await hook('session', { session_id: 'S-header' }, { host: 'mac-08', agent: 'claude-code' });
    const { rows } = await pool.query<{ agent_type: string }>(
      `SELECT agent_type::text AS agent_type FROM agent_session WHERE external_session_id = $1`,
      ['S-header'],
    );
    expect(rows[0]?.agent_type).toBe('claude-code');
  });

  it('헤더가 본문을 이긴다 — 헤더는 보내는 쪽이 자기를 말한 것이다', async () => {
    await hook(
      'session',
      { session_id: 'S-both', agent_type: 'web' },
      { host: 'mac-08', agent: 'codex' },
    );
    const { rows } = await pool.query<{ agent_type: string }>(
      `SELECT agent_type::text AS agent_type FROM agent_session WHERE external_session_id = $1`,
      ['S-both'],
    );
    expect(rows[0]?.agent_type).toBe('codex');
  });

  it('헤더가 없으면 본문을 쓴다 — MCP nerv_bootstrap 경로가 그 자리다', async () => {
    await hook('session', { session_id: 'S-body', agent_type: 'web' }, { host: 'mac-08' });
    const { rows } = await pool.query<{ agent_type: string }>(
      `SELECT agent_type::text AS agent_type FROM agent_session WHERE external_session_id = $1`,
      ['S-body'],
    );
    expect(rows[0]?.agent_type).toBe('web');
  });

  it('클레임을 쥐고 있으면 그것을 알려준다 — 다시 묻지 않게', async () => {
    const start = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    const sessionId = String(start.body['session_id']);
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, sessionId, userId],
    );
    await pool.query(`UPDATE task SET status = 'in_progress' WHERE id = $1`, [taskId]);

    // 키 **형식**이 아니라 그 Task 의 실제 키가 들어 있는지 본다 — 형식이 바뀌어도
    // 이 테스트가 지키려는 것("어느 작업을 쥐고 있는지 말해 준다")은 그대로다.
    const { rows: task } = await pool.query<{ key: string }>(`SELECT key FROM task WHERE id = $1`, [
      taskId,
    ]);
    const again = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    expect(again.body['additionalContext']).toContain(task[0]!.key);
    expect(again.body['additionalContext']).toContain('새로 클레임하지 말고');
  });

  it('알 수 없는 에이전트 종류는 other 로 적재한다 — enum 밖 값으로 실패시키지 않는다', async () => {
    await hook('session', { session_id: 'S-unknown', agent_type: 'cursor' }, { host: 'mac-99' });
    const { rows } = await pool.query<{ agent_type: string }>(
      `SELECT agent_type::text AS agent_type FROM agent_session WHERE external_session_id = 'S-unknown'`,
    );
    expect(rows[0]?.agent_type).toBe('other');
  });
});

describe('PostToolUse · Subagent — 관찰 전용', () => {
  it('도구 사용을 타임라인에 적재한다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    await hook('tool', { session_id: EXTERNAL_SESSION, tool_name: 'Edit', tool_use_id: 'tu-1' });
    await hook('tool', { session_id: EXTERNAL_SESSION, tool_name: 'Bash', tool_use_id: 'tu-2' });

    const { rows } = await pool.query<{
      title: string;
      seq: string;
      payload: { tool_use_id: string };
    }>(`SELECT title, seq::text AS seq, payload FROM activity ORDER BY seq`);
    expect(rows.map((r) => r.title)).toEqual(['Edit', 'Bash']);
    // 페이로드 원문을 통째로 넣지 않는다 — 필요한 조인 키만 남긴다(D-07)
    expect(Object.keys(rows[0]?.payload ?? {})).toEqual(['tool_use_id']);
  });

  it('bootstrap 전에 도착한 훅은 조용히 버린다 — 세션이 없으면 적재할 곳도 없다', async () => {
    const res = await hook('tool', { session_id: 'S-not-registered', tool_name: 'Edit' });
    expect(res.status).toBe(202);
    expect(res.body['ok']).toBe(false);
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM activity`);
    expect(rows[0]?.n).toBe(0);
  });

  it('서브에이전트도 같은 타임라인에 남는다 — 누가 무엇을 했는지가 한 줄에 있어야 한다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    await hook('subagent', { session_id: EXTERNAL_SESSION, agent_type: 'nerv-spec-writer' });
    const { rows } = await pool.query<{ title: string; type: string }>(
      `SELECT title, type::text AS type FROM activity`,
    );
    expect(rows[0]).toMatchObject({ title: 'subagent:nerv-spec-writer', type: 'thought' });
  });
});

describe('Stop — 유일한 동기 판정 경로', () => {
  it('정리하지 않은 클레임이 있으면 종료를 막는다', async () => {
    const start = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, String(start.body['session_id']), userId],
    );
    await pool.query(`UPDATE task SET status = 'in_progress' WHERE id = $1`, [taskId]);

    const res = await hook('stop', { session_id: EXTERNAL_SESSION });
    expect(res.status).toBe(201);
    expect(res.body['decision']).toBe('block');
    // 막기만 하지 않는다 — 무엇을 해야 풀리는지 함께 준다
    expect(res.body['reason']).toContain('nerv_task_release');
  });

  it('done 인 작업만 남았으면 막지 않는다', async () => {
    const start = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, String(start.body['session_id']), userId],
    );
    await pool.query(
      `UPDATE task SET status = 'done', done_at = now(), spec_impact = '{"none":true}'::jsonb WHERE id = $1`,
      [taskId],
    );

    const res = await hook('stop', { session_id: EXTERNAL_SESSION });
    expect(res.body['decision']).toBeUndefined();
  });

  it('세션을 모르면 막지 않는다 — 판정할 근거가 없을 때 막는 것은 방해다', async () => {
    const res = await hook('stop', { session_id: 'S-unknown-2' });
    expect(res.body['decision']).toBeUndefined();
  });
});

describe('훅은 병렬로 온다 — 번호가 겹쳐 사라지지 않는다', () => {
  it('동시 도구 훅 20건이 하나도 유실되지 않는다', async () => {
    const start = await hook('session', { session_id: 'S-par' }, { host: 'mac-07' });
    const sessionId = String(start.body['session_id']);

    // PostToolUse 는 async 훅이라 실제로 겹쳐 도착한다. 예전에는 `max(seq)+1` 을 읽고
    // 따로 INSERT 해서, 같은 번호를 읽은 뒤엣것이 유니크에 걸려 조용히 사라졌다 —
    // 응답은 그때도 성공(202)이었다.
    const sent = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        hook('tool', {
          session_id: 'S-par',
          tool_name: `Tool${i}`,
          tool_input: { i },
        }),
      ),
    );
    expect(sent.every((r) => r.status === 202)).toBe(true);

    const { rows } = await pool.query<{ n: number; distinct_seq: number }>(
      `SELECT count(*)::int AS n, count(DISTINCT seq)::int AS distinct_seq
         FROM activity WHERE session_id = $1`,
      [sessionId],
    );
    expect(rows[0]?.n).toBe(20);
    expect(rows[0]?.distinct_seq).toBe(20);
  });
});

describe('훅의 세션 신원은 토큰에서 온다 (D-08)', () => {
  it('남의 PAT 로는 그 세션을 끝내지 못한다 — external id 는 비밀이 아니다', async () => {
    const start = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    const sessionId = String(start.body['session_id']);
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, sessionId, userId],
    );

    // 같은 프로젝트의 다른 멤버 — 그의 PAT 는 그의 세션만 만질 수 있다
    const other = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'dohyun@example.com','도현','active')`,
      [other],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       SELECT $1, org_id, id, $2, 'developer' FROM project WHERE id = $3`,
      [newId(), other, projectId],
    );
    const otherToken = (
      await app.get(AuthService).issueToken({
        projectId,
        userId: other,
        name: 'other',
        scopes: ['agent-session:launch', 'task:update'],
      })
    ).token;

    const res = await hook(
      'session-end',
      { session_id: EXTERNAL_SESSION, reason: 'complete' },
      { token: otherToken },
    );
    // 세션을 못 찾은 것과 같다 — 조용히 버린다(bootstrap 전 훅과 구별하지 않는다)
    expect(res.status).toBe(202);

    const { rows } = await pool.query<{ state: string; claims: number }>(
      `SELECT s.state::text AS state,
              (SELECT count(*)::int FROM claim c WHERE c.agent_session_id = s.id AND c.status='active') AS claims
         FROM agent_session s WHERE s.id = $1`,
      [sessionId],
    );
    expect(rows[0]?.state).toBe('active');
    expect(rows[0]?.claims).toBe(1);
  });
});

describe('SessionEnd — 종료 + 미해제 클레임 회수', () => {
  it('세션이 끝나면 클레임을 돌려놓는다 — 30분 리스를 기다리게 두지 않는다 (D-13)', async () => {
    const start = await hook('session', { session_id: EXTERNAL_SESSION }, { host: 'mac-07' });
    const sessionId = String(start.body['session_id']);
    await pool.query(
      `INSERT INTO claim (id, project_id, task_id, agent_session_id, user_id, status, lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,'active', now() + interval '30 minutes')`,
      [newId(), projectId, taskId, sessionId, userId],
    );
    await pool.query(`UPDATE task SET status = 'in_progress' WHERE id = $1`, [taskId]);

    const res = await hook('session-end', { session_id: EXTERNAL_SESSION, reason: 'complete' });
    expect(res.status).toBe(202);

    const { rows } = await pool.query<{ state: string; task_status: string; claims: number }>(
      `SELECT s.state::text AS state, t.status::text AS task_status,
              (SELECT count(*)::int FROM claim c WHERE c.agent_session_id = s.id AND c.status = 'active') AS claims
         FROM agent_session s, task t WHERE s.id = $1 AND t.id = $2`,
      [sessionId, taskId],
    );
    expect(rows[0]?.state).toBe('complete');
    expect(rows[0]?.claims).toBe(0);
    expect(rows[0]?.task_status).toBe('ready'); // 다음 세션이 바로 집어갈 수 있다
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  taskId = newId();
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
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                       tools_sources_md, boundaries_md)
     VALUES ($1,$2,'CLV-T-0CFQC2','위젯','ready','목표','PR','도구','경계')`,
    [taskId, projectId],
  );
}

// 2026-09-01 사람 결정 — 훅 페이로드 **원문을 보관한다**. 비밀만 예외로, **적재 시점에** 가린다.
// 그전에는 `tool_name` 만 남아 타임라인이 "Bash / Bash" 를 383번 반복했다(실측).
describe('원문 보관과 마스킹 (REQ-API-065)', () => {
  async function lastActivity(): Promise<Record<string, unknown>> {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT title, tool_name, payload FROM activity ORDER BY created_at DESC, seq DESC LIMIT 1`,
    );
    return rows[0]!;
  }

  it('명령과 출력이 남는다 — 무엇을 했는지 알 수 있다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    await hook('tool', {
      session_id: EXTERNAL_SESSION,
      tool_name: 'Bash',
      tool_use_id: 'tu-raw',
      tool_input: { command: 'pnpm -r test' },
      tool_response: { stdout: 'Tests 274 passed', exit_code: 0 },
    });
    const row = await lastActivity();
    // **제목이 도구 이름이 아니다** — 그것이 이 변경의 전부다
    expect(row['title']).toBe('Bash · pnpm -r test');
    expect(JSON.stringify(row['payload'])).toContain('Tests 274 passed');
    expect((row['payload'] as Record<string, unknown>)['ok']).toBe(true);
  });

  it('실패는 성패와 이유를 남긴다 — 예전에는 성공했는지도 몰랐다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    await hook('tool', {
      session_id: EXTERNAL_SESSION,
      tool_name: 'Bash',
      tool_use_id: 'tu-fail',
      tool_input: { command: 'pnpm lint' },
      tool_response: { stdout: '', exit_code: 1 },
    });
    const payload = (await lastActivity())['payload'] as Record<string, unknown>;
    expect(payload['ok']).toBe(false);
    expect(payload['outcome']).toBe('exit 1');
  });

  it('비밀은 DB 에 들어가지 않는다 — 예외는 적재 시점에 적용한다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    await hook('tool', {
      session_id: EXTERNAL_SESSION,
      tool_name: 'Bash',
      tool_use_id: 'tu-secret',
      tool_input: { command: 'curl -H "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz01"' },
      tool_response: { stdout: 'ok', exit_code: 0 },
    });
    const raw = JSON.stringify(await lastActivity());
    expect(raw).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz01');
    expect(raw).toContain('masked');
    // 가렸다고 말한다 — 조용히 지우면 "그 인자를 안 받았나" 로 읽힌다
    expect(raw).toContain('github_token');
  });

  it('비밀 파일을 읽으면 응답을 통째로 가리고 경로는 남긴다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    await hook('tool', {
      session_id: EXTERNAL_SESSION,
      tool_name: 'Read',
      tool_use_id: 'tu-env',
      tool_input: { file_path: '/repo/.env' },
      tool_response: 'NERV_TOKEN=super-secret-value',
    });
    const row = await lastActivity();
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('super-secret-value');
    expect(raw).toContain('secret_file');
    // 무엇을 읽었는지는 사실이다 — 그것까지 가리면 타임라인이 다시 무의미해진다
    expect(String(row['title'])).toContain('.env');
  });
});

// 2026-09-01 사람 결정 — 마스킹이 완벽하지 않으므로 **원문 열람을 좁힌다**.
// 가리는 것과 좁히는 것은 한 쌍이다: 하나만으로는 부족하다.
describe('원문 열람 — 세션 본인과 admin 만 (REQ-API-066)', () => {
  async function seed(): Promise<void> {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    await hook('tool', {
      session_id: EXTERNAL_SESSION,
      tool_name: 'Bash',
      tool_use_id: 'tu-view',
      tool_input: { command: 'pnpm -r test' },
      tool_response: { stdout: '비밀은 아니지만 원문이다', exit_code: 0 },
    });
  }

  async function timelineFor(viewer: string | null): Promise<Record<string, unknown>[]> {
    return app
      .get(SessionService)
      .timeline({ projectId, sessionId: EXTERNAL_SESSION, userId: viewer });
  }

  it('세션 본인은 원문을 본다', async () => {
    await seed();
    const rows = await timelineFor(userId);
    const last = rows[rows.length - 1]!;
    expect(last['raw_visible']).toBe(true);
    expect(JSON.stringify(last['payload'])).toContain('pnpm -r test');
  });

  it('남은 요약만 본다 — 무엇을 했고 성공했는지는 알되 원문은 못 본다', async () => {
    await seed();
    const other = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'other@example.com','남','active')`,
      [other],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),$2,$3,'developer')`,
      [newId(), projectId, other],
    );

    const rows = await timelineFor(other);
    const last = rows[rows.length - 1]!;
    expect(last['raw_visible']).toBe(false);
    // 제목과 성패는 남는다 — 그것까지 가리면 세션 모니터가 서지 않는다
    expect(String(last['title'])).toContain('pnpm -r test');
    expect((last['payload'] as Record<string, unknown>)['ok']).toBe(true);
    expect(JSON.stringify(last['payload'])).not.toContain('원문이다');
  });

  it('admin 은 남의 세션 원문도 본다 — 조직 단위 admin 도 같다', async () => {
    await seed();
    const admin = newId();
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'adm@example.com','관리','active')`,
      [admin],
    );
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role)
       VALUES ($1,(SELECT org_id FROM project WHERE id = $2),NULL,$3,'admin')`,
      [newId(), projectId, admin],
    );
    const rows = await timelineFor(admin);
    expect(rows[rows.length - 1]!['raw_visible']).toBe(true);
  });

  it('보는 사람을 모르면 원문을 주지 않는다 — 기본이 닫힘이다', async () => {
    await seed();
    const rows = await timelineFor(null);
    expect(rows[rows.length - 1]!['raw_visible']).toBe(false);
  });
});

// 2026-09-01 사람 보고 — 세션 모니터가 답해야 하는 물음은 "무슨 도구를 썼나" 가 아니라
// "무엇을 하는 중이고 막혀 있나" 다. 그 답은 **이벤트에 처음부터 있었다**(actor_session_id).
describe('작업 궤적 — 도구 로그가 아니라 한 일 (REQ-API-068)', () => {
  it('그 세션이 한 일을 시간순으로 준다 — 새로 저장하는 것이 없다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    const { rows: session } = await pool.query<{ id: string }>(
      `SELECT id FROM agent_session WHERE external_session_id = $1`,
      [EXTERNAL_SESSION],
    );
    const sessionId = session[0]!.id;

    // 이벤트는 도메인 서비스가 낸다 — 여기서는 그 결과만 흉내 낸다(궤적은 읽기다).
    // **키는 event 행에 없다** — subject_id 로 되찾으므로 실제 스펙을 하나 만든다.
    const specId = newId();
    const versionId = newId();
    await pool.query(
      `INSERT INTO spec (id, project_id, type, key, title) VALUES ($1,$2,'feature','SUD-AREA-PLAY','놀이')`,
      [specId, projectId],
    );
    await pool.query(
      `INSERT INTO spec_version (id, spec_id, version_no, status, body_md, content_hash, author_user_id)
       VALUES ($1,$2,1,'draft','# 본문', digest('x','sha256'), $3)`,
      [versionId, specId, userId],
    );
    for (const [type, subjectType, subjectId] of [
      [NERV_EVENT.SPEC_DRAFT_UPDATED, 'spec_version', versionId],
      [NERV_EVENT.QUESTION_CREATED, 'question', newId()],
    ] as const) {
      await pool.query(
        `INSERT INTO event (id, project_id, type, subject_type, subject_id,
                            actor_user_id, actor_session_id, is_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [newId(), projectId, type, subjectType, subjectId, userId, sessionId],
      );
    }

    const steps = await app
      .get(SessionService)
      .trajectory({ projectId, sessionId: EXTERNAL_SESSION });
    expect(steps.map((s) => s['type'])).toEqual([
      NERV_EVENT.SPEC_DRAFT_UPDATED,
      NERV_EVENT.QUESTION_CREATED,
    ]);
    expect(steps[0]?.['subject_key']).toBe('SUD-AREA-PLAY');
  });

  it('세션 자신의 생애는 궤적이 아니다 — 카드가 이미 말한다', async () => {
    await hook('session', { session_id: EXTERNAL_SESSION, source: 'startup' });
    const steps = await app
      .get(SessionService)
      .trajectory({ projectId, sessionId: EXTERNAL_SESSION });
    expect(steps.every((s) => !String(s['type']).startsWith('session.'))).toBe(true);
  });
});
