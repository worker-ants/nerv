// E14-S03 — GitHub 웹훅 → 증적 수집 (FR-13)
//
// 이 표면은 **인증이 다르다**: PAT 가 아니라 HMAC 서명이다(GitHub 은 우리 토큰을 들고 있지
// 않다). 그래서 검증이 이 파일의 절반이고, 나머지 절반은 "판정하지 않는다"의 확인이다 —
// 증적이 붙어도 Task 상태는 그대로여야 한다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

const SECRET = 'webhook-test-secret';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_webhook');
  await runMigrations(db.url);
  pool = new pg.Pool({ connectionString: db.url });

  process.env['DATABASE_URL'] = db.url;
  process.env['NERV_GITHUB_WEBHOOK_SECRET'] = SECRET;
  process.env['NERV_VALKEY_URL'] ??= 'redis://localhost:6379';
  app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await seed();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

beforeEach(async () => {
  await pool.query('DELETE FROM evidence');
  await pool.query('DELETE FROM event');
});

async function post(
  payload: Record<string, unknown>,
  options: { event?: string; signature?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(payload);
  const signature =
    options.signature === undefined
      ? `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`
      : options.signature;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-github-event': options.event ?? 'pull_request',
  };
  if (signature !== null) headers['x-hub-signature-256'] = signature;

  const res = await app.inject({
    method: 'POST',
    url: '/ingest/webhooks/github/clemvion',
    headers,
    payload: raw,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('서명 검증 — 검증 없는 웹훅은 누구나 증적을 만드는 문이다', () => {
  it('서명이 없으면 401 이다', async () => {
    const res = await post({ pull_request: {} }, { signature: null });
    expect(res.status).toBe(401);
    expect(res.body['code']).toBe(NERV_ERROR.UNAUTHENTICATED);
  });

  it('서명이 틀리면 401 이다', async () => {
    const res = await post({ pull_request: {} }, { signature: `sha256=${'0'.repeat(64)}` });
    expect(res.status).toBe(401);
  });

  it('본문이 한 글자만 달라도 서명이 깨진다 — 원문 바이트로 계산하기 때문', async () => {
    const raw = JSON.stringify({ pull_request: { title: 'TSK-0001' } });
    const signature = `sha256=${createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')}`;
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/webhooks/github/clemvion',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
      },
      payload: JSON.stringify({ pull_request: { title: 'TSK-0002' } }),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Task 연결 — 브랜치·제목·본문 어디서든 찾는다', () => {
  it('PR 브랜치명의 Task 키로 증적을 붙인다', async () => {
    const res = await post({
      pull_request: {
        head: { ref: `feat/${taskKey()}-widget` },
        html_url: 'https://github.com/acme/app/pull/42',
      },
      repository: { full_name: 'acme/app' },
    });
    expect(res.status).toBe(201);
    expect(res.body['matched_task']).toBe(taskKey());

    const { rows } = await pool.query<{
      kind: string;
      locator: string;
      source: string;
      repo: string;
    }>(
      `SELECT kind::text AS kind, locator, source::text AS source, repo FROM evidence WHERE task_id = $1`,
      [taskId],
    );
    expect(rows[0]).toMatchObject({
      kind: 'pr',
      locator: 'https://github.com/acme/app/pull/42',
      source: 'ci',
      repo: 'acme/app',
    });
  });

  it('push 이벤트는 커밋 SHA 를 증적으로 남긴다', async () => {
    const res = await post(
      {
        ref: `refs/heads/fix/${taskKey()}`,
        after: 'a'.repeat(40),
        repository: { full_name: 'acme/app' },
      },
      { event: 'push' },
    );
    expect(res.body['evidence_id']).not.toBeNull();
    const { rows } = await pool.query<{ kind: string }>(
      `SELECT kind::text AS kind FROM evidence WHERE task_id = $1`,
      [taskId],
    );
    expect(rows[0]?.kind).toBe('commit');
  });

  it('같은 PR 이 여러 번 와도 증적은 하나다 — 웹훅은 재전송이 정상이다', async () => {
    const payload = {
      pull_request: { title: `${taskKey()} 위젯`, html_url: 'https://github.com/acme/app/pull/7' },
    };
    await post(payload);
    const second = await post(payload);
    expect(second.body['skipped_reason']).toContain('멱등');

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM evidence WHERE task_id = $1`,
      [taskId],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('판정하지 않는다 — 수집이 상태를 바꾸지 않는다', () => {
  it('증적이 붙어도 Task 상태는 그대로다 (리뷰 커버리지 판정은 Phase 2)', async () => {
    await post({
      pull_request: { title: taskKey(), html_url: 'https://github.com/acme/app/pull/9' },
    });
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]?.status).toBe('in_progress');
  });

  it('Task 키가 없으면 사유를 돌려준다 — 조용한 무시가 가장 나쁜 실패다', async () => {
    const res = await post({ pull_request: { title: '그냥 PR', html_url: 'https://x/1' } });
    expect(res.status).toBe(201);
    expect(res.body['skipped_reason']).toContain('찾지 못했습니다');
  });

  it('없는 Task 키는 어느 Task 에도 붙이지 않는다', async () => {
    const res = await post({
      pull_request: { title: 'TSK-ffff 없는 작업', html_url: 'https://x/2' },
    });
    expect(res.body['matched_task']).toBe('TSK-FFFF');
    expect(res.body['evidence_id']).toBeNull();
  });

  it('관심 없는 이벤트는 사유와 함께 통과시킨다 — 400 으로 재전송을 유발하지 않는다', async () => {
    const res = await post({}, { event: 'issues' });
    expect(res.status).toBe(201);
    expect(res.body['skipped_reason']).toContain('수집 대상이 아닌');
  });
});

function taskKey(): string {
  return `TSK-${taskId.slice(0, 4).toUpperCase()}`;
}

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  taskId = newId();
  const userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'a@example.com','A','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO task (id, project_id, key, title, status, goal_md, output_format_md,
                       tools_sources_md, boundaries_md)
     VALUES ($1,$2,$3,'위젯','in_progress','목표','PR','도구','경계')`,
    [taskId, projectId, taskKey()],
  );
}
