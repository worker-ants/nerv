// L3 공용 — **진짜 HTTP 서버**를 세운다 (codebase.md §4.3 · backlog.md §5)
//
// L2 와 갈라놓는 지점이 여기다: 백로그 §5 의 시나리오는 "호스트 2대·세션 3개가 90분 동안
// 부딪힌다"이고, 그것은 함수 호출로 재현되지 않는다. 실제 포트에 실제 요청이 동시에
// 도착해야 원자적 클레임이 무엇을 막는지 보인다.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { newId, runMigrations } from '@nerv/schema';
import pg from 'pg';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

export interface E2EStack {
  app: NestFastifyApplication;
  baseUrl: string;
  pool: pg.Pool;
  dbUrl: string;
  projectId: string;
  projectSlug: string;
  users: Record<string, string>;
  tokenFor: (user: string, scopes?: string[]) => Promise<string>;
  close: () => Promise<void>;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('L3 E2E 에는 DATABASE_URL 이 필요하다 (compose 스택 기동 후 실행)');
  }
  return url;
}

/** compose 스택이 실제로 떠 있는지 — 없으면 시나리오를 건너뛴다(거짓 실패 금지). */
export function stackAvailable(): boolean {
  try {
    execFileSync('pg_isready', ['-q'], { stdio: 'ignore' });
    return true;
  } catch {
    return process.env['DATABASE_URL'] !== undefined;
  }
}

export async function startStack(prefix: string): Promise<E2EStack> {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  const name = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const dbUrl = url.toString();
  await runMigrations(dbUrl);

  process.env['DATABASE_URL'] = dbUrl;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  const app = await createApp();
  await app.init();
  // 포트 0 — OS 가 빈 포트를 준다. 병렬 실행에서 포트 충돌로 깨지지 않게.
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const pool = new pg.Pool({ connectionString: dbUrl });
  const seeded = await seed(pool);
  const auth = app.get(AuthService);

  return {
    app,
    baseUrl,
    pool,
    dbUrl,
    ...seeded,
    tokenFor: async (user, scopes = ['spec:read', 'spec:draft', 'task:claim', 'task:update']) =>
      (
        await auth.issueToken({
          projectId: seeded.projectId,
          userId: seeded.users[user] ?? '',
          name: `e2e-${user}`,
          scopes,
        })
      ).token,
    close: async () => {
      // 순서가 중요하다: 앱을 먼저 닫아 커넥션을 정리하지 않으면, DROP 을 위해 백엔드를
      // 강제 종료하는 순간 살아 있는 풀이 "Connection terminated" 를 던진다.
      await app.close();
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl() });
      await cleanup.connect();
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}"`);
      await cleanup.end();
    },
  };
}

/** 예시 데이터 한 벌 — 시드와 같은 등장인물이다(하나/mac-07 · 도현/mac-02 · 유나/linux-ci-01). */
async function seed(pool: pg.Pool): Promise<{
  projectId: string;
  projectSlug: string;
  users: Record<string, string>;
}> {
  const orgId = newId();
  const projectId = newId();
  const users: Record<string, string> = {
    hana: newId(),
    dohyun: newId(),
    yuna: newId(),
    jimin: newId(),
    reviewer: newId(),
  };

  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  for (const [name, id] of Object.entries(users)) {
    await pool.query(
      `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,$2,$3,'active')`,
      [id, `${name}@example.com`, name],
    );
  }
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  for (const [name, id] of Object.entries(users)) {
    await pool.query(
      `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,$5)`,
      // jimin 은 기획자이자 이 프로젝트의 admin 이다 — 임포트(EP-IMP)는 admin + import:write 다
      [
        newId(),
        orgId,
        projectId,
        id,
        name === 'jimin' ? 'admin' : name === 'reviewer' ? 'planner' : 'developer',
      ],
    );
  }

  return { projectId, projectSlug: 'clemvion', users };
}

/** MCP 호출 — 에이전트가 실제로 쓰는 경로 그대로(REST 우회 금지). */
export async function callTool(
  stack: E2EStack,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  status: number;
  result: Record<string, unknown>;
  error: Record<string, unknown> | null;
}> {
  const res = await fetch(`${stack.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as {
    result?: { structuredContent?: Record<string, unknown>; isError?: boolean; content?: unknown };
    error?: Record<string, unknown>;
  };
  const structured = body.result?.structuredContent ?? {};
  return {
    status: res.status,
    result: structured,
    error:
      body.error ??
      (body.result?.isError === true ? (structured as Record<string, unknown>) : null),
  };
}

/** Event 로그 질의 — 판정은 설문이 아니라 로그다(backlog.md §5 머리말). */
export async function countEvents(
  stack: E2EStack,
  type: string,
  subjectId?: string,
): Promise<number> {
  const { rows } = await stack.pool.query<{ n: number }>(
    subjectId === undefined
      ? `SELECT count(*)::int AS n FROM event WHERE type = $1`
      : `SELECT count(*)::int AS n FROM event WHERE type = $1 AND subject_id = $2`,
    subjectId === undefined ? [type] : [type, subjectId],
  );
  return rows[0]?.n ?? 0;
}

export async function createTask(
  stack: E2EStack,
  key: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = newId();
  await stack.pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                       tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,$4,$5,'목표','PR','도구','경계')`,
    [
      id,
      stack.projectId,
      key,
      String(overrides['title'] ?? key),
      String(overrides['status'] ?? 'ready'),
    ],
  );
  return id;
}
