// EP-MIR-01·02 md 미러의 HTTP 경로 — 오류가 오류로 나간다 (2026-09-28 · REQ-API-236)
//
// 라우트 데코레이터(`@Header`)가 핸들러보다 먼저 content-type 을 md 로 정해서, 오류 봉투(JSON 객체)를
// Fastify 가 보내지 못하고 500 "invalid payload type" 이 됐다. 없는 버전 · 없는 키 · `?version=abc` 가
// 모두 500 이었다. 서비스만 부르던 테스트(mirror-retention.spec.ts)는 이것을 볼 수 없었다 — 여기서는
// 실제 HTTP 로 부른다. 파일 경로의 없음은 404(사람 결정 D5)이고, REST 의 같은 상황은 409 그대로다.

import { NERV_ERROR, newId } from '@nerv/schema';
import { runMigrations } from '@nerv/schema/migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/main.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { SpecService } from '../../src/modules/spec/spec.service.js';
import { createScratchDb } from './helpers.js';
import type { ScratchDb } from './helpers.js';

let db: ScratchDb;
let pool: pg.Pool;
let app: NestFastifyApplication;
let token: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  db = await createScratchDb('nerv_mirror_http');
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
      name: 'mirror',
      scopes: ['spec:read'],
    })
  ).token;

  const drafted = await app.get(SpecService).draftUpsert({
    roles: ['planner'],
    projectId,
    key: 'SPC-MIR-001',
    title: '미러: 제목에 쌍점',
    type: 'feature',
    bodyMd: '# 미러\n\n본문',
    userId,
  });
  await pool.query(
    `UPDATE spec_version SET status='approved', approved_at=now(), approved_by_user_id=$2,
            edit_lease_user_id=NULL, edit_lease_session_id=NULL, edit_lease_expires_at=NULL
      WHERE id = $1`,
    [drafted['spec_version_id'], userId],
  );
  await pool.query(`UPDATE spec SET current_version_id=$1 WHERE id=$2`, [
    drafted['spec_version_id'],
    drafted['spec_id'],
  ]);
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

async function get(
  url: string,
): Promise<{ status: number; type: string; text: string; json: () => Record<string, unknown> }> {
  const res = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: res.statusCode,
    type: String(res.headers['content-type'] ?? ''),
    text: res.body,
    json: () => JSON.parse(res.body) as Record<string, unknown>,
  };
}

describe('md 미러의 HTTP 응답 (REQ-API-236)', () => {
  it('있는 문서는 markdown 으로 나간다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-MIR-001.md');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/markdown');
    expect(res.text.startsWith('---\n')).toBe(true);
  });

  it('llms.txt 는 text/plain 이다', async () => {
    const res = await get('/api/projects/clemvion/llms.txt');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/plain');
    expect(res.text).toContain('SPC-MIR-001');
  });

  it('없는 버전은 404 다 — 500 이 아니고, 본문은 오류 봉투(JSON)다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-MIR-001.md?version=9');
    expect(res.status).toBe(404);
    expect(res.type).toContain('application/json');
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
    expect((res.json()['details'] as Record<string, unknown>)['kind']).toBe('not_found');
  });

  it('없는 키도 404 다', async () => {
    const res = await get('/api/projects/clemvion/specs/SPC-NOPE.md');
    expect(res.status).toBe(404);
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
  });

  it.each(['abc', '0', '-1', '1.5'])(
    '?version=%s 는 400 이다 — 숫자로 바꾸지 않은 채 SQL 까지 가던 자리다',
    async (version) => {
      const res = await get(`/api/projects/clemvion/specs/SPC-MIR-001.md?version=${version}`);
      expect(res.status).toBe(400);
      expect((res.json()['details'] as Record<string, unknown>)['field']).toBe('version');
    },
  );

  it('REST 의 같은 상황은 409 그대로다 — 404 는 파일 경로만의 것이다', async () => {
    const res = await get('/api/v1/projects/clemvion/specs/SPC-MIR-001?v=9');
    expect(res.status).toBe(409);
    expect(res.json()['code']).toBe(NERV_ERROR.PRECONDITION);
  });
});

async function seed(): Promise<void> {
  const orgId = newId();
  projectId = newId();
  userId = newId();
  await pool.query(`INSERT INTO organization (id, slug, name) VALUES ($1,'nerv','NERV')`, [orgId]);
  await pool.query(
    `INSERT INTO "user" (id, email, display_name, state) VALUES ($1,'mira@example.com','미라','active')`,
    [userId],
  );
  await pool.query(
    `INSERT INTO project (id, org_id, slug, key, name) VALUES ($1,$2,'clemvion','CLV','clemvion')`,
    [projectId, orgId],
  );
  await pool.query(
    `INSERT INTO membership (id, org_id, project_id, user_id, role) VALUES ($1,$2,$3,$4,'planner')`,
    [newId(), orgId, projectId, userId],
  );
}
